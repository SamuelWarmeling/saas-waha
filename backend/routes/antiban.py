"""
Endpoint GET /api/antiban/status
Expõe o estado em tempo real de todas as proteções anti-ban do sistema.
"""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import auth
import models
import ban_wave_detector
import circuit_breaker
import health_monitor
from database import get_db

router = APIRouter(prefix="/api/antiban", tags=["Anti-Ban"])

_PROTECOES = [
    "Content Variator",
    "Gaussian Jitter",
    "Circuit Breaker",
    "Health Monitor",
    "Ban Wave Detector",
    "Opt-out Automático",
]


@router.get("/status")
def antiban_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna o estado em tempo real de todas as proteções anti-ban."""

    # ── Circuit Breaker ───────────────────────────────────────────────────────
    open_circuits = circuit_breaker.get_all_open_circuits()
    reconnect_counts = circuit_breaker.get_reconnect_counts()

    # ── Health Monitor ────────────────────────────────────────────────────────
    chips_em_risco = health_monitor.get_chips_em_risco()
    all_scores = health_monitor.get_all_scores()

    # ── Ban Wave ──────────────────────────────────────────────────────────────
    bw = ban_wave_detector.get_status()

    # ── Block Rate (últimas 24h via DB para o usuário atual) ──────────────────
    one_day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    agg = db.query(
        func.coalesce(func.sum(models.Campaign.success_count), 0).label("ok"),
        func.coalesce(func.sum(models.Campaign.fail_count), 0).label("fail"),
    ).filter(
        models.Campaign.user_id == current_user.id,
        models.Campaign.started_at >= one_day_ago,
    ).first()

    total_sent = (agg.ok or 0) + (agg.fail or 0)
    block_rate = round((agg.fail or 0) / total_sent * 100, 1) if total_sent > 0 else 0.0

    # ── Bans hoje (do detector global, não por usuário) ───────────────────────
    bans_hoje = bw.get("bans_ultima_hora", 0)

    # ── Proteções ativas ──────────────────────────────────────────────────────
    protecoes_ativas = len(_PROTECOES)  # todas sempre ativas por código

    return {
        "content_variator": True,
        "gaussian_jitter": True,
        "circuit_breaker": {
            "ativo": True,
            "chips_pausados": open_circuits,
            "reconexoes_ultima_hora": reconnect_counts,
        },
        "health_monitor": {
            "ativo": True,
            "chips_em_risco": chips_em_risco,
            "scores": all_scores,
        },
        "ban_wave": bw,
        "block_rate_medio": block_rate,
        "bans_hoje": bans_hoje,
        "protecoes_ativas": protecoes_ativas,
        "protecoes_lista": _PROTECOES,
    }
