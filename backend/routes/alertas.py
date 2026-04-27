"""
Sistema de alertas em tempo real.

Tipos de alerta:
  ban_wave            - Onda de ban detectada
  chip_risco          - Chip com health score alto
  circuit_breaker     - Circuit breaker aberto
  block_rate          - Block rate alto em chip
  campanha_concluida  - Campanha finalizada
  lead_quente         - Lead quente respondeu
  trial_expirando     - Trial expirando em X dias
"""
from fastapi import APIRouter, Depends
from sqlalchemy import desc
from sqlalchemy.orm import Session

import auth
import models
from database import get_db

router = APIRouter(prefix="/api/alertas", tags=["Alertas"])


@router.get("")
def listar_alertas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna os últimos 50 alertas do usuário (mais recentes primeiro)."""
    alertas = (
        db.query(models.Alerta)
        .filter(models.Alerta.user_id == current_user.id)
        .order_by(desc(models.Alerta.criado_em))
        .limit(50)
        .all()
    )
    return [
        {
            "id": a.id,
            "tipo": a.tipo,
            "mensagem": a.mensagem,
            "lido": a.lido,
            "criado_em": a.criado_em,
        }
        for a in alertas
    ]


@router.post("/{alerta_id}/ler")
def marcar_lido(
    alerta_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Marca um alerta como lido."""
    a = db.query(models.Alerta).filter(
        models.Alerta.id == alerta_id,
        models.Alerta.user_id == current_user.id,
    ).first()
    if a:
        a.lido = True
        db.commit()
    return {"ok": True}


@router.post("/ler-todos")
def ler_todos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Marca todos os alertas do usuário como lidos."""
    db.query(models.Alerta).filter(
        models.Alerta.user_id == current_user.id,
        models.Alerta.lido == False,
    ).update({"lido": True})
    db.commit()
    return {"ok": True}


# ── Helper público — importável em qualquer módulo ────────────────────────────

def criar_alerta(db: Session, user_id: int, tipo: str, mensagem: str):
    """
    Cria um alerta para o usuário. Silencioso — nunca lança exceções.
    Uso: from routes.alertas import criar_alerta
    """
    try:
        db.add(models.Alerta(user_id=user_id, tipo=tipo, mensagem=mensagem))
        db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
