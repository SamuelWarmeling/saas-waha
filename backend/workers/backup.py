"""
Worker 6: Backup Automático de Contatos
- Cron: todo domingo às 02:00 BR
- Exporta todos os contatos de cada usuário em CSV
- Salva em /backups/{user_id}/contatos_{data}.csv
- Mantém apenas os últimos 4 backups por usuário
- Registra em ContactBackup para download via API
"""
import asyncio
import csv
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import models
from database import get_db

logger = logging.getLogger(__name__)

BRAZIL_TZ = timedelta(hours=-3)
BACKUPS_DIR = Path("backups")
MAX_BACKUPS_POR_USUARIO = 4
_ultima_execucao: Optional[datetime] = None


def _hora_br() -> datetime:
    return datetime.now(timezone.utc) + BRAZIL_TZ


def _deve_executar() -> bool:
    global _ultima_execucao
    agora = _hora_br()
    # Domingo (weekday=6) às 02:00
    if agora.weekday() != 6 or agora.hour != 2:
        return False
    hoje = agora.date()
    if _ultima_execucao and _ultima_execucao.date() == hoje:
        return False
    _ultima_execucao = agora
    return True


def _exportar_csv(user_id: int, contatos: list[models.Contact]) -> tuple[Path, int]:
    """Cria CSV de contatos e retorna (caminho, contagem)."""
    user_dir = BACKUPS_DIR / str(user_id)
    user_dir.mkdir(parents=True, exist_ok=True)

    data_str = _hora_br().strftime("%Y-%m-%d")
    filepath = user_dir / f"contatos_{data_str}.csv"

    with open(filepath, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["Nome", "Telefone", "Tags", "Blacklist", "Inválido", "Criado em"])
        for c in contatos:
            writer.writerow([
                c.name or "",
                c.phone,
                c.tags or "",
                "Sim" if c.is_blacklisted else "Não",
                "Sim" if getattr(c, "is_invalid", False) else "Não",
                c.created_at.strftime("%Y-%m-%d") if c.created_at else "",
            ])

    return filepath, len(contatos)


def _limpar_backups_antigos(user_id: int, db) -> None:
    """Mantém apenas os últimos MAX_BACKUPS_POR_USUARIO backups."""
    backups = db.query(models.ContactBackup).filter(
        models.ContactBackup.user_id == user_id
    ).order_by(models.ContactBackup.created_at.desc()).all()

    for backup in backups[MAX_BACKUPS_POR_USUARIO:]:
        # Remove arquivo
        filepath = BACKUPS_DIR / str(user_id) / backup.filename
        try:
            if filepath.exists():
                filepath.unlink()
        except Exception:
            pass
        db.delete(backup)


async def _run_backup():
    db_gen = get_db()
    db = next(db_gen)
    try:
        BACKUPS_DIR.mkdir(exist_ok=True)

        # Busca usuários com contatos
        user_ids = [row[0] for row in db.query(models.Contact.user_id).distinct().all()]

        if not user_ids:
            return

        logger.info(f"[BACKUP] Iniciando backup de {len(user_ids)} usuários...")
        total_contatos = 0

        for user_id in user_ids:
            try:
                contatos = db.query(models.Contact).filter(
                    models.Contact.user_id == user_id,
                    models.Contact.is_blacklisted == False,  # noqa: E712
                ).all()

                if not contatos:
                    continue

                filepath, count = _exportar_csv(user_id, contatos)
                total_contatos += count

                # Registra no banco
                db.add(models.ContactBackup(
                    user_id=user_id,
                    filename=filepath.name,
                    contact_count=count,
                ))
                db.commit()

                # Remove backups antigos
                _limpar_backups_antigos(user_id, db)
                db.commit()

                db.add(models.AtividadeLog(
                    user_id=user_id,
                    tipo="backup_contatos",
                    descricao=f"💾 Backup criado: {count} contatos exportados ({filepath.name})",
                ))
                db.commit()

                logger.info(f"[BACKUP] ✅ User {user_id}: {count} contatos → {filepath.name}")

            except Exception as e:
                logger.error(f"[BACKUP] Erro ao fazer backup do user {user_id}: {e}")

        logger.info(f"[BACKUP] ✅ Concluído: {len(user_ids)} usuários | {total_contatos} contatos no total")
    except Exception as e:
        logger.error(f"[BACKUP] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def backup_worker_task():
    logger.info("[BACKUP] Worker iniciado (cron: domingo 02:00 BR).")
    while True:
        try:
            if _deve_executar():
                logger.info("[BACKUP] 💾 Iniciando backup semanal de contatos...")
                await _run_backup()
        except asyncio.CancelledError:
            logger.info("[BACKUP] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[BACKUP] Erro inesperado: {e}")
        await asyncio.sleep(1800)  # verifica a cada 30min
