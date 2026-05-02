"""
Rate Limiter por chip para disparos anti-ban.

Limites baseados no baileys-antiban:
  maxPerMinute: 8
  maxPerHour:   200
  maxPerDay:    1500

Usa sliding-window com deque para eficiência O(1).
"""
import time
from collections import defaultdict, deque

MAX_PER_MIN  = 8
MAX_PER_HOUR = 200
MAX_PER_DAY  = 1500

# session_waha_id -> deque de timestamps unix (float)
_min_buckets:  dict[str, deque] = defaultdict(deque)
_hour_buckets: dict[str, deque] = defaultdict(deque)
_day_buckets:  dict[str, deque] = defaultdict(deque)


def _clean(dq: deque, window: float) -> None:
    cutoff = time.time() - window
    while dq and dq[0] < cutoff:
        dq.popleft()


def can_send(session_id: str) -> tuple[bool, float]:
    """
    Verifica se o chip pode enviar agora.
    Retorna (True, 0.0) se pode; (False, wait_seconds) se deve esperar.
    """
    now = time.time()
    _clean(_min_buckets[session_id],  60)
    _clean(_hour_buckets[session_id], 3600)
    _clean(_day_buckets[session_id],  86400)

    if len(_day_buckets[session_id]) >= MAX_PER_DAY:
        oldest = _day_buckets[session_id][0]
        return False, max(0.0, oldest + 86400 - now)

    if len(_hour_buckets[session_id]) >= MAX_PER_HOUR:
        oldest = _hour_buckets[session_id][0]
        return False, max(0.0, oldest + 3600 - now)

    if len(_min_buckets[session_id]) >= MAX_PER_MIN:
        oldest = _min_buckets[session_id][0]
        return False, max(0.0, oldest + 60 - now)

    return True, 0.0


def record_send(session_id: str) -> None:
    """Registra um envio nos três contadores de janela deslizante."""
    now = time.time()
    _min_buckets[session_id].append(now)
    _hour_buckets[session_id].append(now)
    _day_buckets[session_id].append(now)


def get_stats(session_id: str) -> dict:
    """Retorna contadores atuais do chip para o endpoint antiban-stats."""
    _clean(_min_buckets[session_id],  60)
    _clean(_hour_buckets[session_id], 3600)
    _clean(_day_buckets[session_id],  86400)
    return {
        "msgs_minuto": len(_min_buckets[session_id]),
        "msgs_hora":   len(_hour_buckets[session_id]),
        "msgs_dia":    len(_day_buckets[session_id]),
        "limite_minuto": MAX_PER_MIN,
        "limite_hora":   MAX_PER_HOUR,
        "limite_dia":    MAX_PER_DAY,
    }
