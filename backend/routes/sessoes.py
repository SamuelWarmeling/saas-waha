from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import httpx

import models
import auth
from database import get_db
from config import settings, PLANS

router = APIRouter(prefix="/api/sessoes", tags=["Sessões"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    name: str
    delay_min: Optional[int] = 5
    delay_max: Optional[int] = 15
    max_daily_messages: Optional[int] = None


class SessionUpdate(BaseModel):
    name: Optional[str] = None
    delay_min: Optional[int] = None
    delay_max: Optional[int] = None
    max_daily_messages: Optional[int] = None


class SessionOut(BaseModel):
    id: int
    name: str
    session_id: str
    phone_number: Optional[str]
    status: str
    qr_code: Optional[str]
    max_daily_messages: int
    messages_sent_today: int
    delay_min: int
    delay_max: int
    is_active: bool

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────
async def waha_request(method: str, path: str, **kwargs):
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{settings.WAHA_API_URL}{path}"
        resp = await client.request(method, url, headers=headers, **kwargs)
        resp.raise_for_status()
        return resp.json()


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/webhook-url")
def get_webhook_url(
    current_user: models.User = Depends(auth.get_current_user),
):
    base = settings.FRONTEND_URL.replace("5173", "8000").rstrip("/")
    return {"webhook_url": f"{base}/api/webhook/waha"}


@router.get("/{session_id}/qrcode")
async def get_qrcode(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Busca QR Code diretamente da WAHA API em tempo real."""
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    if session.status == models.SessionStatus.connected:
        return {"status": "connected", "qr": None}

    try:
        data = await waha_request("GET", f"/api/sessions/{session.session_id}/auth/qr")
        qr_str = data.get("qr") or data.get("data") or ""
        return {"status": session.status.value, "qr": qr_str}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {"status": session.status.value, "qr": None}
        raise HTTPException(status_code=502, detail="Erro ao buscar QR da WAHA")
    except Exception:
        return {"status": session.status.value, "qr": session.qr_code}


@router.get("", response_model=List[SessionOut])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    sessions = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.user_id == current_user.id)
        .all()
    )
    return sessions


@router.post("", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def create_session(
    data: SessionCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    plan_info = PLANS.get(current_user.plan.value, {})
    max_sessions = plan_info.get("max_sessions", 2)

    current_count = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.user_id == current_user.id,
            models.WhatsAppSession.is_active == True,
        )
        .count()
    )
    if current_count >= max_sessions:
        raise HTTPException(
            status_code=400,
            detail=f"Limite de sessões do seu plano atingido ({max_sessions})",
        )

    total_count = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.user_id == current_user.id)
        .count()
    )
    session_id = f"u{current_user.id}_{total_count + 1:02d}"
    max_daily = data.max_daily_messages or plan_info.get("max_daily_messages", 200)

    # Salva no DB
    session = models.WhatsAppSession(
        user_id=current_user.id,
        name=data.name,
        session_id=session_id,
        delay_min=data.delay_min,
        delay_max=data.delay_max,
        max_daily_messages=max_daily,
        status=models.SessionStatus.disconnected,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    # Cria sessão no WAHA automaticamente
    try:
        await waha_request("POST", "/api/sessions", json={
            "name": session_id,
            "config": {},
        })
        print(f"[WAHA] Sessão {session_id} criada com sucesso")
    except httpx.HTTPStatusError as e:
        print(f"[WAHA] Erro HTTP ao criar sessão {session_id}: {e.response.status_code} - {e.response.text}")
    except Exception as e:
        print(f"[WAHA] Erro ao criar sessão {session_id}: {type(e).__name__}: {e}")

    # Configura webhook automaticamente no WAHA
    try:
        await waha_request("PUT", f"/api/sessions/{session_id}", json={
            "webhook": {
                "url": settings.WAHA_WEBHOOK_URL,
                "events": ["message", "session.status"],
            }
        })
        print(f"[WAHA] Webhook configurado para sessão {session_id}: {settings.WAHA_WEBHOOK_URL}")
    except httpx.HTTPStatusError as e:
        print(f"[WAHA] Erro HTTP ao configurar webhook {session_id}: {e.response.status_code} - {e.response.text}")
    except Exception as e:
        print(f"[WAHA] Erro ao configurar webhook {session_id}: {type(e).__name__}: {e}")

    return session


@router.get("/{session_id}", response_model=SessionOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    return session


@router.put("/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int,
    data: SessionUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    if data.name is not None:
        session.name = data.name
    if data.delay_min is not None:
        session.delay_min = data.delay_min
    if data.delay_max is not None:
        session.delay_max = data.delay_max
    if data.max_daily_messages is not None:
        session.max_daily_messages = data.max_daily_messages

    db.commit()
    db.refresh(session)
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Remove sessão do WAHA antes de deletar do DB
    try:
        await waha_request("DELETE", f"/api/sessions/{session.session_id}")
    except Exception:
        pass  # ignora se não existir no WAHA

    db.delete(session)
    db.commit()


@router.post("/{session_id}/conectar")
async def connect_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    try:
        # Criar sessão no Waha
        await waha_request("POST", f"/api/sessions/{session.session_id}/start")
        session.status = models.SessionStatus.connecting
        db.commit()

        # Obter QR Code
        qr_data = await waha_request("GET", f"/api/sessions/{session.session_id}/auth/qr")
        session.qr_code = qr_data.get("qr", "")
        db.commit()
        db.refresh(session)

        return {"qr_code": session.qr_code, "status": session.status}
    except httpx.HTTPError as e:
        session.status = models.SessionStatus.error
        db.commit()
        raise HTTPException(status_code=502, detail=f"Erro ao conectar sessão WAHA: {str(e)}")


@router.post("/{session_id}/desconectar")
async def disconnect_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    try:
        await waha_request("POST", f"/api/sessions/{session.session_id}/stop")
    except Exception:
        pass  # ignora erro se já estiver desconectada

    session.status = models.SessionStatus.disconnected
    session.qr_code = None
    db.commit()
    return {"message": "Sessão desconectada"}


@router.get("/{session_id}/status")
async def check_session_status(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    try:
        data = await waha_request("GET", f"/api/sessions/{session.session_id}")
        waha_status = data.get("status", "STOPPED")

        status_map = {
            "WORKING": models.SessionStatus.connected,
            "SCAN_QR_CODE": models.SessionStatus.connecting,
            "STOPPED": models.SessionStatus.disconnected,
            "FAILED": models.SessionStatus.error,
        }
        new_status = status_map.get(waha_status, models.SessionStatus.disconnected)

        if new_status != session.status:
            session.status = new_status
            if new_status == models.SessionStatus.connected:
                me = await waha_request("GET", f"/api/sessions/{session.session_id}/me")
                session.phone_number = me.get("id", "").replace("@c.us", "")
                session.qr_code = None
            db.commit()
    except Exception:
        pass

    db.refresh(session)
    return {"status": session.status, "phone_number": session.phone_number}
