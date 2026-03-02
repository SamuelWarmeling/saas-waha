from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date
from pydantic import BaseModel
from typing import List
from datetime import date, timedelta, timezone

import models
import auth
from database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

DAY_PT = {0: "Seg", 1: "Ter", 2: "Qua", 3: "Qui", 4: "Sex", 5: "Sáb", 6: "Dom"}


class ChartPoint(BaseModel):
    name: str
    enviados: int


class DashboardStats(BaseModel):
    chart: List[ChartPoint]
    total_contatos: int
    total_campanhas: int
    sessoes_ativas: int
    sessoes_total: int


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    uid = current_user.id

    # ── últimos 7 dias ────────────────────────────────────────────────────────
    today = date.today()
    seven_days_ago = today - timedelta(days=6)

    # Mensagens com status='sent' por dia nos últimos 7 dias
    rows = (
        db.query(
            cast(models.CampaignContact.sent_at, Date).label("day"),
            func.count().label("cnt"),
        )
        .join(models.Campaign, models.CampaignContact.campaign_id == models.Campaign.id)
        .filter(
            models.Campaign.user_id == uid,
            models.CampaignContact.status == models.ContactStatus.sent,
            models.CampaignContact.sent_at.isnot(None),
            cast(models.CampaignContact.sent_at, Date) >= seven_days_ago,
        )
        .group_by(cast(models.CampaignContact.sent_at, Date))
        .all()
    )

    counts_by_date = {r.day: r.cnt for r in rows}

    chart = []
    for i in range(7):
        d = seven_days_ago + timedelta(days=i)
        chart.append(ChartPoint(
            name=DAY_PT[d.weekday()],
            enviados=counts_by_date.get(d, 0),
        ))

    # ── totais ────────────────────────────────────────────────────────────────
    total_contatos = (
        db.query(func.count(models.Contact.id))
        .filter(models.Contact.user_id == uid)
        .scalar() or 0
    )

    total_campanhas = (
        db.query(func.count(models.Campaign.id))
        .filter(models.Campaign.user_id == uid)
        .scalar() or 0
    )

    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.user_id == uid)
        .all()
    )
    sessoes_ativas = sum(1 for s in sessoes if s.status == models.SessionStatus.connected)
    sessoes_total = len(sessoes)

    return DashboardStats(
        chart=chart,
        total_contatos=total_contatos,
        total_campanhas=total_campanhas,
        sessoes_ativas=sessoes_ativas,
        sessoes_total=sessoes_total,
    )
