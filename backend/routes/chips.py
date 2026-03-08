from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import auth
import models
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
