from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import auth
import models
import circuit_breaker as cb
import health_monitor as hm
import ban_wave_detector as bwd
from database import get_db
from fuzzy_chip import calcular_saude_chip, calcular_risco_ban, _FUZZY_CONFIG

router = APIRouter(prefix="/api/chips", tags=["Chips"])


@router.get("/diagnostico")
def diagnostico_chips(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna diagnóstico fuzzy (score, label, razão) de todos os chips do usuário."""
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.user_id == current_user.id,
            models.WhatsAppSession.is_active == True,
        )
        .all()
    )
    return [calcular_saude_chip(s) for s in sessoes]


@router.get("/risco")
def risco_chips(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna score de risco de ban (0-100) para todas as sessões ativas do usuário."""
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.user_id  == current_user.id,
            models.WhatsAppSession.is_active == True,
        )
        .all()
    )
    return [calcular_risco_ban(s, db) for s in sessoes]


@router.get("/inteligencia")
def inteligencia_chips(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna estatísticas do aprendizado coletivo de bans e thresholds atuais."""
    total_bans_global = db.query(models.BanRecord).count()
    total_bans_usuario = (
        db.query(models.BanRecord)
        .filter(models.BanRecord.user_id == current_user.id)
        .count()
    )

    cfg = db.query(models.FuzzyConfig).filter(models.FuzzyConfig.user_id.is_(None)).first()

    high_atual = cfg.high_threshold if cfg else _FUZZY_CONFIG.get("high_threshold", 70.0)
    med_atual  = cfg.med_threshold  if cfg else _FUZZY_CONFIG.get("med_threshold",  40.0)
    peso_atual = cfg.peso_risco     if cfg else _FUZZY_CONFIG.get("peso_risco",       0.0)

    ultima_recalibracao = None
    if cfg and cfg.atualizado_em:
        ultima_recalibracao = cfg.atualizado_em.isoformat()

    # Precisão estimada: % dos últimos 50 bans que tinham score <= 60 (sistema "avisou")
    records = (
        db.query(models.BanRecord)
        .order_by(models.BanRecord.criado_em.desc())
        .limit(50)
        .all()
    )
    warned = sum(1 for r in records if (r.score_momento or 100.0) <= 60.0)
    precisao_pct = round((warned / len(records) * 100) if records else 0)

    proxima_em = 10 - (total_bans_global % 10) if total_bans_global % 10 != 0 else 10

    return {
        "total_bans_global":   total_bans_global,
        "total_bans_usuario":  total_bans_usuario,
        "thresholds_iniciais": {"high": 70.0, "med": 40.0, "peso_risco": 0.0},
        "thresholds_atuais":   {"high": high_atual, "med": med_atual, "peso_risco": peso_atual},
        "ultima_recalibracao": ultima_recalibracao,
        "precisao_estimada_pct": precisao_pct,
        "total_calibracoes":   (cfg.total_bans_calibracao // 10) if cfg else 0,
        "proxima_recalibracao_em_bans": proxima_em,
    }


@router.get("/health-dashboard")
def health_dashboard(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Dashboard completo de saúde dos chips: health score, circuit breaker, block rate, reconexões."""
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.user_id == current_user.id,
            models.WhatsAppSession.is_active == True,
        )
        .all()
    )

    open_circuits = {c["session_id"]: c for c in cb.get_all_open_circuits()}
    reconnect_counts = cb.get_reconnect_counts()
    bw = bwd.get_status()
    one_day_ago = datetime.now(timezone.utc) - timedelta(hours=24)

    chips_out = []
    total_score = 0

    for s in sessoes:
        health_score = hm.get_score(s.session_id)
        action = hm.get_action(s.session_id)
        paused_info = open_circuits.get(s.session_id)
        reconnects = reconnect_counts.get(s.session_id, 0)
        total_score += health_score

        ok_count = (
            db.query(models.CampaignContact)
            .filter(
                models.CampaignContact.session_id == s.id,
                models.CampaignContact.sent_at >= one_day_ago,
                models.CampaignContact.status == models.ContactStatus.sent,
            )
            .count()
        )
        fail_count = (
            db.query(models.CampaignContact)
            .filter(
                models.CampaignContact.session_id == s.id,
                models.CampaignContact.sent_at >= one_day_ago,
                models.CampaignContact.status == models.ContactStatus.failed,
            )
            .count()
        )
        total_sent = ok_count + fail_count
        block_rate = round(fail_count / total_sent * 100, 1) if total_sent > 0 else 0.0

        last_cc = (
            db.query(models.CampaignContact.sent_at)
            .filter(
                models.CampaignContact.session_id == s.id,
                models.CampaignContact.sent_at.isnot(None),
            )
            .order_by(models.CampaignContact.sent_at.desc())
            .first()
        )

        chips_out.append({
            "id": s.id,
            "name": s.name,
            "phone_number": s.phone_number,
            "status": s.status,
            "health_score": health_score,
            "action": action,
            "circuit_aberto": paused_info is not None,
            "circuit_min_restantes": paused_info.get("minutos_restantes") if paused_info else None,
            "reconexoes_hora": reconnects,
            "block_rate": block_rate,
            "messages_sent_today": s.messages_sent_today,
            "max_daily_messages": s.max_daily_messages,
            "ultimo_envio": last_cc.sent_at if last_cc else None,
            "is_aquecido": s.is_aquecido,
        })

    avg_score = round(total_score / len(sessoes), 1) if sessoes else 0.0

    return {
        "chips": chips_out,
        "resumo": {
            "total_chips": len(sessoes),
            "score_medio": avg_score,
            "ban_wave": bw,
            "protecoes_ativas": 6,
        },
    }
