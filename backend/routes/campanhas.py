from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
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
    message: str
    session_id: Optional[int] = None
    contact_ids: Optional[List[int]] = None  # None = todos os contatos
    delay_min: Optional[int] = 5
    delay_max: Optional[int] = 15
    media_url: Optional[str] = None


class CampaignOut(BaseModel):
    id: int
    name: str
    message: str
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


# ── Background task de disparo ────────────────────────────────────────────────
async def send_campaign(campaign_id: int, user_id: int):
    db = SessionLocal()
    try:
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
        if not campaign:
            return

        campaign.status = models.CampaignStatus.running
        campaign.started_at = datetime.now(timezone.utc)
        db.commit()

        session = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id == campaign.session_id
        ).first()

        if not session or session.status != models.SessionStatus.connected:
            campaign.status = models.CampaignStatus.cancelled
            db.commit()
            return

        pending_contacts = (
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
            for cc in pending_contacts:
                # Recarrega para checar se pausou/cancelou
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

                phone = contact.phone
                if not phone.endswith("@c.us"):
                    phone = f"{phone}@c.us"

                try:
                    payload = {
                        "session": session.session_id,
                        "chatId": phone,
                        "text": campaign.message,
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
                campaign.sent_count += 1
                session.messages_sent_today += 1
                db.commit()

                delay = random.uniform(session.delay_min, session.delay_max)
                await asyncio.sleep(delay)

        # Finaliza
        campaign = db.query(models.Campaign).filter(models.Campaign.id == campaign_id).first()
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
        db.query(models.Campaign)
        .filter(models.Campaign.user_id == current_user.id)
        .order_by(models.Campaign.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return campaigns


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    if data.session_id:
        session = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id == data.session_id,
            models.WhatsAppSession.user_id == current_user.id,
        ).first()
        if not session:
            raise HTTPException(status_code=404, detail="Sessão não encontrada")

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
        message=data.message,
        session_id=data.session_id,
        delay_min=data.delay_min,
        delay_max=data.delay_max,
        media_url=data.media_url,
        total_contacts=len(contacts),
    )
    db.add(campaign)
    db.flush()

    for contact in contacts:
        cc = models.CampaignContact(campaign_id=campaign.id, contact_id=contact.id)
        db.add(cc)

    db.commit()
    db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
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
    return campaign


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
        if campaign.total_contacts > 0
        else 0
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

    if not campaign.session_id:
        raise HTTPException(status_code=400, detail="Campanha sem sessão configurada")

    # Verifica limite diário do plano
    plan_info = PLANS.get(current_user.plan.value, {})
    max_daily = plan_info.get("max_daily_messages", 200)

    today_sent = (
        db.query(func.sum(models.CampaignContact.campaign_id))
        .join(models.Campaign)
        .filter(
            models.Campaign.user_id == current_user.id,
            models.CampaignContact.status == models.ContactStatus.sent,
            func.date(models.CampaignContact.sent_at) == func.current_date(),
        )
        .scalar() or 0
    )

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
