"""
Worker 1: Reconexão Automática de Chip
- Loop a cada 2 minutos
- Verifica chips disconnected/error
- Tenta reconectar via WAHA POST /api/{session}/start
- Máximo 3 tentativas por hora por chip
- Após 3 falhas: notifica via WhatsApp usando outro chip conectado
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

import httpx
import models
from database import get_db
from config import settings

logger = logging.getLogger(__name__)

BRAZIL_TZ = timedelta(hours=-3)
INTERVALO_WORKER = 120       # 2 minutos
MAX_TENTATIVAS_HORA = 3


def _headers_waha():
    h = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.WAHA_API_KEY:
        h["X-Api-Key"] = settings.WAHA_API_KEY
    return h


async def _waha_post(path: str, json_body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{settings.WAHA_API_URL}{path}",
            headers=_headers_waha(),
            json=json_body or {},
        )
        return resp.json() if resp.content else {}


async def _waha_get(path: str, params: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{settings.WAHA_API_URL}{path}",
            headers=_headers_waha(),
            params=params or {},
        )
        return resp.json() if resp.content else {}


async def _tentar_reconectar(session: models.WhatsAppSession) -> bool:
    """Tenta iniciar sessão via WAHA. Retorna True se reconectou."""
    try:
        await _waha_post(f"/api/{session.session_id}/start")
        await asyncio.sleep(5)  # aguarda handshake
        data = await _waha_get(f"/api/{session.session_id}/status")
        status_val = data.get("status", "disconnected") if isinstance(data, dict) else "disconnected"
        return str(status_val).lower() in ("connected", "working")
    except Exception as e:
        logger.warning(f"[RECONEXÃO] Falha ao reconectar {session.session_id!r}: {e}")
        return False


async def _notificar_usuario(session: models.WhatsAppSession, db) -> None:
    """Envia WhatsApp usando outro chip do mesmo usuário para notificar falha."""
    if not session.phone_number:
        return

    chip_ok = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.user_id == session.user_id,
        models.WhatsAppSession.status == models.SessionStatus.connected,
        models.WhatsAppSession.id != session.id,
    ).first()

    if not chip_ok:
        return

    msg = (
        f"⚠️ Chip *{session.name}* não conseguiu reconectar após 3 tentativas.\n"
        "Acesse o site para escanear o QR Code."
    )
    try:
        await _waha_post(
            f"/api/{chip_ok.session_id}/sendText",
            {"chatId": f"{session.phone_number}@c.us", "text": msg},
        )
        logger.info(f"[RECONEXÃO] Notificação enviada para {session.phone_number}")
    except Exception as e:
        logger.warning(f"[RECONEXÃO] Não conseguiu enviar notificação: {e}")


async def _run_reconexao():
    db_gen = get_db()
    db = next(db_gen)
    try:
        now = datetime.now(timezone.utc)
        limite_hora = now - timedelta(hours=1)

        sessoes = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.status.in_([
                models.SessionStatus.disconnected,
                models.SessionStatus.error,
            ]),
            models.WhatsAppSession.is_active == True,  # noqa: E712
        ).all()

        for session in sessoes:
            try:
                ultima = session.reconexao_ultima_em
                if ultima and ultima.tzinfo is None:
                    ultima = ultima.replace(tzinfo=timezone.utc)

                # Reset contador se última tentativa foi há > 1h
                if session.reconexao_tentativas >= MAX_TENTATIVAS_HORA:
                    if ultima and ultima > limite_hora:
                        logger.debug(f"[RECONEXÃO] {session.name}: aguardando janela de 1h")
                        continue
                    # Passou 1h, reseta
                    session.reconexao_tentativas = 0

                session.reconexao_tentativas += 1
                session.reconexao_ultima_em = now
                db.commit()

                logger.info(
                    f"[RECONEXÃO] Tentando reconectar {session.name!r} "
                    f"(tentativa {session.reconexao_tentativas}/{MAX_TENTATIVAS_HORA})"
                )
                reconectou = await _tentar_reconectar(session)

                db.refresh(session)
                if reconectou:
                    session.status = models.SessionStatus.connected
                    session.reconexao_tentativas = 0
                    db.add(models.AtividadeLog(
                        user_id=session.user_id,
                        tipo="chip_reconectado",
                        descricao=f"✅ Chip '{session.name}' reconectado automaticamente",
                    ))
                    db.commit()
                    logger.info(f"[RECONEXÃO] ✅ {session.name} reconectado!")

                elif session.reconexao_tentativas >= MAX_TENTATIVAS_HORA:
                    db.add(models.AtividadeLog(
                        user_id=session.user_id,
                        tipo="chip_reconexao_falhou",
                        descricao=(
                            f"⚠️ Chip '{session.name}' falhou {MAX_TENTATIVAS_HORA} tentativas de reconexão. "
                            "Escaneie o QR Code manualmente."
                        ),
                    ))
                    db.commit()
                    await _notificar_usuario(session, db)
                    logger.warning(f"[RECONEXÃO] ❌ {session.name}: {MAX_TENTATIVAS_HORA} tentativas esgotadas")

            except Exception as e:
                logger.error(f"[RECONEXÃO] Erro ao processar sessão {session.id}: {e}")
    except Exception as e:
        logger.error(f"[RECONEXÃO] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def reconexao_worker_task():
    logger.info("[RECONEXÃO] Worker iniciado (intervalo: 2min).")
    await asyncio.sleep(30)  # startup delay
    while True:
        try:
            await _run_reconexao()
        except asyncio.CancelledError:
            logger.info("[RECONEXÃO] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[RECONEXÃO] Erro inesperado: {e}")
        await asyncio.sleep(INTERVALO_WORKER)
