"""
Health Monitor para chips WhatsApp.

Rastreia score de risco por chip (0-100) com base em erros HTTP, desconexoes
e falhas de envio. Acima de 85: para o chip imediatamente.
"""
import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

# session_id (waha) -> score de risco acumulado (0-100)
_risk_scores: dict[str, int] = defaultdict(int)
# session_id -> lista de timestamps de desconexao (ultima hora)
_disconnect_history: dict[str, list[datetime]] = defaultdict(list)


def add_risk(session_waha_id: str, points: int, reason: str) -> int:
    """Adiciona pontos de risco. Retorna novo score."""
    _risk_scores[session_waha_id] = min(100, _risk_scores[session_waha_id] + points)
    score = _risk_scores[session_waha_id]
    logger.info(f"[HM] {session_waha_id} +{points}pts ({reason}) => score={score}")
    return score


def record_disconnect(session_waha_id: str) -> int:
    """Registra desconexao e adiciona risco. Retorna score atual."""
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)

    _disconnect_history[session_waha_id] = [
        t for t in _disconnect_history[session_waha_id] if t > one_hour_ago
    ]
    _disconnect_history[session_waha_id].append(now)

    score = add_risk(session_waha_id, 15, "desconexao")

    if len(_disconnect_history[session_waha_id]) >= 3:
        score = add_risk(session_waha_id, 30, "3+ desconexoes/hora")

    return score


def record_http_error(session_waha_id: str, status_code: int) -> int:
    """Registra erro HTTP do WAHA. Retorna score atual."""
    if status_code == 401:
        return add_risk(session_waha_id, 60, f"HTTP 401")
    elif status_code == 403:
        return add_risk(session_waha_id, 40, f"HTTP 403")
    elif status_code >= 500:
        return add_risk(session_waha_id, 10, f"HTTP {status_code}")
    return _risk_scores[session_waha_id]


def record_send_failure(session_waha_id: str) -> int:
    """Registra falha de envio de mensagem."""
    return add_risk(session_waha_id, 20, "mensagem falhou")


def get_score(session_waha_id: str) -> int:
    return _risk_scores.get(session_waha_id, 0)


def get_action(session_waha_id: str) -> str:
    """
    Retorna acao recomendada baseada no score:
    'normal' | 'slow_down' | 'alert' | 'stop'
    """
    score = get_score(session_waha_id)
    if score >= 85:
        return "stop"
    elif score >= 60:
        return "alert"
    elif score >= 30:
        return "slow_down"
    return "normal"


def get_delay_multiplier(session_waha_id: str) -> float:
    """
    Retorna multiplicador de delay baseado no score.
    -1.0 significa: parar o chip imediatamente.
    """
    score = get_score(session_waha_id)
    if score >= 85:
        return -1.0
    elif score >= 60:
        return 3.0
    elif score >= 30:
        return 1.5
    return 1.0


def reset_score(session_waha_id: str):
    """Reseta score de risco (ex: apos reconexao bem-sucedida e estavel)."""
    _risk_scores[session_waha_id] = 0
    logger.info(f"[HM] {session_waha_id} score resetado para 0")


def get_all_scores() -> dict[str, int]:
    """Retorna todos os scores de risco atuais (session_waha_id -> score)."""
    return {k: v for k, v in _risk_scores.items() if v > 0}


def get_chips_em_risco() -> list[dict]:
    """Retorna lista de chips com score > 0, ordenado pelo score desc."""
    return sorted(
        [
            {"session_id": sid, "score": score, "action": get_action(sid)}
            for sid, score in _risk_scores.items()
            if score > 0
        ],
        key=lambda x: x["score"],
        reverse=True,
    )
