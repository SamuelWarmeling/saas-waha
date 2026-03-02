from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, timezone
import httpx
import asyncio
import random

import models
import auth
from database import get_db, SessionLocal
from config import settings, PLANS

router = APIRouter(prefix="/api/campanhas", tags=["Campanhas"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    messages: List[str]          # mínimo 1, máximo 10
    session_ids: List[int]       # mínimo 1 sessão
    contact_ids: Optional[List[int]] = None
    delay_min: Optional[int] = 3
    delay_max: Optional[int] = 8
    media_url: Optional[str] = None

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, v):
        v = [m.strip() for m in v]
        if not v or not any(v):
            raise ValueError("Mínimo 1 mensagem")
        if len(v) > 10:
            raise ValueError("Máximo 10 mensagens")
        for m in v:
            if not m:
                raise ValueError("Mensagem não pode estar vazia")
        return v

    @field_validator("session_ids")
    @classmethod
    def validate_sessions(cls, v):
        if not v:
            raise ValueError("Selecione ao menos 1 sessão")
        return v


class CampaignOut(BaseModel):
    id: int
    name: str
    message: Optional[str]       # legado
    messages: List[str] = []     # novo
    session_ids: List[int] = []  # novo
    status: str
    total_contacts: int
    sent_count: int
    success_count: int
    fail_count: int
    delay_min: int
    delay_max: int
    media_url: Optional[str]
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

def _load_campaign_q(db: Session):
    """Query base com eager load de messages e campaign_sessions."""
    return db.query(models.Campaign).options(
        joinedload(models.Campaign.messages),
        joinedload(models.Campaign.campaign_sessions),
    )


def _campaign_out(c: models.Campaign) -> dict:
    msgs = sorted(c.messages, key=lambda m: m.ordem)
    message_texts = [m.text for m in msgs] if msgs else ([c.message] if c.message else [])
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
        "media_url": c.media_url,
        "created_at": c.created_at,
        "started_at": c.started_at,
        "completed_at": c.completed_at,
    }


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

        # ── Mensagens ──────────────────────────────────────────────────────
        db_msgs = db.query(models.CampaignMessage).filter(
            models.CampaignMessage.campaign_id == campaign_id
        ).order_by(models.CampaignMessage.ordem).all()
        message_texts = [m.text for m in db_msgs] if db_msgs else (
            [campaign.message] if campaign.message else []
        )
        if not message_texts:
            campaign.status = models.CampaignStatus.cancelled
            db.commit()
            return

        # ── Sessões ────────────────────────────────────────────────────────
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

        # ── Contatos pendentes ─────────────────────────────────────────────
        pending = (
            db.query(models.CampaignContact)
            .filter(
                models.CampaignContact.campaign_id == campaign_id,
                models.CampaignContact.status == models.ContactStatus.pending,
            )
            .all()
        )

        headers = {}
        if settings.WAHA_API_KEY:
            headers["X-Api-Key"] = settings.WAHA_API_KEY

        async with httpx.AsyncClient(timeout=30.0) as client:
            for cc in pending:
                # Verificar se pausou/cancelou
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

                # ── Escolher mensagem aleatória ────────────────────────────
                text_template = random.choice(message_texts)
                text = text_template.replace("{nome}", contact.name or "Cliente")

                # ── Escolher sessão disponível (rodízio aleatório) ─────────
                available = random.sample(session_ids, len(session_ids))
                used_session = None
                for sid in available:
                    s = db.query(models.WhatsAppSession).filter(
                        models.WhatsAppSession.id == sid
                    ).first()
                    if s and s.status == models.SessionStatus.connected:
                        used_session = s
                        break

                if not used_session:
                    cc.status = models.ContactStatus.failed
                    cc.error_message = "Nenhuma sessão disponível"
                    campaign.fail_count += 1
                    cc.sent_at = datetime.now(timezone.utc)
                    campaign.sent_count += 1
                    db.commit()
                    continue

                phone = contact.phone
                if not phone.endswith("@c.us"):
                    phone = f"{phone}@c.us"

                try:
                    payload = {
                        "session": used_session.session_id,
                        "chatId": phone,
                        "text": text,
                    }
                    if campaign.media_url:
                        resp = await client.post(
                            f"{settings.WAHA_API_URL}/api/sendImage",
                            json={**payload, "file": {"url": campaign.media_url}},
                            headers=headers,
                        )
                    else:
                        resp = await client.post(
                            f"{settings.WAHA_API_URL}/api/sendText",
                            json=payload,
                            headers=headers,
                        )

                    if resp.status_code == 201:
                        cc.status = models.ContactStatus.sent
                        campaign.success_count += 1
                    else:
                        cc.status = models.ContactStatus.failed
                        cc.error_message = resp.text[:200]
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

                delay = random.uniform(
                    campaign.delay_min or used_session.delay_min,
                    campaign.delay_max or used_session.delay_max,
                )
                await asyncio.sleep(delay)

        # Finaliza
        campaign = db.query(models.Campaign).filter(
            models.Campaign.id == campaign_id
        ).first()
        if campaign.status == models.CampaignStatus.running:
            campaign.status = models.CampaignStatus.completed
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()

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


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    # Validar sessões
    sessions = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id.in_(data.session_ids),
        models.WhatsAppSession.user_id == current_user.id,
    ).all()
    if not sessions:
        raise HTTPException(status_code=404, detail="Nenhuma sessão encontrada")

    # Busca contatos
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

    campaign = models.Campaign(
        user_id=current_user.id,
        name=data.name,
        message=data.messages[0],      # legado: primeira mensagem
        session_id=sessions[0].id,     # legado: primeira sessão
        delay_min=data.delay_min,
        delay_max=data.delay_max,
        media_url=data.media_url,
        total_contacts=len(contacts),
    )
    db.add(campaign)
    db.flush()

    # Mensagens
    for i, text in enumerate(data.messages):
        db.add(models.CampaignMessage(
            campaign_id=campaign.id, text=text, ordem=i
        ))

    # Sessões
    for sess in sessions:
        db.add(models.CampaignSession(
            campaign_id=campaign.id, session_id=sess.id
        ))

    # Contatos
    for contact in contacts:
        db.add(models.CampaignContact(
            campaign_id=campaign.id, contact_id=contact.id
        ))

    db.commit()
    db.refresh(campaign)

    c = _load_campaign_q(db).filter(models.Campaign.id == campaign.id).first()
    return _campaign_out(c)


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


def _resolve_session(campaign: models.Campaign, user_id: int, db: Session) -> models.Campaign:
    """
    Para campanhas legado (sem CampaignSession), auto-seleciona uma sessão conectada.
    Campanhas novas já têm CampaignSession — retorna sem alterar.
    """
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
    if campaign.status not in (models.CampaignStatus.draft, models.CampaignStatus.paused):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser disparada (status: {campaign.status})")
    campaign = _resolve_session(campaign, current_user.id, db)
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
    if campaign.status not in (models.CampaignStatus.draft, models.CampaignStatus.paused):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser iniciada (status: {campaign.status})")
    campaign = _resolve_session(campaign, current_user.id, db)
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
    campaign.status = models.CampaignStatus.cancelled
    campaign.completed_at = datetime.now(timezone.utc)
    db.commit()
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
