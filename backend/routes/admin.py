from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta

import models
import auth
from database import get_db
from config import PLANS

router = APIRouter(tags=["admin"])


# ── Schemas ────────────────────────────────────────────────────────────────────
class UserAdminOut(BaseModel):
    id: int
    name: str
    email: str
    plan: str
    plan_expires_at: Optional[datetime]
    is_active: bool
    is_admin: bool
    sessions_count: int
    contacts_count: int
    campaigns_count: int
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class GlobalStats(BaseModel):
    total_users: int
    active_users: int
    total_sessions: int
    connected_sessions: int
    messages_sent_today: int


class ChangePlanBody(BaseModel):
    plan: str
    days: int = 30


class ToggleActiveBody(BaseModel):
    is_active: bool


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.get("/usuarios", response_model=List[UserAdminOut])
def list_users(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    users = db.query(models.User).order_by(models.User.id).all()
    result = []
    for u in users:
        result.append(UserAdminOut(
            id=u.id,
            name=u.name,
            email=u.email,
            plan=u.plan.value,
            plan_expires_at=u.plan_expires_at,
            is_active=u.is_active,
            is_admin=u.is_admin,
            sessions_count=len(u.sessions),
            contacts_count=len(u.contacts),
            campaigns_count=len(u.campaigns),
            created_at=u.created_at,
        ))
    return result


@router.get("/stats", response_model=GlobalStats)
def global_stats(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    total_users = db.query(func.count(models.User.id)).scalar()
    active_users = db.query(func.count(models.User.id)).filter(models.User.is_active == True).scalar()
    total_sessions = db.query(func.count(models.WhatsAppSession.id)).scalar()
    connected_sessions = (
        db.query(func.count(models.WhatsAppSession.id))
        .filter(models.WhatsAppSession.status == models.SessionStatus.connected)
        .scalar()
    )
    # Sum messages_sent_today across all sessions
    messages_today = db.query(func.sum(models.WhatsAppSession.messages_sent_today)).scalar() or 0

    return GlobalStats(
        total_users=total_users,
        active_users=active_users,
        total_sessions=total_sessions,
        connected_sessions=connected_sessions,
        messages_sent_today=messages_today,
    )


@router.put("/usuarios/{user_id}/plano")
def change_user_plan(
    user_id: int,
    body: ChangePlanBody,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    if body.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Plano inválido")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.plan = models.PlanType(body.plan)
    user.plan_expires_at = datetime.now(timezone.utc) + timedelta(days=body.days)
    db.commit()
    return {"ok": True, "plan": body.plan, "expires_at": user.plan_expires_at}


@router.put("/usuarios/{user_id}/ativo")
def toggle_user_active(
    user_id: int,
    body: ToggleActiveBody,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    user.is_active = body.is_active
    db.commit()
    return {"ok": True, "is_active": user.is_active}
