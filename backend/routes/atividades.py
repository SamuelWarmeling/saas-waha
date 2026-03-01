from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

import models
import auth
from database import get_db

router = APIRouter(prefix="/api/atividades", tags=["Atividades"])


class AtividadeOut(BaseModel):
    id: int
    tipo: str
    descricao: str
    criado_em: datetime

    class Config:
        from_attributes = True


@router.get("", response_model=List[AtividadeOut])
def list_atividades(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    logs = (
        db.query(models.AtividadeLog)
        .filter(models.AtividadeLog.user_id == current_user.id)
        .order_by(models.AtividadeLog.criado_em.desc())
        .limit(20)
        .all()
    )
    return logs
