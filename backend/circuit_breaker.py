"""
Circuit Breaker para reconexoes de chips WhatsApp.

Limita a 3 reconexoes por hora por chip.
Se exceder: pausa o chip por 2 horas para evitar ban por loop de reconexao.
"""
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

MAX_RECONNECTS_PER_HOUR = 3
PAUSE_HOURS = 2

# session_id (waha) -> lista de timestamps de reconexao
_reconnect_history: dict[str, list[datetime]] = defaultdict(list)
# session_id -> datetime ate quando o circuit esta aberto (chip pausado)
_circuit_open_until: dict[str, datetime] = {}


def record_reconnect(session_waha_id: str) -> bool:
    """
    Registra uma reconexao. Retorna True se o circuit abriu (chip deve ser pausado).
    Chame sempre que um chip mudar de status desconectado -> conectado.
    """
    now = datetime.now(timezone.utc)

    # Verifica se circuit ja esta aberto
    if session_waha_id in _circuit_open_until:
        if now < _circuit_open_until[session_waha_id]:
            remaining = (_circuit_open_until[session_waha_id] - now).seconds // 60
            logger.warning(
                f"[CB] {session_waha_id} circuit aberto — {remaining}min restantes"
            )
            return True
        # Expirou: reseta
        del _circuit_open_until[session_waha_id]
        _reconnect_history[session_waha_id] = []
        logger.info(f"[CB] {session_waha_id} circuit fechado (expirou). Reconectando normalmente.")

    # Remove historico com mais de 1 hora
    one_hour_ago = now - timedelta(hours=1)
    _reconnect_history[session_waha_id] = [
        t for t in _reconnect_history[session_waha_id] if t > one_hour_ago
    ]

    _reconnect_history[session_waha_id].append(now)
    count = len(_reconnect_history[session_waha_id])

    if count >= MAX_RECONNECTS_PER_HOUR:
        pause_until = now + timedelta(hours=PAUSE_HOURS)
        _circuit_open_until[session_waha_id] = pause_until
        logger.warning(
            f"[CB] Circuit aberto para {session_waha_id}: "
            f"{count} reconexoes em 1h. Pausado por {PAUSE_HOURS}h ate "
            f"{pause_until.strftime('%H:%M UTC')}."
        )
        return True

    logger.info(f"[CB] {session_waha_id} reconexao registrada ({count}/{MAX_RECONNECTS_PER_HOUR} na ultima hora)")
    return False


def is_circuit_open(session_waha_id: str) -> bool:
    """Retorna True se o chip esta com circuit aberto (nao deve reconectar agora)."""
    now = datetime.now(timezone.utc)
    if session_waha_id in _circuit_open_until:
        if now < _circuit_open_until[session_waha_id]:
            return True
        del _circuit_open_until[session_waha_id]
        _reconnect_history[session_waha_id] = []
    return False


def circuit_open_until(session_waha_id: str) -> datetime | None:
    """Retorna ate quando o circuit esta aberto, ou None se estiver fechado."""
    if is_circuit_open(session_waha_id):
        return _circuit_open_until.get(session_waha_id)
    return None


def get_all_open_circuits() -> list[dict]:
    """Retorna lista de chips com circuit aberto (pausados)."""
    now = datetime.now(timezone.utc)
    result = []
    for sid, until in list(_circuit_open_until.items()):
        if now < until:
            mins = int((until - now).total_seconds() / 60)
            result.append({
                "session_id": sid,
                "pausado_ate": until.isoformat(),
                "minutos_restantes": mins,
            })
    return result


def get_reconnect_counts() -> dict[str, int]:
    """Retorna contagem de reconexoes na ultima hora por chip."""
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)
    return {
        sid: len([t for t in times if t > one_hour_ago])
        for sid, times in _reconnect_history.items()
        if any(t > one_hour_ago for t in times)
    }
