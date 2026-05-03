"""
Score Calculator Worker — calcula grupo_score para todos os contatos
automaticamente em background, sem interação do usuário.

Ciclo:
1. Busca até BATCH_SIZE contatos sem score (ou com score > RECALC_DAYS dias)
2. Para cada usuário no batch, seleciona um chip disponível
3. Consulta WAHA /common-groups com delay gaussiano entre chamadas
4. Dorme CYCLE_SLEEP segundos quando não há contatos pendentes
"""
import asyncio
import logging
import random
from datetime import datetime, timezone, timedelta

import httpx

import models
from config import settings
from database import SessionLocal

logger = logging.getLogger(__name__)

BATCH_SIZE    = 50   # contatos por ciclo
RECALC_DAYS   = 7   # recalcular score a cada 7 dias
CYCLE_SLEEP   = 300 # segundos entre ciclos quando sem trabalho
DELAY_MEAN    = 2.0 # segundos de delay gaussiano (média)
DELAY_STD     = 0.8
DELAY_MIN     = 0.5

# Estado exposto para o endpoint /score-progress
worker_running: bool = False
current_user_id: int | None = None


def _pick_session(user_id: int, db) -> "models.WhatsAppSession | None":
    """Retorna sessão conectada com menor carga, fora de campanhas ativas."""
    try:
        busy_ids = (
            db.query(models.CampaignSession.session_id)
            .join(models.Campaign)
            .filter(
                models.Campaign.user_id == user_id,
                models.Campaign.status == models.CampaignStatus.running,
            )
            .subquery()
        )
        return (
            db.query(models.WhatsAppSession)
            .filter(
                models.WhatsAppSession.user_id == user_id,
                models.WhatsAppSession.status == models.SessionStatus.connected,
                ~models.WhatsAppSession.id.in_(busy_ids),
            )
            .order_by(models.WhatsAppSession.messages_sent_today.asc())
            .first()
        )
    except Exception:
        return None


async def score_calculator_worker_task():
    """Background task que roda continuamente calculando scores."""
    global worker_running, current_user_id

    logger.info("📊 Score Calculator worker iniciado.")
    await asyncio.sleep(90)  # aguarda startup completo

    while True:
        db = SessionLocal()
        try:
            recalc_cutoff = datetime.now(timezone.utc) - timedelta(days=RECALC_DAYS)

            batch = (
                db.query(models.Contact)
                .filter(
                    models.Contact.is_blacklisted == False,
                    models.Contact.is_invalid == False,
                    (
                        models.Contact.group_score.is_(None)
                        | (models.Contact.score_calculado_em < recalc_cutoff)
                    ),
                )
                .order_by(models.Contact.id.asc())
                .limit(BATCH_SIZE)
                .all()
            )

            if not batch:
                worker_running = False
                current_user_id = None
                await asyncio.sleep(CYCLE_SLEEP)
                continue

            worker_running = True

            # Agrupa por usuário para reusar o mesmo chip
            by_user: dict[int, list] = {}
            for c in batch:
                by_user.setdefault(c.user_id, []).append(c)

            headers: dict = {}
            if settings.WAHA_API_KEY:
                headers["X-Api-Key"] = settings.WAHA_API_KEY
            waha_url = settings.WAHA_API_URL.rstrip("/")

            for uid, contacts in by_user.items():
                current_user_id = uid
                session = _pick_session(uid, db)

                if not session:
                    # Nenhum chip disponível: marca como 0 e avança (não bloqueia fila)
                    for c in contacts:
                        c.group_score = 0
                        c.score_calculado_em = datetime.now(timezone.utc)
                    try:
                        db.commit()
                    except Exception:
                        db.rollback()
                    logger.info(f"📊 user={uid}: sem chip disponível — {len(contacts)} contatos marcados como 0")
                    continue

                sess_id = session.session_id
                processed = 0

                async with httpx.AsyncClient(timeout=10.0) as client:
                    for contact in contacts:
                        try:
                            phone_id = f"{contact.phone}@c.us"
                            url = f"{waha_url}/api/{sess_id}/contacts/{phone_id}/common-groups"
                            resp = await client.get(url, headers=headers)

                            if resp.status_code == 200:
                                data = resp.json()
                                if isinstance(data, list):
                                    count = len(data)
                                elif isinstance(data, dict):
                                    count = data.get("count") or len(data.get("groups", []))
                                else:
                                    count = 0
                            elif resp.status_code in (404, 501, 405):
                                count = 0  # WAHA não suporta endpoint
                            else:
                                count = 0
                        except Exception as exc:
                            logger.debug(f"📊 Erro {contact.phone}: {exc}")
                            count = 0

                        contact.whatsapp_common_groups = count
                        contact.group_score = count
                        contact.score_calculado_em = datetime.now(timezone.utc)
                        processed += 1

                        # Delay gaussiano anti-ban
                        delay = max(DELAY_MIN, random.gauss(DELAY_MEAN, DELAY_STD))
                        await asyncio.sleep(delay)

                try:
                    db.commit()
                    logger.info(f"📊 user={uid} via chip={sess_id}: {processed} scores calculados")
                except Exception:
                    db.rollback()

            # Pequena pausa entre batches para não saturar a CPU
            await asyncio.sleep(2)

        except asyncio.CancelledError:
            logger.info("📊 Score Calculator worker cancelado.")
            worker_running = False
            break
        except Exception as e:
            logger.error(f"📊 Score Calculator worker erro: {e}")
            worker_running = False
            await asyncio.sleep(60)
        finally:
            db.close()
