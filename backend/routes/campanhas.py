import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, timezone
import httpx
import asyncio
import random
import io
import csv

import models
import auth
from database import get_db, SessionLocal
from config import settings, PLANS

router = APIRouter(prefix="/api/campanhas", tags=["Campanhas"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# ── Schemas ──────────────────────────────────────────────────────────────────

class MessageItem(BaseModel):
    tipo: str = "text"       # text | image | file | audio | buttons
    text: str = ""
    media_url: Optional[str] = None
    media_filename: Optional[str] = None
    botoes: Optional[List[dict]] = None


class CampaignCreate(BaseModel):
    name: str
    messages: Optional[List[str]] = None      # legado: lista de textos
    message_items: Optional[List[MessageItem]] = None  # novo: lista rica
    session_ids: List[int]
    contact_ids: Optional[List[int]] = None
    delay_min: Optional[int] = 3
    delay_max: Optional[int] = 8
    media_url: Optional[str] = None
    ordem_mensagens: Optional[str] = "aleatorio"
    scheduled_at: Optional[datetime] = None   # agendamento

    @field_validator("session_ids")
    @classmethod
    def validate_sessions(cls, v):
        if not v:
            raise ValueError("Selecione ao menos 1 sessão")
        return v

    def get_message_items(self) -> List[MessageItem]:
        """Retorna message_items normalizados (prioriza message_items, cai em messages)."""
        if self.message_items:
            return self.message_items
        if self.messages:
            items = []
            for m in self.messages:
                m = (m or "").strip()
                if m:
                    items.append(MessageItem(tipo="text", text=m))
            return items
        return []


class CampaignOut(BaseModel):
    id: int
    name: str
    message: Optional[str]
    messages: List[str] = []
    session_ids: List[int] = []
    status: str
    total_contacts: int
    sent_count: int
    success_count: int
    fail_count: int
    delay_min: int
    delay_max: int
    ordem_mensagens: str = "aleatorio"
    media_url: Optional[str]
    scheduled_at: Optional[datetime]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class CampaignProgress(BaseModel):
    id: int
    status: str
    total_contacts: int
    sent_count: int
    success_count: int
    fail_count: int
    percent: float


# ── Helpers ──────────────────────────────────────────────────────────────────

def _chips_ativos_count(user_id: int, db: Session) -> int:
    """Retorna o número de campanhas em execução ativa para o usuário."""
    return (
        db.query(models.Campaign)
        .filter(
            models.Campaign.user_id == user_id,
            models.Campaign.status == models.CampaignStatus.running,
        )
        .count()
    )


async def _start_next_queued(user_id: int):
    """Se houver slot livre, inicia a campanha mais antiga na fila do usuário."""
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            return
        limite = getattr(user, "chips_disparo_simultaneo", 3)
        em_uso = _chips_ativos_count(user_id, db)
        if em_uso >= limite:
            return
        queued = (
            db.query(models.Campaign)
            .filter(
                models.Campaign.user_id == user_id,
                models.Campaign.status == models.CampaignStatus.queued,
            )
            .order_by(models.Campaign.created_at.asc())
            .first()
        )
        if queued:
            asyncio.create_task(send_campaign(queued.id, user_id))
    finally:
        db.close()


def _load_campaign_q(db: Session):
    return db.query(models.Campaign).options(
        joinedload(models.Campaign.messages),
        joinedload(models.Campaign.campaign_sessions),
    )


def _campaign_out(c: models.Campaign) -> dict:
    msgs = sorted(c.messages, key=lambda m: m.ordem)
    message_texts = [m.text or "" for m in msgs] if msgs else ([c.message] if c.message else [])
    session_ids = [cs.session_id for cs in c.campaign_sessions]
    return {
        "id": c.id,
        "name": c.name,
        "message": c.message,
        "messages": message_texts,
        "session_ids": session_ids,
        "status": c.status,
        "total_contacts": c.total_contacts,
        "sent_count": c.sent_count,
        "success_count": c.success_count,
        "fail_count": c.fail_count,
        "delay_min": c.delay_min,
        "delay_max": c.delay_max,
        "ordem_mensagens": c.ordem_mensagens or "aleatorio",
        "media_url": c.media_url,
        "scheduled_at": c.scheduled_at,
        "created_at": c.created_at,
        "started_at": c.started_at,
        "completed_at": c.completed_at,
    }


async def _send_waha_message(
    client: httpx.AsyncClient,
    session_waha_id: str,
    phone: str,
    msg: models.CampaignMessage,
    headers: dict,
) -> tuple[str, str]:
    """
    Envia uma mensagem via WAHA de acordo com o tipo.
    Retorna (status_code_str, response_text).
    """
    base = settings.WAHA_API_URL
    chat_id = phone if phone.endswith("@c.us") else f"{phone}@c.us"
    payload_base = {"session": session_waha_id, "chatId": chat_id}
    tipo = getattr(msg, "tipo", None) or "text"

    def media_file_obj(url: str) -> dict:
        """Monta o objeto file para o WAHA com URL absoluta."""
        if url and url.startswith("/"):
            url = f"{settings.BACKEND_URL}{url}"
        return {"url": url}

    if tipo == "image":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendImage",
            json={**payload_base, "file": media_file_obj(url), "caption": msg.text or ""},
            headers=headers,
        )
    elif tipo == "file":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendFile",
            json={**payload_base, "file": {**media_file_obj(url), "filename": msg.media_filename or "arquivo"},
                  "caption": msg.text or ""},
            headers=headers,
        )
    elif tipo == "audio":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendVoice",
            json={**payload_base, "file": media_file_obj(url)},
            headers=headers,
        )
    elif tipo == "buttons":
        try:
            botoes = json.loads(msg.botoes or "[]")
        except Exception:
            botoes = []
        buttons_payload = []
        for b in botoes:
            if b.get("tipo") == "link":
                buttons_payload.append({"type": "url", "url": b.get("valor", ""), "title": b.get("texto", "")})
            else:
                buttons_payload.append({"type": "reply", "id": b.get("id", str(random.randint(1, 9999))), "title": b.get("texto", "")})
        resp = await client.post(
            f"{base}/api/sendButtons",
            json={**payload_base, "body": msg.text or "", "buttons": buttons_payload},
            headers=headers,
        )
    else:
        # text (default)
        resp = await client.post(
            f"{base}/api/sendText",
            json={**payload_base, "text": msg.text or ""},
            headers=headers,
        )

    return resp.status_code, resp.text


