from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, cast, Date, text
from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import date, timedelta, datetime, timezone
import calendar

import models
import auth
from database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

DAY_PT = {0: "Seg", 1: "Ter", 2: "Qua", 3: "Qui", 4: "Sex", 5: "Sáb", 6: "Dom"}

DDD_ESTADO = {
    "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP",
    "16": "SP", "17": "SP", "18": "SP", "19": "SP",
    "21": "RJ", "22": "RJ", "24": "RJ",
    "27": "ES", "28": "ES",
    "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
    "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
    "47": "SC", "48": "SC", "49": "SC",
    "51": "RS", "53": "RS", "54": "RS", "55": "RS",
    "61": "DF", "62": "GO", "63": "TO", "64": "GO",
    "65": "MT", "66": "MT", "67": "MS", "68": "AC", "69": "RO",
    "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA",
    "79": "SE",
    "81": "PE", "82": "AL", "83": "PB", "84": "RN", "85": "CE", "86": "PI", "87": "PE", "88": "CE", "89": "PI",
    "91": "PA", "92": "AM", "93": "PA", "94": "PA", "95": "RR", "96": "AP", "97": "AM", "98": "MA", "99": "MA",
}


class ChartPoint(BaseModel):
    name: str
    enviados: int
    extraidos: int = 0


