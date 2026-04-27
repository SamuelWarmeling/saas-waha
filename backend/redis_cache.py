"""
Redis cache com fallback automático para dicionário em memória.
O sistema nunca quebra por falta de Redis — sempre usa o fallback silenciosamente.

Uso:
    import redis_cache
    redis_cache.cache_set("key", value, ttl=300)
    redis_cache.cache_get("key")
    redis_cache.cache_incr("counter", ttl=86400)
"""
import json
import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "")

_redis = None
_mem: dict = {}


def _get():
    global _redis
    if _redis is not None:
        return _redis
    if not REDIS_URL:
        return None
    try:
        import redis as redis_lib
        c = redis_lib.from_url(
            REDIS_URL,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        c.ping()
        _redis = c
        logger.info("[REDIS] Conexão estabelecida.")
        return _redis
    except Exception as e:
        logger.warning(f"[REDIS] Indisponível ({e}) — usando fallback em memória.")
        return None


def cache_set(key: str, value: Any, ttl: int = 300) -> bool:
    """Salva valor no cache. Retorna True se usou Redis, False se usou memória."""
    r = _get()
    if r:
        try:
            r.setex(key, ttl, json.dumps(value, default=str))
            return True
        except Exception:
            pass
    _mem[key] = value
    return False


def cache_get(key: str) -> Optional[Any]:
    """Recupera valor do cache. Retorna None se não encontrado."""
    r = _get()
    if r:
        try:
            raw = r.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            pass
    return _mem.get(key)


def cache_incr(key: str, ttl: int = 86400) -> int:
    """Incrementa contador atômico. Útil para rate limiting e contadores diários."""
    r = _get()
    if r:
        try:
            val = r.incr(key)
            r.expire(key, ttl)
            return int(val)
        except Exception:
            pass
    _mem[key] = _mem.get(key, 0) + 1
    return _mem[key]


def cache_delete(key: str):
    """Remove chave do cache."""
    r = _get()
    if r:
        try:
            r.delete(key)
        except Exception:
            pass
    _mem.pop(key, None)


def cache_exists(key: str) -> bool:
    """Verifica se chave existe no cache."""
    r = _get()
    if r:
        try:
            return bool(r.exists(key))
        except Exception:
            pass
    return key in _mem


def is_redis_available() -> bool:
    """Verifica se Redis está disponível."""
    return _get() is not None
