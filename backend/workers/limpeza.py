"""
Worker 3: Limpeza Automática de Números
- Cron: toda segunda-feira às 03:00 BR
- Verifica via WAHA se números ainda existem no WhatsApp
- Marca contact.is_invalid = True se o número não existe
- Processa em lotes de 100 usando o chip com menor carga
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import models
from database import get_db
from config import settings

logger = logging.getLogger(__name__)

BRAZIL_TZ = timedelta(hours=-3)
LOTE = 100
_ultima_execucao: Optional[datetime] = None


def _hora_br() -> datetime:
    return datetime.now(timezone.utc) + BRAZIL_TZ


def _deve_executar() -> bool:
    global _ultima_execucao
    agora = _hora_br()
    # Segunda-feira (weekday=0) às 03:00
    if agora.weekday() != 0 or agora.hour != 3:
        return False
    # Evita executar mais de uma vez no mesmo dia
    hoje = agora.date()
    if _ultima_execucao and _ultima_execucao.date() == hoje:
        return False
    _ultima_execucao = agora
    return True


def _headers_waha():
    h = {"Accept": "application/json"}
    if settings.WAHA_API_KEY:
        h["X-Api-Key"] = settings.WAHA_API_KEY
    return h


async def _numero_existe_waha(session_id_waha: str, phone: str) -> Optional[bool]:
    """Verifica se o número existe no WhatsApp. None = não conseguiu verificar."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{settings.WAHA_API_URL}/api/{session_id_waha}/contacts/check",
                headers=_headers_waha(),
                params={"phone": f"{phone}@c.us"},
            )
            if resp.status_code == 200:
                data = resp.json()
                return bool(data.get("numberExists", data.get("exists", True)))
            return None  # endpoint não disponível / erro
    except Exception as e:
        logger.debug(f"[LIMPEZA] Erro ao verificar {phone}: {e}")
        return None


async def _run_limpeza():
    db_gen = get_db()
    db = next(db_gen)
    try:
        # Usa chip com menor carga
        chip = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
        ).order_by(models.WhatsAppSession.messages_sent_today.asc()).first()

        if not chip:
            logger.warning("[LIMPEZA] Nenhum chip conectado disponível para verificação")
            return

        logger.info(f"[LIMPEZA] Iniciando verificação semanal com chip '{chip.name}'")

        # Contatos não marcados como inválidos ou blacklisted
        contatos = db.query(models.Contact).filter(
            models.Contact.is_invalid == False,  # noqa: E712
            models.Contact.is_blacklisted == False,  # noqa: E712
        ).all()

        total = len(contatos)
        invalidos = 0
        erros = 0

        for i in range(0, total, LOTE):
            lote = contatos[i:i + LOTE]
            for contato in lote:
                try:
                    existe = await _numero_existe_waha(chip.session_id, contato.phone)
                    if existe is False:
                        contato.is_invalid = True
                        invalidos += 1
                        logger.info(f"[LIMPEZA] ❌ {contato.phone} marcado como inválido")
                    elif existe is None:
                        erros += 1
                except Exception as e:
                    logger.error(f"[LIMPEZA] Erro ao verificar contato {contato.id}: {e}")
                    erros += 1
                await asyncio.sleep(0.5)  # evita flood

            db.commit()
            logger.info(f"[LIMPEZA] Lote {i // LOTE + 1}: {min(i + LOTE, total)}/{total} processados")

        # Log por usuário
        user_ids = {c.user_id for c in contatos if c.is_invalid}
        for uid in user_ids:
            db.add(models.AtividadeLog(
                user_id=uid,
                tipo="limpeza_semanal",
                descricao=f"🧹 Limpeza semanal: {invalidos} números inválidos encontrados de {total} verificados",
            ))
        db.commit()

        logger.info(
            f"[LIMPEZA] ✅ Concluído: {total} verificados | {invalidos} inválidos | {erros} erros"
        )
    except Exception as e:
        logger.error(f"[LIMPEZA] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def limpeza_worker_task():
    logger.info("[LIMPEZA] Worker iniciado (cron: segunda 03:00 BR).")
    while True:
        try:
            if _deve_executar():
                logger.info("[LIMPEZA] 🧹 Iniciando limpeza semanal de números...")
                await _run_limpeza()
        except asyncio.CancelledError:
            logger.info("[LIMPEZA] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[LIMPEZA] Erro inesperado: {e}")
        await asyncio.sleep(1800)  # verifica a cada 30min
