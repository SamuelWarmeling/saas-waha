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
    tipo_chip: str = "fisico"
    is_aquecido: bool = False
    is_veterano: bool = False
    em_adaptacao: bool = False

    class Config:
        from_attributes = True


class TipoChipUpdate(BaseModel):
    tipo_chip: str  # "fisico" | "virtual"


# ── Helpers ───────────────────────────────────────────────────────────────────
async def waha_request(method: str, path: str, accept_json: bool = True, **kwargs):
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    if accept_json:
        headers["Accept"] = "application/json"

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
        # Correct path: /api/{session}/auth/qr (NOT /api/sessions/{session}/auth/qr)
        data = await waha_request("GET", f"/api/{session.session_id}/auth/qr")
        # Returns {"mimetype": "image/png", "data": "base64..."}
        b64 = data.get("data", "")
        qr_str = f"data:image/png;base64,{b64}" if b64 else ""
        if qr_str:
            session.qr_code = qr_str
            db.commit()
        return {"status": session.status.value, "qr": qr_str or session.qr_code}
    except httpx.HTTPStatusError as e:
        print(f"[QR] HTTPStatusError {e.response.status_code}: {e.response.text[:200]}")
        if e.response.status_code == 404:
            return {"status": session.status.value, "qr": session.qr_code}
        raise HTTPException(status_code=502, detail="Erro ao buscar QR da WAHA")
    except Exception as exc:
        print(f"[QR] Exception: {type(exc).__name__}: {exc}")
        return {"status": session.status.value, "qr": session.qr_code}


@router.get("", response_model=List[SessionOut])
async def list_sessions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    sessions = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.user_id == current_user.id)
        .all()
    )
    # Auto-fetch phone number for connected sessions that don't have one yet
    changed = False
    for sess in sessions:
        if sess.status == models.SessionStatus.connected and not sess.phone_number:
            try:
                me = await waha_request("GET", f"/api/{sess.session_id}/me")
                raw = me.get("id", "") or me.get("phoneNumber", "")
                if raw:
                    sess.phone_number = raw.split("@")[0].strip()
                    changed = True
                    print(f"[list] Phone synced for {sess.session_id}: {sess.phone_number}")
            except Exception as exc:
                print(f"[list] Erro ao buscar /me para {sess.session_id}: {exc}")
    if changed:
        db.commit()
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

    # Cria sessão no WAHA com webhook embutido no config
    try:
        await waha_request("POST", "/api/sessions", json={
            "name": session_id,
            "config": {
                "webhooks": [
                    {
                        "url": settings.WAHA_WEBHOOK_URL,
                        "events": ["message", "session.status"],
                    }
                ]
            },
        })
        print(f"[WAHA] Sessão {session_id} criada com webhook {settings.WAHA_WEBHOOK_URL}")
    except httpx.HTTPStatusError as e:
        print(f"[WAHA] Erro HTTP ao criar sessão {session_id}: {e.response.status_code} - {e.response.text}")
    except Exception as e:
        print(f"[WAHA] Erro ao criar sessão {session_id}: {type(e).__name__}: {e}")

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


