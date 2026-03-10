from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, text
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, timedelta
import httpx

import models
import auth
from database import get_db
from config import PLANS, settings

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


class BanirIPBody(BaseModel):
    ip: str
    motivo: Optional[str] = None


class AtivarPlanoBody(BaseModel):
    email: str
    tipo: str  # "vitalicio" | "trial" | "bloquear"
    plan: str = "pro"


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


@router.post("/ativar-plano")
def ativar_plano_por_email(
    body: AtivarPlanoBody,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    """
    Gerencia plano por e-mail.
    tipo="vitalicio" → ativa com plano pro até 2099
    tipo="trial"     → ativa trial de 7 dias
    tipo="bloquear"  → desativa a conta
    """
    if body.tipo not in ("vitalicio", "trial", "bloquear"):
        raise HTTPException(status_code=400, detail="tipo deve ser 'vitalicio', 'trial' ou 'bloquear'")

    user = db.query(models.User).filter(models.User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"Usuário '{body.email}' não encontrado")

    now = datetime.now(timezone.utc)

    if body.tipo == "vitalicio":
        plano = body.plan if body.plan in PLANS else "pro"
        user.is_active = True
        user.trial_ativo = False
        user.trial_expira_em = None
        user.plan = models.PlanType(plano)
        user.plan_expires_at = datetime(2099, 12, 31, tzinfo=timezone.utc)
        user.chips_disparo_simultaneo = PLANS[plano].get("max_sessions", 3)

    elif body.tipo == "trial":
        user.is_active = True
        user.trial_ativo = True
        user.trial_expira_em = now + timedelta(days=7)
        user.plan = models.PlanType("pro")
        user.plan_expires_at = now + timedelta(days=7)
        user.chips_disparo_simultaneo = PLANS["pro"].get("max_sessions", 3)

    elif body.tipo == "bloquear":
        user.is_active = False

    db.commit()
    db.refresh(user)

    return {
        "ok": True,
        "email": user.email,
        "tipo": body.tipo,
        "is_active": user.is_active,
        "plan": user.plan.value,
        "plan_expires_at": user.plan_expires_at.isoformat() if user.plan_expires_at else None,
    }


@router.post("/impersonate/{user_id}")
def impersonate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.require_admin),
):
    """Gera token JWT temporário (1h) para acessar a conta de outro usuário."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Não é possível impersonar a si mesmo")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    access_token = auth.create_access_token(
        {"sub": str(user.id)},
        expires_delta=timedelta(hours=1),
    )

    try:
        db.add(models.AtividadeLog(
            user_id=admin.id,
            tipo="admin_impersonate",
            descricao=f"Admin '{admin.email}' acessou conta de '{user.email}'",
        ))
        db.commit()
    except Exception:
        db.rollback()

    return {
        "access_token": access_token,
        "user_email": user.email,
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "plan": user.plan.value,
            "is_active": user.is_active,
            "is_admin": False,
        },
    }


# ── Segurança Anti-Abuso ───────────────────────────────────────────────────────

@router.get("/seguranca/ips")
def listar_ips_cadastros(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    """Retorna IPs com maior contagem de cadastros (possível abuso)."""
    registros = (
        db.query(models.CadastroIP)
        .order_by(desc(models.CadastroIP.contagem))
        .limit(100)
        .all()
    )
    banidos = {b.ip for b in db.query(models.IPBanido).all()}
    return [
        {
            "ip": r.ip,
            "data": r.data,
            "contagem": r.contagem,
            "banido": r.ip in banidos,
        }
        for r in registros
    ]


@router.get("/seguranca/tentativas")
def listar_tentativas(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    """Retorna as 200 tentativas suspeitas mais recentes."""
    tentativas = (
        db.query(models.TentativaSuspeita)
        .order_by(desc(models.TentativaSuspeita.criado_em))
        .limit(200)
        .all()
    )
    return [
        {
            "id": t.id,
            "ip": t.ip,
            "tipo": t.tipo,
            "detalhe": t.detalhe,
            "criado_em": t.criado_em,
        }
        for t in tentativas
    ]


@router.get("/seguranca/banidos")
def listar_ips_banidos(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    banidos = db.query(models.IPBanido).order_by(desc(models.IPBanido.banido_em)).all()
    return [
        {
            "id": b.id,
            "ip": b.ip,
            "motivo": b.motivo,
            "banido_em": b.banido_em,
        }
        for b in banidos
    ]


@router.post("/seguranca/banir")
def banir_ip(
    body: BanirIPBody,
    db: Session = Depends(get_db),
    admin: models.User = Depends(auth.require_admin),
):
    existing = db.query(models.IPBanido).filter(models.IPBanido.ip == body.ip).first()
    if existing:
        raise HTTPException(status_code=400, detail="IP já está banido")
    db.add(models.IPBanido(ip=body.ip, motivo=body.motivo, banido_por=admin.id))
    db.commit()
    return {"ok": True, "ip": body.ip}


@router.delete("/seguranca/banir/{ip}")
def desbanir_ip(
    ip: str,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    banido = db.query(models.IPBanido).filter(models.IPBanido.ip == ip).first()
    if not banido:
        raise HTTPException(status_code=404, detail="IP não está banido")
    db.delete(banido)
    db.commit()
    return {"ok": True, "ip": ip}


@router.post("/popular-phones")
async def popular_phones(
    db: Session = Depends(get_db),
    _admin: models.User = Depends(auth.require_admin),
):
    """
    Busca phone_number de todas as sessões via WAHA e salva no banco.
    Chame uma vez para corrigir sessões que ficaram sem phone_number.
    """
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY

    # 1. Busca todas as sessões do WAHA (retorna me.id em uma chamada só)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{settings.WAHA_API_URL}/api/sessions", headers=headers)
            r.raise_for_status()
            waha_sessions = r.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erro ao consultar WAHA: {e}")

    # Monta mapa session_name → phone
    waha_phones: dict[str, str] = {}
    for s in waha_sessions:
        name = s.get("name", "")
        me = s.get("me") or {}
        raw = me.get("id", "") or me.get("phoneNumber", "")
        if name and raw:
            phone = raw.split("@")[0].strip()
            phone = "".join(c for c in phone if c.isdigit())
            if phone:
                waha_phones[name] = phone

    # 2. Busca sessões do banco via SQL direto (evita problema de colunas novas)
    rows = db.execute(
        text("SELECT id, session_id, phone_number FROM whatsapp_sessions")
    ).fetchall()

    resultados = []
    atualizadas = 0

    for (sess_id, session_id, phone_number) in rows:
        if phone_number:
            resultados.append({"session": session_id, "status": "ja_tinha", "phone": phone_number})
            continue

        waha_phone = waha_phones.get(session_id)
        if waha_phone:
            db.execute(
                text("UPDATE whatsapp_sessions SET phone_number = :phone WHERE id = :id"),
                {"phone": waha_phone, "id": sess_id},
            )
            atualizadas += 1
            resultados.append({"session": session_id, "status": "atualizado", "phone": waha_phone})
        else:
            resultados.append({"session": session_id, "status": "sem_phone_no_waha", "phone": None})

    db.commit()

    return {
        "total_sessoes": len(rows),
        "atualizadas": atualizadas,
        "waha_sessions_encontradas": len(waha_phones),
        "detalhes": resultados,
    }