class DashboardStats(BaseModel):
    # Existentes
    chart: List[ChartPoint]
    total_contatos: int
    total_campanhas: int
    sessoes_ativas: int
    sessoes_total: int
    # Novos
    contatos_hoje: int
    contatos_ontem: int
    taxa_entrega: float      # % de mensagens com status=sent sobre total enviado
    taxa_erro: float
    sessoes_detalhes: List[Any]           # {id, name, phone_number, status}
    top_chip: Optional[Any]              # {name, phone_number, sent_mes, max_daily}
    campanhas_agendadas: List[Any]        # próximas campanhas scheduled
    top_ddds: List[Any]                  # [{ddd, estado, count}]


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    uid = current_user.id
    today = date.today()
    seven_days_ago = today - timedelta(days=6)
    yesterday = today - timedelta(days=1)

    # ── Chart: enviados e contatos extraídos por dia (últimos 7 dias) ─────────
    sent_rows = (
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
    sent_by_date = {r.day: r.cnt for r in sent_rows}

    extracted_rows = (
        db.query(
            cast(models.Contact.created_at, Date).label("day"),
            func.count().label("cnt"),
        )
        .filter(
            models.Contact.user_id == uid,
            cast(models.Contact.created_at, Date) >= seven_days_ago,
        )
        .group_by(cast(models.Contact.created_at, Date))
        .all()
    )
    extracted_by_date = {r.day: r.cnt for r in extracted_rows}

    chart = []
    for i in range(7):
        d = seven_days_ago + timedelta(days=i)
        chart.append(ChartPoint(
            name=DAY_PT[d.weekday()],
            enviados=sent_by_date.get(d, 0),
            extraidos=extracted_by_date.get(d, 0),
        ))

    # ── Totais ────────────────────────────────────────────────────────────────
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

    # ── Sessões ───────────────────────────────────────────────────────────────
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.user_id == uid)
        .all()
    )
    sessoes_ativas = sum(1 for s in sessoes if s.status == models.SessionStatus.connected)
    sessoes_total = len(sessoes)
    sessoes_detalhes = [
        {
            "id": s.id,
            "name": s.name,
            "phone_number": s.phone_number,
            "status": str(s.status.value if hasattr(s.status, "value") else s.status),
        }
        for s in sessoes
    ]

    # ── Contatos hoje e ontem ─────────────────────────────────────────────────
    contatos_hoje = (
        db.query(func.count(models.Contact.id))
        .filter(
            models.Contact.user_id == uid,
            cast(models.Contact.created_at, Date) == today,
        )
        .scalar() or 0
    )
    contatos_ontem = (
        db.query(func.count(models.Contact.id))
        .filter(
            models.Contact.user_id == uid,
            cast(models.Contact.created_at, Date) == yesterday,
        )
        .scalar() or 0
    )

    # ── Taxa de entrega ───────────────────────────────────────────────────────
    sent_stats = (
        db.query(
            func.count().label("total"),
            func.count().filter(
                models.CampaignContact.status == models.ContactStatus.sent
            ).label("sucesso"),
            func.count().filter(
                models.CampaignContact.status == models.ContactStatus.failed
            ).label("falha"),
        )
        .join(models.Campaign, models.CampaignContact.campaign_id == models.Campaign.id)
        .filter(
            models.Campaign.user_id == uid,
            models.CampaignContact.sent_at.isnot(None),
        )
        .first()
    )
    total_env = sent_stats.total or 0
    taxa_entrega = round((sent_stats.sucesso / total_env * 100), 1) if total_env > 0 else 0.0
    taxa_erro = round((sent_stats.falha / total_env * 100), 1) if total_env > 0 else 0.0

    # ── Top chip do mês ───────────────────────────────────────────────────────
    first_of_month = today.replace(day=1)
    top_chip_row = (
        db.query(
            models.WhatsAppSession.id,
            models.WhatsAppSession.name,
            models.WhatsAppSession.phone_number,
            models.WhatsAppSession.max_daily_messages,
            func.count(models.CampaignContact.id).label("sent_mes"),
        )
        .join(models.CampaignContact, models.CampaignContact.session_id == models.WhatsAppSession.id)
        .join(models.Campaign, models.CampaignContact.campaign_id == models.Campaign.id)
        .filter(
            models.Campaign.user_id == uid,
            models.CampaignContact.sent_at.isnot(None),
            cast(models.CampaignContact.sent_at, Date) >= first_of_month,
        )
        .group_by(
            models.WhatsAppSession.id,
            models.WhatsAppSession.name,
            models.WhatsAppSession.phone_number,
            models.WhatsAppSession.max_daily_messages,
        )
        .order_by(func.count(models.CampaignContact.id).desc())
        .first()
    )
    top_chip = None
    if top_chip_row:
        top_chip = {
            "name": top_chip_row.name,
            "phone_number": top_chip_row.phone_number,
            "sent_mes": top_chip_row.sent_mes,
            "max_daily": top_chip_row.max_daily_messages or 200,
        }

    # ── Próximas campanhas agendadas ──────────────────────────────────────────
    try:
        camp_agend = (
            db.query(models.Campaign)
            .filter(
                models.Campaign.user_id == uid,
                models.Campaign.status == models.CampaignStatus.scheduled,
            )
            .order_by(models.Campaign.scheduled_at.asc())
            .limit(5)
            .all()
        )
    except Exception:
        camp_agend = []

    campanhas_agendadas = [
        {
            "id": c.id,
            "name": c.name,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "total_contacts": c.total_contacts,
        }
        for c in camp_agend
    ]

    # ── Top DDDs ──────────────────────────────────────────────────────────────
    ddd_rows = db.execute(
        text(
            "SELECT SUBSTRING(phone FROM 3 FOR 2) AS ddd, COUNT(*) AS cnt "
            "FROM contacts "
            "WHERE user_id = :uid AND LENGTH(phone) >= 12 "
            "GROUP BY ddd ORDER BY cnt DESC LIMIT 10"
        ),
        {"uid": uid},
    ).fetchall()

    max_ddd_count = ddd_rows[0].cnt if ddd_rows else 1
    top_ddds = [
        {
            "ddd": r.ddd,
            "estado": DDD_ESTADO.get(r.ddd, "?"),
            "count": r.cnt,
            "pct": round(r.cnt / max_ddd_count * 100),
        }
        for r in ddd_rows
    ]

    return DashboardStats(
        chart=chart,
        total_contatos=total_contatos,
        total_campanhas=total_campanhas,
        sessoes_ativas=sessoes_ativas,
        sessoes_total=sessoes_total,
        contatos_hoje=contatos_hoje,
        contatos_ontem=contatos_ontem,
        taxa_entrega=taxa_entrega,
        taxa_erro=taxa_erro,
        sessoes_detalhes=sessoes_detalhes,
        top_chip=top_chip,
        campanhas_agendadas=campanhas_agendadas,
        top_ddds=top_ddds,
    )