@router.patch("/{session_id}/tipo-chip", response_model=SessionOut)
def update_tipo_chip(
    session_id: int,
    data: TipoChipUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if data.tipo_chip not in ("fisico", "virtual"):
        raise HTTPException(status_code=400, detail="tipo_chip deve ser 'fisico' ou 'virtual'")
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    session.tipo_chip = data.tipo_chip
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

    webhook_config = {
        "webhooks": [
            {
                "url": settings.WAHA_WEBHOOK_URL,
                "events": ["message", "session.status"],
            }
        ]
    }

    try:
        # 1. Garante que a sessão existe no WAHA (cria ou atualiza config)
        try:
            await waha_request("POST", "/api/sessions", json={
                "name": session.session_id,
                "config": webhook_config,
            })
            print(f"[WAHA] Sessão {session.session_id} criada no WAHA")
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (409, 422):
                # Sessão já existe → atualiza config com webhook
                try:
                    await waha_request("PUT", f"/api/sessions/{session.session_id}",
                                       json={"config": webhook_config})
                    print(f"[WAHA] Config atualizado para {session.session_id}")
                except Exception as pe:
                    print(f"[WAHA] Erro ao atualizar config: {pe}")
            else:
                raise

        # 2. Inicia a sessão (STOPPED → STARTING → SCAN_QR_CODE)
        try:
            await waha_request("POST", f"/api/sessions/{session.session_id}/start")
            print(f"[WAHA] Start enviado para {session.session_id}")
        except httpx.HTTPStatusError as e:
            # Ignora se já estiver iniciando/conectada
            print(f"[WAHA] Start retornou {e.response.status_code}: {e.response.text[:100]}")
            if e.response.status_code not in (409, 422):
                raise

        session.status = models.SessionStatus.connecting
        db.commit()

        # 3. Aguarda WAHA processar e tenta buscar QR
        import asyncio
        await asyncio.sleep(3)

        # Verifica status real do WAHA (pode já estar WORKING em reconexão)
        try:
            waha_data = await waha_request("GET", f"/api/sessions/{session.session_id}")
            waha_status = waha_data.get("status", "")
            if waha_status in ("WORKING", "CONNECTED"):
                session.status = models.SessionStatus.connected
        except Exception:
            pass

        try:
            qr_data = await waha_request("GET", f"/api/{session.session_id}/auth/qr")
            b64 = qr_data.get("data", "")
            if b64:
                session.qr_code = f"data:image/png;base64,{b64}"
                print(f"[WAHA] QR obtido para {session.session_id}")
        except Exception as exc:
            print(f"[WAHA] QR ainda não disponível: {type(exc).__name__}: {exc}")

        # 4. Se já conectado, busca número do telefone
        if session.status == models.SessionStatus.connected and not session.phone_number:
            try:
                me = await waha_request("GET", f"/api/{session.session_id}/me")
                raw = me.get("id", "") or me.get("phoneNumber", "")
                if raw:
                    session.phone_number = raw.split("@")[0].strip()
                    print(f"[WAHA] Número obtido no connect: {session.phone_number}")
            except Exception as exc:
                print(f"[WAHA] Erro ao buscar /me no connect: {exc}")

        db.commit()
        db.refresh(session)
        return {"qr_code": session.qr_code, "status": session.status.value}
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
        await waha_request("DELETE", f"/api/sessions/{session.session_id}")
    except Exception:
        pass  # ignora erro se já estiver desconectada/não existir

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
            "WORKING":      models.SessionStatus.connected,
            "CONNECTED":    models.SessionStatus.connected,   # alguns WAHA retornam este
            "SCAN_QR_CODE": models.SessionStatus.connecting,
            "STARTING":     models.SessionStatus.connecting,
            "STOPPED":      models.SessionStatus.disconnected,
            "FAILED":       models.SessionStatus.error,
        }
        new_status = status_map.get(waha_status)
        if new_status is None:
            # Status desconhecido — não sobrescreve o estado atual
            db.refresh(session)
            return {"status": session.status, "phone_number": session.phone_number}

        if new_status != session.status:
            session.status = new_status
            if new_status == models.SessionStatus.connected and not session.phone_number:
                try:
                    me = await waha_request("GET", f"/api/{session.session_id}/me")
                    raw = me.get("id", "") or me.get("phoneNumber", "")
                    if raw:
                        session.phone_number = raw.split("@")[0].strip()
                except Exception as exc:
                    print(f"[status] Erro ao buscar /me para {session.session_id}: {exc}")
                session.qr_code = None
            db.commit()
    except Exception as exc:
        print(f"[status] Erro ao checar status WAHA: {exc}")

    db.refresh(session)
    return {"status": session.status, "phone_number": session.phone_number}
