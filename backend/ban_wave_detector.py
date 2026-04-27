"""
Ban Wave Detector — detecta ondas de ban do WhatsApp.

Se 3 ou mais chips tomarem ban em 1 hora, pausa TODAS as campanhas e
aquecimentos por 6 horas para evitar perdas em massa.
"""
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

BAN_WAVE_THRESHOLD = 3   # bans em 1 hora para detectar onda
PAUSE_HOURS = 6

# Lista de timestamps de bans recentes
_ban_events: list[datetime] = []
# Ate quando o sistema esta pausado por ban wave
_paused_until: datetime | None = None


def is_system_paused() -> bool:
    """Retorna True se o sistema esta pausado por ban wave detectada."""
    global _paused_until
    if _paused_until is None:
        return False
    if datetime.now(timezone.utc) >= _paused_until:
        logger.info("[BWD] Pausa de ban wave expirou. Sistema retomado.")
        _paused_until = None
        return False
    return True


def paused_until() -> datetime | None:
    """Retorna ate quando o sistema esta pausado, ou None."""
    if is_system_paused():
        return _paused_until
    return None


def record_ban(session_waha_id: str) -> bool:
    """
    Registra um chip banido. Retorna True se ativou uma ban wave pause.
    Chame quando o webhook receber status BANNED para uma sessao.
    """
    global _paused_until
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)

    # Remove eventos antigos
    _ban_events[:] = [t for t in _ban_events if t > one_hour_ago]
    _ban_events.append(now)

    count = len(_ban_events)
    logger.warning(f"[BWD] Chip banido: {session_waha_id} ({count} bans na ultima hora)")

    if count >= BAN_WAVE_THRESHOLD and not is_system_paused():
        _paused_until = now + timedelta(hours=PAUSE_HOURS)
        logger.critical(
            f"[BWD] BAN WAVE DETECTADA! {count} chips banidos em 1h. "
            f"Sistema pausado por {PAUSE_HOURS}h ate "
            f"{_paused_until.strftime('%Y-%m-%d %H:%M UTC')}."
        )
        return True

    return False


def get_status() -> dict:
    """Retorna status atual do detector para debug/dashboard."""
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    recent = [t for t in _ban_events if t > one_hour_ago]
    return {
        "bans_ultima_hora": len(recent),
        "threshold": BAN_WAVE_THRESHOLD,
        "sistema_pausado": is_system_paused(),
        "pausado_ate": _paused_until.isoformat() if _paused_until else None,
    }
