import re
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
from typing import Optional

import models
import auth
from database import get_db
from config import settings
from email_utils import gerar_codigo_verificacao, enviar_email_verificacao

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Auth"])

# Scheme que não lança automaticamente 401 (allow_inactive polling)
_scheme = OAuth2PasswordBearer(tokenUrl="/api/usuarios/login", auto_error=False)

BLOCKED_EMAIL_DOMAINS = {
    "tempmail.com", "guerrillamail.com", "mailinator.com",
    "10minutemail.com", "throwam.com", "yopmail.com",
    "trashmail.com", "fakeinbox.com", "sharklasers.com",
    "guerrillamailblock.com", "grr.la", "spam4.me",
    "dispostable.com", "maildrop.cc", "tempr.email",
    "throwaway.email", "getnada.com", "tempinbox.com",
    "mailnull.com", "spamgourmet.com", "trashmail.me",
}

MAX_CADASTROS_POR_IP = 3

MAX_TENTATIVAS = 3
EXPIRACAO_MINUTOS = 30
COOLDOWN_REENVIO_SEGUNDOS = 60


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _validar_cpf(cpf: str) -> bool:
    cpf = re.sub(r'\D', '', cpf)
    if len(cpf) != 11 or len(set(cpf)) == 1:
        return False
    soma = sum(int(cpf[i]) * (10 - i) for i in range(9))
    d1 = (soma * 10 % 11) % 10
    if d1 != int(cpf[9]):
        return False
    soma = sum(int(cpf[i]) * (11 - i) for i in range(10))
    d2 = (soma * 10 % 11) % 10
    return d2 == int(cpf[10])


def _registrar_tentativa(db: Session, ip: str, tipo: str, detalhe: str):
    try:
        db.add(models.TentativaSuspeita(ip=ip, tipo=tipo, detalhe=detalhe[:500]))
        db.commit()
    except Exception:
        db.rollback()


# ── Schemas ────────────────────────────────────────────────────────────────────

class CadastroRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    cpf: Optional[str] = None


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
        "trial_ativo": getattr(user, "trial_ativo", False),
        "trial_expira_em": user.trial_expira_em.isoformat() if getattr(user, "trial_expira_em", None) else None,
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

    if not hmac.compare_digest(data.codigo.strip(), verificacao.codigo):
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


# ── /cadastro — novo registro com Stripe trial ─────────────────────────────────

