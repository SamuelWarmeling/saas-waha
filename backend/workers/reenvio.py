"""
Worker 4: Reenvio Automático de Erros
- Loop a cada 30 minutos
- Busca CampaignContacts com status=failed, retry_count < 2
- Aguarda 30 min após o erro antes de reenviar
- Reenvia usando chip diferente do original
- Máximo 2 tentativas por contato
- Após 2 falhas: mantém status=failed (falha permanente)
"""
import asyncio
import json
import logging
import random
from datetime import datetime, timezone, timedelta

import httpx
import models
from database import get_db
from config import settings

logger = logging.getLogger(__name__)

INTERVALO_WORKER = 1800   # 30 minutos
ESPERA_REENVIO = 1800     # 30 min após erro
MAX_RETRIES = 2


def _headers_waha():
    h = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.WAHA_API_KEY:
        h["X-Api-Key"] = settings.WAHA_API_KEY
    return h


async def _enviar_mensagem(session_id_waha: str, phone: str, text: str, media_url: str | None = None) -> bool:
    """Envia mensagem de texto (ou com mídia) via WAHA. Retorna True se sucesso."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            if media_url:
                resp = await client.post(
                    f"{settings.WAHA_API_URL}/api/{session_id_waha}/sendImage",
                    headers=_headers_waha(),
                    json={"chatId": f"{phone}@c.us", "file": {"url": media_url}, "caption": text or ""},
                )
            else:
                resp = await client.post(
                    f"{settings.WAHA_API_URL}/api/{session_id_waha}/sendText",
                    headers=_headers_waha(),
                    json={"chatId": f"{phone}@c.us", "text": text},
                )
            return resp.status_code == 201
    except Exception as e:
        logger.warning(f"[REENVIO] Falha ao enviar para {phone}: {e}")
        return False


async def _run_reenvio():
    db_gen = get_db()
    db = next(db_gen)
    try:
        agora = datetime.now(timezone.utc)
        janela = agora - timedelta(seconds=ESPERA_REENVIO)

        # Contatos com falha elegíveis para reenvio
        candidates = db.query(models.CampaignContact).filter(
            models.CampaignContact.status == models.ContactStatus.failed,
            models.CampaignContact.retry_count < MAX_RETRIES,
            models.CampaignContact.sent_at <= janela,
        ).limit(200).all()

        if not candidates:
            return

        logger.info(f"[REENVIO] {len(candidates)} mensagens elegíveis para reenvio")
        reenviadas = 0
        recuperadas = 0
        falhas_permanentes = 0

        for cc in candidates:
            try:
                contact = db.query(models.Contact).filter(
                    models.Contact.id == cc.contact_id
                ).first()
                campaign = db.query(models.Campaign).filter(
                    models.Campaign.id == cc.campaign_id
                ).first()

                if not contact or not campaign:
                    continue

                # Mensagem da campanha
                mensagens = db.query(models.CampaignMessage).filter(
                    models.CampaignMessage.campaign_id == campaign.id
                ).order_by(models.CampaignMessage.ordem).all()

                if mensagens:
                    msg_obj = random.choice(mensagens) if campaign.ordem_mensagens == "aleatorio" else mensagens[0]
                    texto = msg_obj.text or ""
                    media = msg_obj.media_url
                else:
                    texto = campaign.message or ""
                    media = campaign.media_url

                # Chip alternativo: diferente do original, conectado, com capacidade
                chip_original_id = cc.session_id
                chip_alt = db.query(models.WhatsAppSession).filter(
                    models.WhatsAppSession.user_id == campaign.user_id,
                    models.WhatsAppSession.status == models.SessionStatus.connected,
                    models.WhatsAppSession.id != chip_original_id,
                    models.WhatsAppSession.messages_sent_today < models.WhatsAppSession.max_daily_messages,
                ).first()

                if not chip_alt:
                    # Tenta mesmo chip se não há alternativa
                    chip_alt = db.query(models.WhatsAppSession).filter(
                        models.WhatsAppSession.id == chip_original_id,
                        models.WhatsAppSession.status == models.SessionStatus.connected,
                    ).first()

                if not chip_alt:
                    logger.debug(f"[REENVIO] Nenhum chip disponível para reenvio de cc#{cc.id}")
                    continue

                nova_tentativa = cc.retry_count + 1
                logger.info(
                    f"[REENVIO] 🔄 Reenviando para {contact.phone} "
                    f"via chip '{chip_alt.name}' (tentativa {nova_tentativa}/{MAX_RETRIES})"
                )

                sucesso = await _enviar_mensagem(chip_alt.session_id, contact.phone, texto, media)
                reenviadas += 1

                if sucesso:
                    cc.status = models.ContactStatus.sent
                    cc.session_id = chip_alt.id
                    cc.sent_at = agora
                    cc.error_message = None
                    cc.retry_count = nova_tentativa
                    chip_alt.messages_sent_today += 1
                    campaign.success_count = (campaign.success_count or 0) + 1
                    campaign.fail_count = max(0, (campaign.fail_count or 0) - 1)
                    recuperadas += 1
                    logger.info(f"[REENVIO] ✅ {contact.phone} recuperado na tentativa {nova_tentativa}")
                else:
                    cc.retry_count = nova_tentativa
                    cc.sent_at = agora
                    if nova_tentativa >= MAX_RETRIES:
                        cc.error_message = "Falha permanente após múltiplas tentativas"
                        falhas_permanentes += 1
                        logger.warning(f"[REENVIO] ❌ {contact.phone}: falha permanente após {MAX_RETRIES} tentativas")
                    else:
                        cc.error_message = f"Tentativa {nova_tentativa} falhou, aguardando reenvio"

                db.commit()
                await asyncio.sleep(random.uniform(2, 5))

            except Exception as e:
                logger.error(f"[REENVIO] Erro ao reenviar cc#{cc.id}: {e}")

        if reenviadas:
            logger.info(
                f"[REENVIO] ↩️ Resultado: {reenviadas} reenviadas | "
                f"{recuperadas} recuperadas | {falhas_permanentes} falhas permanentes"
            )

    except Exception as e:
        logger.error(f"[REENVIO] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def reenvio_worker_task():
    logger.info("[REENVIO] Worker iniciado (intervalo: 30min).")
    await asyncio.sleep(120)  # startup delay
    while True:
        try:
            await _run_reenvio()
        except asyncio.CancelledError:
            logger.info("[REENVIO] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[REENVIO] Erro inesperado: {e}")
        await asyncio.sleep(INTERVALO_WORKER)
