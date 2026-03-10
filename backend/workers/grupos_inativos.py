"""
Worker 5: Detecção de Grupos Inativos
- Cron: todo domingo às 10:00 BR
- Grupos sem extração há 30+ dias → is_active = False
- Grupos sem extração há 60+ dias → arquivado = True
- Loga relatório de grupos inativos por usuário
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import models
from database import get_db

logger = logging.getLogger(__name__)

BRAZIL_TZ = timedelta(hours=-3)
DIAS_INATIVO = 30
DIAS_ARQUIVADO = 60
_ultima_execucao: Optional[datetime] = None


def _hora_br() -> datetime:
    return datetime.now(timezone.utc) + BRAZIL_TZ


def _deve_executar() -> bool:
    global _ultima_execucao
    agora = _hora_br()
    # Domingo (weekday=6) às 10:00
    if agora.weekday() != 6 or agora.hour != 10:
        return False
    hoje = agora.date()
    if _ultima_execucao and _ultima_execucao.date() == hoje:
        return False
    _ultima_execucao = agora
    return True


async def _run_grupos_inativos():
    db_gen = get_db()
    db = next(db_gen)
    try:
        now = datetime.now(timezone.utc)
        limite_inativo = now - timedelta(days=DIAS_INATIVO)
        limite_arquivado = now - timedelta(days=DIAS_ARQUIVADO)

        grupos = db.query(models.Group).filter(
            models.Group.arquivado == False  # noqa: E712
        ).all()

        if not grupos:
            return

        logger.info(f"[GRUPOS INATIVOS] Verificando {len(grupos)} grupos...")

        # Agrupa por usuário para notificação
        grupos_por_usuario: dict[int, list] = {}
        inativados = 0
        arquivados = 0

        for grupo in grupos:
            last = grupo.last_extracted_at
            if last is None:
                continue
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)

            dias_sem_atividade = (now - last).days
            alterado = False

            if dias_sem_atividade >= DIAS_ARQUIVADO:
                if not grupo.arquivado:
                    grupo.arquivado = True
                    grupo.is_active = False
                    arquivados += 1
                    alterado = True
                    logger.info(f"[GRUPOS INATIVOS] 📁 Grupo '{grupo.name}' arquivado ({dias_sem_atividade}d sem atividade)")
            elif dias_sem_atividade >= DIAS_INATIVO:
                if grupo.is_active:
                    grupo.is_active = False
                    inativados += 1
                    alterado = True
                    logger.info(f"[GRUPOS INATIVOS] 💤 Grupo '{grupo.name}' marcado como inativo ({dias_sem_atividade}d sem atividade)")

            if alterado:
                grupos_por_usuario.setdefault(grupo.user_id, []).append(
                    f"- {grupo.name}: sem atividade há {dias_sem_atividade} dias"
                )

        db.commit()

        # Notificação por usuário
        for user_id, lista in grupos_por_usuario.items():
            desc = (
                f"📊 Grupos inativos detectados:\n" +
                "\n".join(lista[:10]) +
                (f"\n...e mais {len(lista) - 10}" if len(lista) > 10 else "") +
                "\nAcesse a página Grupos para gerenciá-los."
            )
            db.add(models.AtividadeLog(
                user_id=user_id,
                tipo="grupos_inativos_detectados",
                descricao=desc,
            ))
        db.commit()

        logger.info(
            f"[GRUPOS INATIVOS] ✅ Concluído: {inativados} inativados | {arquivados} arquivados"
        )
    except Exception as e:
        logger.error(f"[GRUPOS INATIVOS] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def grupos_inativos_worker_task():
    logger.info("[GRUPOS INATIVOS] Worker iniciado (cron: domingo 10:00 BR).")
    while True:
        try:
            if _deve_executar():
                logger.info("[GRUPOS INATIVOS] Iniciando verificação de grupos inativos...")
                await _run_grupos_inativos()
        except asyncio.CancelledError:
            logger.info("[GRUPOS INATIVOS] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[GRUPOS INATIVOS] Erro inesperado: {e}")
        await asyncio.sleep(1800)  # verifica a cada 30min