@router.post("/cadastro")
def cadastro_com_stripe(data: CadastroRequest, request: Request, db: Session = Depends(get_db)):
    """
    Cria conta e inicia trial de 7 dias.
    - Com Stripe configurado: redireciona para Stripe Checkout (cartão obrigatório).
    - Sem Stripe ou se Stripe falhar: ativa direto no dashboard (fallback).
    Nunca retorna erro 5xx que deixe o usuário sem feedback.
    """
    ip = _get_ip(request)
    hoje = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. IP banido
    if db.query(models.IPBanido).filter(models.IPBanido.ip == ip).first():
        _registrar_tentativa(db, ip, "ip_banido", f"Cadastro de IP banido: {ip}")
        raise HTTPException(status_code=403, detail="Acesso bloqueado. Entre em contato com o suporte.")

    # 2. Rate limit por IP
    registro_ip = db.query(models.CadastroIP).filter(
        models.CadastroIP.ip == ip, models.CadastroIP.data == hoje,
    ).first()
    if registro_ip and registro_ip.contagem >= MAX_CADASTROS_POR_IP:
        _registrar_tentativa(db, ip, "rate_limit", f"IP {ip} excedeu {MAX_CADASTROS_POR_IP} cadastros")
        raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente amanhã.")

    # 3. Email temporário
    dominio = data.email.split("@")[-1].lower()
    if dominio in BLOCKED_EMAIL_DOMAINS:
        _registrar_tentativa(db, ip, "email_bloqueado", f"Email temporário: {data.email}")
        raise HTTPException(status_code=400, detail="Use um e-mail permanente para criar sua conta.")

    # 4. Email duplicado — se usuário existe mas está inativo (Stripe falhou antes), permite recadastro
    usuario_existente = db.query(models.User).filter(models.User.email == data.email).first()
    if usuario_existente:
        if usuario_existente.is_active:
            raise HTTPException(status_code=400, detail="E-mail já cadastrado")
        # Usuário inativo: limpa e recria abaixo (fluxo anterior falhou)
        db.delete(usuario_existente)
        db.commit()

    # 5. CPF (opcional)
    cpf_limpo = None
    if data.cpf:
        cpf_limpo = re.sub(r'\D', '', data.cpf)
        if cpf_limpo and not _validar_cpf(cpf_limpo):
            raise HTTPException(status_code=400, detail="CPF inválido. Verifique os dígitos informados.")
        if cpf_limpo:
            cpf_existente = db.query(models.User).filter(models.User.cpf == cpf_limpo).first()
            if cpf_existente and cpf_existente.is_active:
                _registrar_tentativa(db, ip, "cpf_duplicado", f"CPF já cadastrado (email: {data.email})")
                raise HTTPException(status_code=400, detail="Este CPF já possui uma conta cadastrada.")
            elif cpf_existente and not cpf_existente.is_active:
                db.delete(cpf_existente)
                db.commit()

    # 6. Senha
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Senha deve ter no mínimo 8 caracteres")

    # ── Cria usuário (inativo por enquanto) ───────────────────────────────────
    user = models.User(
        name=data.name,
        email=data.email,
        password_hash=auth.hash_password(data.password),
        cpf=cpf_limpo,
        email_verificado=True,
        is_active=False,
        plan=models.PlanType.starter,
        plan_expires_at=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # ── Atualiza contagem de IP ───────────────────────────────────────────────
    if registro_ip:
        registro_ip.contagem += 1
    else:
        db.add(models.CadastroIP(ip=ip, data=hoje, contagem=1))
    db.commit()

    # ── Tenta Stripe se configurado ───────────────────────────────────────────
    stripe_ok = bool(settings.STRIPE_SECRET_KEY and settings.STRIPE_PRICE_ID)
    if stripe_ok:
        try:
            import stripe as _stripe
            _stripe.api_key = settings.STRIPE_SECRET_KEY

            customer = _stripe.Customer.create(
                email=user.email,
                name=user.name,
                metadata={"user_id": str(user.id)},
            )
            user.stripe_customer_id = customer.id
            db.commit()

            checkout_session = _stripe.checkout.Session.create(
                customer=customer.id,
                payment_method_types=["card"],
                line_items=[{"price": settings.STRIPE_PRICE_ID, "quantity": 1}],
                mode="subscription",
                subscription_data={
                    "trial_period_days": 7,
                    "metadata": {"user_id": str(user.id)},
                },
                metadata={"user_id": str(user.id)},
                success_url=f"{settings.FRONTEND_URL}/pagamento/sucesso",
                cancel_url=f"{settings.FRONTEND_URL}/checkout",
            )

            # Tokens para polling na página de sucesso
            access_token = auth.create_access_token({"sub": str(user.id)})
            refresh_token = auth.create_refresh_token({"sub": str(user.id)})
            return {
                "checkout_url": checkout_session.url,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": _user_out(user),
            }

        except Exception as e:
            logger.error(f"[STRIPE] Erro ao criar checkout — usando fallback direto: {e}")
            # Fallback: ativa sem Stripe (segue abaixo)

    else:
        logger.warning("[STRIPE] Não configurado (STRIPE_SECRET_KEY/PRICE_ID vazios) — ativando direto")

    # ── Fallback: ativa direto com trial de 7 dias ────────────────────────────
    now = datetime.now(timezone.utc)
    user.is_active = True
    user.trial_ativo = True
    user.trial_expira_em = now + timedelta(days=7)
    user.plan_expires_at = now + timedelta(days=7)
    db.commit()
    db.refresh(user)

    access_token = auth.create_access_token({"sub": str(user.id)})
    refresh_token = auth.create_refresh_token({"sub": str(user.id)})

    return {
        "redirect": "/dashboard",
        "trial": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": _user_out(user),
    }


# ── /status — polling de ativação (aceita token de usuário inativo) ────────────

@router.get("/status")
def get_status(token: Optional[str] = Depends(_scheme), db: Session = Depends(get_db)):
    """
    Retorna {ativo, trial_ativo, trial_expira_em, trial_dias_restantes}.
    Aceita tokens de usuários ainda não ativados (is_active=False).
    """
    if not token:
        raise HTTPException(status_code=401, detail="Token não fornecido")

    try:
        payload = auth.decode_token(token)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token inválido")
        user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido")

    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado")

    now = datetime.now(timezone.utc)
    trial_dias_restantes = None
    if user.trial_ativo and user.trial_expira_em:
        expira = user.trial_expira_em
        if expira.tzinfo is None:
            expira = expira.replace(tzinfo=timezone.utc)
        trial_dias_restantes = max(0, (expira - now).days)

    return {
        "ativo": user.is_active,
        "trial_ativo": getattr(user, "trial_ativo", False),
        "trial_expira_em": user.trial_expira_em.isoformat() if user.trial_expira_em else None,
        "trial_dias_restantes": trial_dias_restantes,
    }
