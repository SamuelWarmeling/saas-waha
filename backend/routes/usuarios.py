from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta, timezone
from typing import Optional

import models
import auth
from database import get_db
from config import settings, PLANS

router = APIRouter(prefix="/api/usuarios", tags=["Usuários"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    name: str
    email: str
    plan: str
    plan_expires_at: Optional[datetime]
    is_active: bool
    is_admin: bool
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


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/registro", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="E-mail já cadastrado")

    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Senha deve ter no mínimo 8 caracteres")

    user = models.User(
        name=data.name,
        email=data.email,
        password_hash=auth.hash_password(data.password),
        plan=models.PlanType.starter,
        plan_expires_at=datetime.now(timezone.utc) + timedelta(days=7),  # trial 7 dias
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = auth.create_access_token({"sub": str(user.id)})
    refresh_token = auth.create_refresh_token({"sub": str(user.id)})

    return TokenOut(access_token=access_token, refresh_token=refresh_token, user=user)


@router.post("/login", response_model=TokenOut)
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
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
    # Sincroniza limite diário em todas as sessões do usuário
    db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.user_id == current_user.id
    ).update({"max_daily_messages": data.limite_diario})
    db.commit()
    return {
        "delay_min": data.delay_min,
        "delay_max": data.delay_max,
        "limite_diario": data.limite_diario,
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
