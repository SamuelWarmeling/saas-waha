import re
import hmac
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta, timezone
from typing import Optional

import models
import auth
from database import get_db
from config import settings, PLANS
from email_utils import gerar_codigo_verificacao, enviar_email_verificacao

router = APIRouter(prefix="/api/usuarios", tags=["Usuários"])

# ── Rate limiting (login + esqueceu-senha) ─────────────────────────────────────
_login_attempts: dict = {}   # ip -> [timestamp, ...]
MAX_LOGIN_PER_MINUTE = 10


def _check_rate_limit(ip: str):
    now = datetime.now(timezone.utc)
    attempts = [t for t in _login_attempts.get(ip, []) if (now - t).total_seconds() < 60]
    if len(attempts) >= MAX_LOGIN_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Muitas tentativas. Aguarde 1 minuto.")
    _login_attempts[ip] = attempts + [now]


# ── Domínios de email temporário bloqueados ────────────────────────────────────
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


# ── Helpers ───────────────────────────────────────────────────────────────────
def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def validar_cpf(cpf: str) -> bool:
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
    """Salva log de tentativa suspeita de cadastro."""
    try:
        db.add(models.TentativaSuspeita(ip=ip, tipo=tipo, detalhe=detalhe[:500]))
        db.commit()
    except Exception:
        db.rollback()


# ── Schemas ──────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    cpf: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    plan: str
    plan_expires_at: Optional[datetime]
    is_active: bool
    is_admin: bool
    trial_ativo: bool = False
    trial_expira_em: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str


class RegistroResponse(BaseModel):
    status: str
    email: str
    mensagem: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None


