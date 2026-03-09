from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
from typing import Optional

import models
import auth
from database import get_db
from email_utils import gerar_codigo_verificacao, enviar_email_verificacao

router = APIRouter(prefix="/api/auth", tags=["Verificação de E-mail"])

MAX_TENTATIVAS = 3
EXPIRACAO_MINUTOS = 30
COOLDOWN_REENVIO_SEGUNDOS = 60


# ── Schemas ────────────────────────────────────────────────────────────────────

class VerificarEmailRequest(BaseModel):
    email: EmailStr
    codigo: str


class ReenviarCodigoRequest(BaseModel):
    email: EmailStr


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict


# ── Helpers ────────────────────────────────────────────────────────────────────

def _user_out(user: models.User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "plan": user.plan.value,
        "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
        "is_active": user.is_active,
        "is_admin": user.is_admin,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/verificar-email")
def verificar_email(data: VerificarEmailRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.email_verificado:
        # Já verificado — apenas retorna tokens
        access_token = auth.create_access_token({"sub": str(user.id)})
        refresh_token = auth.create_refresh_token({"sub": str(user.id)})
        return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer", "user": _user_out(user)}

    verificacao = (
        db.query(models.EmailVerificacao)
        .filter(models.EmailVerificacao.user_id == user.id)
        .order_by(models.EmailVerificacao.criado_em.desc())
        .first()
    )

    if not verificacao:
        raise HTTPException(status_code=400, detail="Nenhum código de verificação encontrado. Solicite um novo.")

    now = datetime.now(timezone.utc)

    # Expirado
    expira = verificacao.expira_em
    if expira.tzinfo is None:
        expira = expira.replace(tzinfo=timezone.utc)
    if now > expira:
        db.delete(verificacao)
        db.commit()
        raise HTTPException(status_code=400, detail="Código expirado. Solicite um novo.")

    # Máximo de tentativas
    if verificacao.tentativas >= MAX_TENTATIVAS:
        db.delete(verificacao)
        db.commit()
        raise HTTPException(status_code=429, detail="Código bloqueado por excesso de tentativas. Solicite um novo.")

    # Verifica código
    verificacao.tentativas += 1
    db.commit()

    if data.codigo.strip() != verificacao.codigo:
        restantes = MAX_TENTATIVAS - verificacao.tentativas
        if restantes <= 0:
            db.delete(verificacao)
            db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Código incorreto. {restantes} tentativa(s) restante(s)." if restantes > 0 else "Código bloqueado. Solicite um novo."
        )

    # Sucesso — marcar e limpar
    user.email_verificado = True
    db.delete(verificacao)
    db.commit()
    db.refresh(user)

    access_token = auth.create_access_token({"sub": str(user.id)})
    refresh_token = auth.create_refresh_token({"sub": str(user.id)})

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": _user_out(user),
    }


@router.post("/reenviar-codigo")
def reenviar_codigo(data: ReenviarCodigoRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.email_verificado:
        return {"message": "E-mail já verificado"}

    # Cooldown: não reenviar antes de 60s da última verificação
    ultima = (
        db.query(models.EmailVerificacao)
        .filter(models.EmailVerificacao.user_id == user.id)
        .order_by(models.EmailVerificacao.criado_em.desc())
        .first()
    )
    if ultima:
        criado = ultima.criado_em
        if criado.tzinfo is None:
            criado = criado.replace(tzinfo=timezone.utc)
        segundos_decorridos = (datetime.now(timezone.utc) - criado).total_seconds()
        if segundos_decorridos < COOLDOWN_REENVIO_SEGUNDOS:
            restam = int(COOLDOWN_REENVIO_SEGUNDOS - segundos_decorridos)
            raise HTTPException(
                status_code=429,
                detail=f"Aguarde {restam} segundo(s) antes de reenviar."
            )
        # Remove código antigo
        db.delete(ultima)
        db.commit()

    # Gera e envia novo código
    codigo = gerar_codigo_verificacao()
    nova = models.EmailVerificacao(
        user_id=user.id,
        codigo=codigo,
        expira_em=datetime.now(timezone.utc) + timedelta(minutes=EXPIRACAO_MINUTOS),
    )
    db.add(nova)
    db.commit()

    enviar_email_verificacao(user.email, user.name, codigo)

    return {"message": "Código reenviado com sucesso"}
