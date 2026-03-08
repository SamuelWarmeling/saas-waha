from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import auth
import models
from database import get_db
from fuzzy_chip import calcular_saude_chip

router = APIRouter(prefix="/api/chips", tags=["Chips"])


@router.get("/diagnostico")
def diagnostico_chips(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna diagnóstico fuzzy (score, label, razão) de todos os chips do usuário."""
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.user_id == current_user.id,
            models.WhatsAppSession.is_active == True,
        )
        .all()
    )
    return [calcular_saude_chip(s) for s in sessoes]