class DispatchSettingsRequest(BaseModel):
    delay_min: int
    delay_max: int
    limite_diario: int
    chips_disparo_simultaneo: int = 3


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/registro", response_model=RegistroResponse, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, request: Request, db: Session = Depends(get_db)):
    ip = _get_ip(request)
    hoje = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. IP banido
    ip_banido = db.query(models.IPBanido).filter(models.IPBanido.ip == ip).first()
    if ip_banido:
        _registrar_tentativa(db, ip, "ip_banido", f"Tentativa de cadastro de IP banido: {ip}")
        raise HTTPException(status_code=403, detail="Acesso bloqueado. Entre em contato com o suporte.")

    # 2. Rate limit por IP (máx 3 por dia)
    registro_ip = db.query(models.CadastroIP).filter(
        models.CadastroIP.ip == ip,
        models.CadastroIP.data == hoje,
    ).first()
    if registro_ip and registro_ip.contagem >= MAX_CADASTROS_POR_IP:
        _registrar_tentativa(db, ip, "rate_limit", f"IP {ip} excedeu {MAX_CADASTROS_POR_IP} cadastros em {hoje}")
        raise HTTPException(status_code=429, detail="Muitas tentativas. Tente novamente amanhã.")

    # 3. Domínio de email temporário
    dominio = data.email.split("@")[-1].lower()
    if dominio in BLOCKED_EMAIL_DOMAINS:
        _registrar_tentativa(db, ip, "email_bloqueado", f"Tentativa com email temporário: {data.email}")
        raise HTTPException(status_code=400, detail="Use um e-mail permanente para criar sua conta.")

    # 4. Email já cadastrado
    if db.query(models.User).filter(models.User.email == data.email).first():
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")

    # 5. Validação de CPF
    cpf_limpo = re.sub(r'\D', '', data.cpf)
    if not validar_cpf(cpf_limpo):
        raise HTTPException(status_code=400, detail="CPF inválido. Verifique os dígitos informados.")

    # 6. CPF já cadastrado
    if db.query(models.User).filter(models.User.cpf == cpf_limpo).first():
        _registrar_tentativa(db, ip, "cpf_duplicado", f"Tentativa com CPF já cadastrado (email: {data.email})")
        raise HTTPException(status_code=400, detail="Este CPF já possui uma conta cadastrada.")

    # 7. Senha mínima
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Senha deve ter no mínimo 8 caracteres")

    # ── Cria usuário ──────────────────────────────────────────────────────────
    user = models.User(
        name=data.name,
        email=data.email,
        password_hash=auth.hash_password(data.password),
        cpf=cpf_limpo,
        email_verificado=False,
        plan=models.PlanType.starter,
        plan_expires_at=datetime.now(timezone.utc) + timedelta(days=7),
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

    # ── Gera e envia código de verificação ────────────────────────────────────
    codigo = gerar_codigo_verificacao()
    db.add(models.EmailVerificacao(
        user_id=user.id,
        codigo=codigo,
        expira_em=datetime.now(timezone.utc) + timedelta(minutes=30),
    ))
    db.commit()

    enviar_email_verificacao(user.email, user.name, codigo)

    return RegistroResponse(
        status="aguardando_verificacao",
        email=user.email,
        mensagem=f"Código de verificação enviado para {user.email}. Válido por 30 minutos.",
    )


@router.post("/login", response_model=TokenOut)
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    _check_rate_limit(_get_ip(request))
    user = db.query(models.User).filter(models.User.email == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Conta desativada")

    access_token = auth.create_access_token({"sub": str(user.id)})
    refresh_token = auth.create_refresh_token({"sub": str(user.id)})

    return TokenOut(access_token=access_token, refresh_token=refresh_token, user=user)


@router.post("/refresh", response_model=TokenOut)
def refresh_token(body: RefreshRequest, db: Session = Depends(get_db)):
    payload = auth.decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Refresh token inválido")

    user_id = payload.get("sub")
    user = db.query(models.User).filter(models.User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Usuário inválido")

    access_token = auth.create_access_token({"sub": str(user.id)})
    new_refresh = auth.create_refresh_token({"sub": str(user.id)})

    return TokenOut(access_token=access_token, refresh_token=new_refresh, user=user)


@router.get("/me", response_model=UserOut)
def get_me(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


@router.put("/me", response_model=UserOut)
def update_profile(
    data: UpdateProfileRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if data.name:
        current_user.name = data.name
    if data.email:
        existing = db.query(models.User).filter(
            models.User.email == data.email,
            models.User.id != current_user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="E-mail já em uso")
        current_user.email = data.email

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/alterar-senha")
def change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not auth.verify_password(data.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Senha atual incorreta")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Nova senha deve ter no mínimo 8 caracteres")

    current_user.password_hash = auth.hash_password(data.new_password)
    db.commit()
    return {"message": "Senha alterada com sucesso"}


@router.get("/me/configuracoes")
def get_dispatch_settings(current_user: models.User = Depends(auth.get_current_user)):
    return {
        "delay_min": current_user.dispatch_delay_min,
        "delay_max": current_user.dispatch_delay_max,
        "limite_diario": current_user.dispatch_daily_limit,
        "chips_disparo_simultaneo": getattr(current_user, "chips_disparo_simultaneo", 3),
    }


@router.put("/me/configuracoes")
def update_dispatch_settings(
    data: DispatchSettingsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    current_user.dispatch_delay_min = data.delay_min
    current_user.dispatch_delay_max = data.delay_max
    current_user.dispatch_daily_limit = data.limite_diario
    current_user.chips_disparo_simultaneo = max(1, min(10, data.chips_disparo_simultaneo))
    # Sincroniza limite diário em todas as sessões do usuário
    db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.user_id == current_user.id
    ).update({"max_daily_messages": data.limite_diario})
    db.commit()
    return {
        "delay_min": data.delay_min,
        "delay_max": data.delay_max,
        "limite_diario": data.limite_diario,
        "chips_disparo_simultaneo": current_user.chips_disparo_simultaneo,
    }


@router.get("/plano-info")
def get_plan_info(current_user: models.User = Depends(auth.get_current_user)):
    plan = PLANS.get(current_user.plan.value, {})
    is_active = auth.check_plan_active(current_user)
    return {
        "plan": current_user.plan.value,
        "plan_info": plan,
        "plan_expires_at": current_user.plan_expires_at,
        "is_active": is_active,
    }


# ── Schemas para reset de senha ───────────────────────────────────────────────

class EsqueceuSenhaRequest(BaseModel):
    email: EmailStr


class ResetarSenhaRequest(BaseModel):
    email: EmailStr
    codigo: str
    nova_senha: str


# ── Endpoints de reset de senha ───────────────────────────────────────────────

@router.post("/esqueceu-senha")
def esqueceu_senha(data: EsqueceuSenhaRequest, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(_get_ip(request))
    user = db.query(models.User).filter(models.User.email == data.email).first()
    # Resposta genérica para não revelar se email existe
    if not user:
        return {"message": "Se o e-mail estiver cadastrado, você receberá um código em breve."}

    # Remove códigos anteriores de reset para este usuário
    db.query(models.EmailVerificacao).filter(
        models.EmailVerificacao.user_id == user.id,
        models.EmailVerificacao.tipo == "reset_senha",
    ).delete()
    db.commit()

    codigo = gerar_codigo_verificacao()
    db.add(models.EmailVerificacao(
        user_id=user.id,
        codigo=codigo,
        tipo="reset_senha",
        expira_em=datetime.now(timezone.utc) + timedelta(minutes=30),
    ))
    db.commit()

    enviar_email_verificacao(user.email, user.name, codigo)

    return {"message": "Se o e-mail estiver cadastrado, você receberá um código em breve."}


@router.post("/resetar-senha")
def resetar_senha(data: ResetarSenhaRequest, db: Session = Depends(get_db)):
    if len(data.nova_senha) < 8:
        raise HTTPException(status_code=400, detail="Nova senha deve ter no mínimo 8 caracteres")

    user = db.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Código inválido ou expirado.")

    verificacao = (
        db.query(models.EmailVerificacao)
        .filter(
            models.EmailVerificacao.user_id == user.id,
            models.EmailVerificacao.tipo == "reset_senha",
        )
        .order_by(models.EmailVerificacao.criado_em.desc())
        .first()
    )
    if not verificacao:
        raise HTTPException(status_code=400, detail="Código inválido ou expirado.")

    now = datetime.now(timezone.utc)
    expira = verificacao.expira_em
    if expira.tzinfo is None:
        expira = expira.replace(tzinfo=timezone.utc)
    if now > expira:
        db.delete(verificacao)
        db.commit()
        raise HTTPException(status_code=400, detail="Código expirado. Solicite um novo.")

    if verificacao.tentativas >= 3:
        db.delete(verificacao)
        db.commit()
        raise HTTPException(status_code=429, detail="Código bloqueado por excesso de tentativas.")

    verificacao.tentativas += 1
    db.commit()

    if not hmac.compare_digest(data.codigo.strip(), verificacao.codigo):
        restantes = 3 - verificacao.tentativas
        if restantes <= 0:
            db.delete(verificacao)
            db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Código incorreto. {restantes} tentativa(s) restante(s)." if restantes > 0 else "Código bloqueado. Solicite um novo."
        )

    user.password_hash = auth.hash_password(data.nova_senha)
    db.delete(verificacao)
    db.commit()

    return {"message": "Senha alterada com sucesso. Faça login com sua nova senha."}