# ── Background task de disparo ────────────────────────────────────────────────

async def send_campaign(campaign_id: int, user_id: int):
    db = SessionLocal()
    try:
        campaign = db.query(models.Campaign).filter(
            models.Campaign.id == campaign_id
        ).first()
        if not campaign:
            return

        campaign.status = models.CampaignStatus.running
        campaign.started_at = datetime.now(timezone.utc)
        db.commit()

        # Configurações de disparo do usuário
        user = db.query(models.User).filter(models.User.id == user_id).first()
        user_delay_min = user.dispatch_delay_min if user else 5
        user_delay_max = user.dispatch_delay_max if user else 15

        # Mensagens
        db_msgs = db.query(models.CampaignMessage).filter(
            models.CampaignMessage.campaign_id == campaign_id
        ).order_by(models.CampaignMessage.ordem).all()

        if not db_msgs and campaign.message:
            # legado: cria mensagem in-memory
            db_msgs = [models.CampaignMessage(
                campaign_id=campaign_id, text=campaign.message, ordem=0, tipo="text"
            )]

        if not db_msgs:
            campaign.status = models.CampaignStatus.cancelled
            db.commit()
            return

        # Sessões
        camp_sess = db.query(models.CampaignSession).filter(
            models.CampaignSession.campaign_id == campaign_id
        ).all()
        session_ids = [cs.session_id for cs in camp_sess] if camp_sess else (
            [campaign.session_id] if campaign.session_id else []
        )
        if not session_ids:
            campaign.status = models.CampaignStatus.cancelled
            db.commit()
            return

        # Pré-carrega objetos de sessão para seleção fuzzy (atualizado in-memory a cada envio)
        from fuzzy_chip import selecionar_chip_inteligente
        sessoes_candidatas = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id.in_(session_ids)
        ).all()

        # Contatos pendentes
        pending = (
            db.query(models.CampaignContact)
            .filter(
                models.CampaignContact.campaign_id == campaign_id,
                models.CampaignContact.status == models.ContactStatus.pending,
            )
            .all()
        )

        ordem = campaign.ordem_mensagens or "aleatorio"
        headers = {}
        if settings.WAHA_API_KEY:
            headers["X-Api-Key"] = settings.WAHA_API_KEY

        async with httpx.AsyncClient(timeout=30.0) as client:
            for contact_index, cc in enumerate(pending):
                # Verificar pause/cancel
                campaign = db.query(models.Campaign).filter(
                    models.Campaign.id == campaign_id
                ).first()
                if campaign.status in (
                    models.CampaignStatus.paused,
                    models.CampaignStatus.cancelled,
                ):
                    break

                contact = cc.contact
                if contact.is_blacklisted:
                    cc.status = models.ContactStatus.skipped
                    db.commit()
                    continue

                # Escolher mensagem
                if ordem == "sequencial":
                    msg = db_msgs[contact_index % len(db_msgs)]
                else:
                    msg = random.choice(db_msgs)

                # Personalizar texto com {nome}
                if msg.text:
                    msg_copy = models.CampaignMessage.__new__(models.CampaignMessage)
                    msg_copy.__dict__.update(msg.__dict__)
                    msg_copy.text = msg.text.replace("{nome}", contact.name or "Cliente")
                    msg = msg_copy

                # Seleção fuzzy: escolhe o chip com melhor score de saúde
                used_session = selecionar_chip_inteligente(sessoes_candidatas)

                if not used_session:
                    cc.status = models.ContactStatus.failed
                    cc.error_message = "Nenhuma sessão disponível"
                    campaign.fail_count += 1
                    cc.sent_at = datetime.now(timezone.utc)
                    campaign.sent_count += 1
                    db.commit()
                    continue

                phone = contact.phone

                try:
                    status_code, resp_text = await _send_waha_message(
                        client, used_session.session_id, phone, msg, headers
                    )

                    if status_code == 201:
                        cc.status = models.ContactStatus.sent
                        campaign.success_count += 1
                        # Tentar extrair waha_message_id
                        try:
                            resp_json = json.loads(resp_text)
                            waha_id = resp_json.get("id") or resp_json.get("key", {}).get("id")
                            if waha_id:
                                cc.waha_message_id = str(waha_id)
                        except Exception:
                            pass
                    else:
                        cc.status = models.ContactStatus.failed
                        cc.error_message = resp_text[:200]
                        campaign.fail_count += 1

                except Exception as e:
                    cc.status = models.ContactStatus.failed
                    cc.error_message = str(e)[:200]
                    campaign.fail_count += 1

                cc.sent_at = datetime.now(timezone.utc)
                cc.session_id = used_session.id
                campaign.sent_count += 1
                used_session.messages_sent_today += 1
                db.commit()

                delay = random.uniform(user_delay_min, user_delay_max)
                await asyncio.sleep(delay)

        # Finaliza
        campaign = db.query(models.Campaign).filter(
            models.Campaign.id == campaign_id
        ).first()
        if campaign.status == models.CampaignStatus.running:
            campaign.status = models.CampaignStatus.completed
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()

        # Libera slot para próxima campanha na fila
        asyncio.create_task(_start_next_queued(user_id))

    finally:
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CampaignOut])
def list_campaigns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaigns = (
        _load_campaign_q(db)
        .filter(models.Campaign.user_id == current_user.id)
        .order_by(models.Campaign.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_campaign_out(c) for c in campaigns]


@router.post("/upload-media")
async def upload_media(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    """Faz upload de arquivo de mídia (imagem, PDF, áudio) para uso em campanhas."""
    # Determinar tipo de mídia pelo mimetype
    content_type = file.content_type or ""
    if content_type.startswith("image/"):
        tipo = "image"
    elif content_type.startswith("audio/"):
        tipo = "audio"
    elif content_type in ("application/pdf", "application/msword",
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                          "application/vnd.ms-excel",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
        tipo = "file"
    else:
        tipo = "file"

    # Salvar arquivo
    user_dir = UPLOAD_DIR / str(current_user.id)
    user_dir.mkdir(exist_ok=True)

    ext = Path(file.filename or "arquivo").suffix or ""
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = user_dir / filename

    content = await file.read()
    file_path.write_bytes(content)

    relative_url = f"/uploads/{current_user.id}/{filename}"
    return {
        "url": relative_url,
        "tipo": tipo,
        "filename": file.filename,
        "size": len(content),
    }


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    sessions = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id.in_(data.session_ids),
        models.WhatsAppSession.user_id == current_user.id,
    ).all()
    if not sessions:
        raise HTTPException(status_code=404, detail="Nenhuma sessão encontrada")

    if data.contact_ids:
        contacts = db.query(models.Contact).filter(
            models.Contact.id.in_(data.contact_ids),
            models.Contact.user_id == current_user.id,
            models.Contact.is_blacklisted == False,
        ).all()
    else:
        contacts = db.query(models.Contact).filter(
            models.Contact.user_id == current_user.id,
            models.Contact.is_blacklisted == False,
        ).all()

    if not contacts:
        raise HTTPException(status_code=400, detail="Nenhum contato válido para a campanha")

    message_items = data.get_message_items()
    if not message_items:
        raise HTTPException(status_code=400, detail="Adicione ao menos 1 mensagem")

    # Status inicial: agendada ou rascunho
    if data.scheduled_at:
        camp_status = models.CampaignStatus.scheduled
    else:
        camp_status = models.CampaignStatus.draft

    first_text = message_items[0].text if message_items else ""
    campaign = models.Campaign(
        user_id=current_user.id,
        name=data.name,
        message=first_text,
        session_id=sessions[0].id,
        delay_min=data.delay_min,
        delay_max=data.delay_max,
        media_url=data.media_url,
        ordem_mensagens=data.ordem_mensagens or "aleatorio",
        total_contacts=len(contacts),
        scheduled_at=data.scheduled_at,
        status=camp_status,
    )
    db.add(campaign)
    db.flush()

    # Mensagens ricas
    for i, item in enumerate(message_items):
        db.add(models.CampaignMessage(
            campaign_id=campaign.id,
            text=item.text,
            ordem=i,
            tipo=item.tipo,
            media_url=item.media_url,
            media_filename=item.media_filename,
            botoes=json.dumps(item.botoes) if item.botoes else None,
        ))

    for sess in sessions:
        db.add(models.CampaignSession(campaign_id=campaign.id, session_id=sess.id))

    for contact in contacts:
        db.add(models.CampaignContact(campaign_id=campaign.id, contact_id=contact.id))

    db.commit()
    db.refresh(campaign)

    c = _load_campaign_q(db).filter(models.Campaign.id == campaign.id).first()
    return _campaign_out(c)


@router.get("/slots")
def get_slots(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna uso atual de slots de disparo simultâneo."""
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    na_fila = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.user_id == current_user.id,
            models.Campaign.status == models.CampaignStatus.queued,
        )
        .count()
    )
    return {
        "em_uso": em_uso,
        "limite": limite,
        "disponiveis": max(0, limite - em_uso),
        "na_fila_count": na_fila,
    }


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    c = _load_campaign_q(db).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    return _campaign_out(c)


@router.get("/{campaign_id}/progresso", response_model=CampaignProgress)
def get_campaign_progress(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    percent = (
        (campaign.sent_count / campaign.total_contacts * 100)
        if campaign.total_contacts > 0 else 0
    )
    return CampaignProgress(
        id=campaign.id,
        status=campaign.status,
        total_contacts=campaign.total_contacts,
        sent_count=campaign.sent_count,
        success_count=campaign.success_count,
        fail_count=campaign.fail_count,
        percent=round(percent, 1),
    )


@router.get("/{campaign_id}/relatorio")
def get_campaign_report(
    campaign_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Relatório detalhado de uma campanha com breakdown por contato."""
    campaign = _load_campaign_q(db).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    # Resumo
    skipped_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.status == models.ContactStatus.skipped,
        )
        .scalar() or 0
    )
    delivered_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.delivered_at.isnot(None),
        )
        .scalar() or 0
    )
    read_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.read_at.isnot(None),
        )
        .scalar() or 0
    )

    # Detalhes por contato (paginado)
    total_rows = (
        db.query(func.count(models.CampaignContact.id))
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .scalar() or 0
    )
    rows = (
        db.query(models.CampaignContact)
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .order_by(models.CampaignContact.sent_at.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    contacts_out = []
    for cc in rows:
        contact = cc.contact
        session = cc.session
        contacts_out.append({
            "id": cc.id,
            "contact_id": cc.contact_id,
            "name": contact.name if contact else None,
            "phone": contact.phone if contact else None,
            "status": cc.status,
            "error_message": cc.error_message,
            "session_name": session.name if session else None,
            "sent_at": cc.sent_at,
            "delivered_at": cc.delivered_at,
            "read_at": cc.read_at,
        })

    msgs = sorted(campaign.messages, key=lambda m: m.ordem)
    message_items_out = [
        {
            "tipo": getattr(m, "tipo", "text") or "text",
            "text": m.text,
            "media_url": m.media_url,
            "media_filename": m.media_filename,
        }
        for m in msgs
    ]

    return {
        "id": campaign.id,
        "name": campaign.name,
        "status": campaign.status,
        "message_items": message_items_out,
        "summary": {
            "total": campaign.total_contacts,
            "sent": campaign.success_count,
            "failed": campaign.fail_count,
            "skipped": skipped_count,
            "delivered": delivered_count,
            "read": read_count,
        },
        "total_rows": total_rows,
        "page": page,
        "page_size": page_size,
        "contacts": contacts_out,
    }


@router.get("/{campaign_id}/relatorio/exportar")
def export_campaign_report(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Exporta relatório como CSV."""
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    rows = (
        db.query(models.CampaignContact)
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .order_by(models.CampaignContact.sent_at.desc().nullslast())
        .all()
    )

    output = io.StringIO()
    output.write("\ufeff")  # BOM
    writer = csv.writer(output)
    writer.writerow(["Nome", "Telefone", "Status", "Chip", "Enviado em", "Entregue em", "Lido em", "Erro"])
    for cc in rows:
        contact = cc.contact
        session = cc.session
        writer.writerow([
            contact.name if contact else "",
            contact.phone if contact else "",
            cc.status,
            session.name if session else "",
            cc.sent_at.strftime("%d/%m/%Y %H:%M") if cc.sent_at else "",
            cc.delivered_at.strftime("%d/%m/%Y %H:%M") if cc.delivered_at else "",
            cc.read_at.strftime("%d/%m/%Y %H:%M") if cc.read_at else "",
            cc.error_message or "",
        ])

    output.seek(0)
    filename = f"relatorio_{campaign.name}_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _resolve_session(campaign: models.Campaign, user_id: int, db: Session) -> models.Campaign:
    has_sessions = db.query(models.CampaignSession).filter(
        models.CampaignSession.campaign_id == campaign.id
    ).first()
    if has_sessions:
        return campaign

    if not campaign.session_id:
        connected = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.user_id == user_id,
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.is_active == True,
        ).first()
        if not connected:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma sessão WhatsApp conectada. Conecte uma sessão primeiro."
            )
        campaign.session_id = connected.id
        db.commit()
    return campaign


@router.post("/{campaign_id}/disparar")
async def fire_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (
        models.CampaignStatus.draft,
        models.CampaignStatus.paused,
        models.CampaignStatus.scheduled,
    ):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser disparada (status: {campaign.status})")
    campaign = _resolve_session(campaign, current_user.id, db)
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    if em_uso >= limite:
        campaign.status = models.CampaignStatus.queued
        db.commit()
        return {
            "message": f"Aguardando slot disponível ({em_uso}/{limite} em uso)",
            "campaign_id": campaign_id,
            "queued": True,
        }
    background_tasks.add_task(send_campaign, campaign_id, current_user.id)
    return {"message": "Disparo iniciado", "campaign_id": campaign_id}


@router.post("/{campaign_id}/iniciar")
async def start_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (
        models.CampaignStatus.draft,
        models.CampaignStatus.paused,
        models.CampaignStatus.scheduled,
    ):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser iniciada (status: {campaign.status})")
    campaign = _resolve_session(campaign, current_user.id, db)
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    if em_uso >= limite:
        campaign.status = models.CampaignStatus.queued
        db.commit()
        return {
            "message": f"Aguardando slot disponível ({em_uso}/{limite} em uso)",
            "campaign_id": campaign_id,
            "queued": True,
        }
    background_tasks.add_task(send_campaign, campaign_id, current_user.id)
    return {"message": "Campanha iniciada", "campaign_id": campaign_id}


@router.post("/{campaign_id}/pausar")
def pause_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status != models.CampaignStatus.running:
        raise HTTPException(status_code=400, detail="Campanha não está em execução")
    campaign.status = models.CampaignStatus.paused
    db.commit()
    return {"message": "Campanha pausada"}


@router.post("/{campaign_id}/parar")
def stop_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status in (models.CampaignStatus.completed, models.CampaignStatus.cancelled):
        raise HTTPException(status_code=400, detail="Campanha já finalizada")
    was_running = campaign.status == models.CampaignStatus.running
    campaign.status = models.CampaignStatus.cancelled
    campaign.completed_at = datetime.now(timezone.utc)
    db.commit()
    if was_running:
        asyncio.create_task(_start_next_queued(campaign.user_id))
    return {"message": "Campanha cancelada"}


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status == models.CampaignStatus.running:
        raise HTTPException(status_code=400, detail="Pare a campanha antes de deletar")
    db.delete(campaign)
    db.commit()
