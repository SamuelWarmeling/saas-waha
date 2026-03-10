"""
Worker 2: Rotação Automática de Chips
- Loop a cada 1 minuto
- Monitora campanhas em execução
- Quando chip atinge 90% do limite diário: loga e verifica alternativa
- Se todos chips esgotados: pausa campanha + loga
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta

import models
from database import get_db

logger = logging.getLogger(__name__)

INTERVALO_WORKER = 60    # 1 minuto
LIMIAR_ROTACAO = 0.90    # 90%

# Campanha → chips já notificados (evita spam de logs)
_chips_notificados: dict[int, set] = {}


async def _run_rotacao():
    db_gen = get_db()
    db = next(db_gen)
    try:
        campanhas_ativas = db.query(models.Campaign).filter(
            models.Campaign.status == models.CampaignStatus.running
        ).all()

        if not campanhas_ativas:
            return

        for campaign in campanhas_ativas:
            try:
                # Sessões atribuídas à campanha
                camp_sessions = db.query(models.CampaignSession).filter(
                    models.CampaignSession.campaign_id == campaign.id
                ).all()
                session_ids = [cs.session_id for cs in camp_sessions]
                if not session_ids:
                    continue

                sessoes = db.query(models.WhatsAppSession).filter(
                    models.WhatsAppSession.id.in_(session_ids),
                    models.WhatsAppSession.status == models.SessionStatus.connected,
                ).all()

                notificados = _chips_notificados.setdefault(campaign.id, set())
                chips_disponiveis = []
                chips_saturados = []

                for s in sessoes:
                    limite = s.max_daily_messages or 200
                    uso = s.messages_sent_today or 0
                    pct = uso / limite if limite > 0 else 1.0

                    if pct >= 1.0:
                        chips_saturados.append(s)
                    elif pct >= LIMIAR_ROTACAO:
                        # Chip próximo do limite — loga uma vez
                        if s.id not in notificados:
                            notificados.add(s.id)
                            # Busca chip alternativo
                            user_sessoes = db.query(models.WhatsAppSession).filter(
                                models.WhatsAppSession.user_id == campaign.user_id,
                                models.WhatsAppSession.status == models.SessionStatus.connected,
                                models.WhatsAppSession.id.notin_(session_ids),
                                models.WhatsAppSession.messages_sent_today < models.WhatsAppSession.max_daily_messages,
                            ).first()

                            if user_sessoes:
                                logger.info(
                                    f"[ROTAÇÃO] 🔄 Chip '{s.name}' atingiu {pct:.0%} do limite "
                                    f"→ adicionando '{user_sessoes.name}' à campanha #{campaign.id}"
                                )
                                db.add(models.CampaignSession(
                                    campaign_id=campaign.id,
                                    session_id=user_sessoes.id,
                                ))
                                db.add(models.AtividadeLog(
                                    user_id=campaign.user_id,
                                    tipo="chip_rotacionado",
                                    descricao=(
                                        f"🔄 Chip '{s.name}' atingiu {pct:.0%} do limite diário → "
                                        f"rotacionando para '{user_sessoes.name}' (campanha: {campaign.name})"
                                    ),
                                ))
                                db.commit()
                            else:
                                logger.warning(
                                    f"[ROTAÇÃO] Chip '{s.name}' em {pct:.0%} mas sem chip alternativo disponível"
                                )
                    else:
                        chips_disponiveis.append(s)

                # Se TODOS os chips da campanha estão saturados (100%)
                if sessoes and all(
                    (s.messages_sent_today or 0) >= (s.max_daily_messages or 200)
                    for s in sessoes
                ):
                    logger.warning(
                        f"[ROTAÇÃO] Todos os chips da campanha #{campaign.id} "
                        f"'{campaign.name}' atingiram o limite diário. Pausando..."
                    )
                    campaign.status = models.CampaignStatus.paused
                    db.add(models.AtividadeLog(
                        user_id=campaign.user_id,
                        tipo="campanha_pausada_limite",
                        descricao=(
                            f"⏸️ Campanha '{campaign.name}' pausada: todos os chips atingiram "
                            "o limite diário. Será retomada automaticamente amanhã às 07:00."
                        ),
                    ))
                    db.commit()
                    _chips_notificados.pop(campaign.id, None)

            except Exception as e:
                logger.error(f"[ROTAÇÃO] Erro ao processar campanha {campaign.id}: {e}")

    except Exception as e:
        logger.error(f"[ROTAÇÃO] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def _resumir_campanhas_pausadas():
    """Retoma campanhas pausadas por limite diário após reset dos contadores (07:00 BR)."""
    now_br = datetime.now(timezone.utc) + timedelta(hours=-3)
    if now_br.hour != 7 or now_br.minute > 5:
        return

    db_gen = get_db()
    db = next(db_gen)
    try:
        camps_pausadas = db.query(models.Campaign).join(
            models.AtividadeLog,
            (models.AtividadeLog.user_id == models.Campaign.user_id) &
            (models.AtividadeLog.tipo == "campanha_pausada_limite"),
        ).filter(
            models.Campaign.status == models.CampaignStatus.paused
        ).all()

        for camp in camps_pausadas:
            # Verifica se há chips com capacidade
            camp_sessions = db.query(models.CampaignSession).filter(
                models.CampaignSession.campaign_id == camp.id
            ).all()
            session_ids = [cs.session_id for cs in camp_sessions]

            tem_chip = db.query(models.WhatsAppSession).filter(
                models.WhatsAppSession.id.in_(session_ids),
                models.WhatsAppSession.status == models.SessionStatus.connected,
                models.WhatsAppSession.messages_sent_today < models.WhatsAppSession.max_daily_messages,
            ).first()

            if tem_chip:
                camp.status = models.CampaignStatus.running
                db.add(models.AtividadeLog(
                    user_id=camp.user_id,
                    tipo="campanha_retomada",
                    descricao=f"▶️ Campanha '{camp.name}' retomada automaticamente às 07:00",
                ))
                db.commit()
                logger.info(f"[ROTAÇÃO] ▶️ Campanha '{camp.name}' retomada às 07:00")
    except Exception as e:
        logger.error(f"[ROTAÇÃO] Erro ao retomar campanhas: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def rotacao_worker_task():
    logger.info("[ROTAÇÃO] Worker iniciado (intervalo: 1min).")
    await asyncio.sleep(60)
    while True:
        try:
            await _run_rotacao()
            await _resumir_campanhas_pausadas()
        except asyncio.CancelledError:
            logger.info("[ROTAÇÃO] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[ROTAÇÃO] Erro inesperado: {e}")
        await asyncio.sleep(INTERVALO_WORKER)
