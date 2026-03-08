from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session

import auth
import models
import ia_service
from database import get_db

router = APIRouter(prefix="/api/ia", tags=["IA"])


class IAConfigIn(BaseModel):
    gemini_api_key: Optional[str] = None
    gemini_habilitado: Optional[bool] = None


@router.get("/config")
def get_ia_config(
    current_user: models.User = Depends(auth.get_current_user),
):
    from config import settings
    tem_chave_servidor = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip())
    user_key = getattr(current_user, "gemini_api_key", None)
    habilitado = getattr(current_user, "gemini_habilitado", True)
    chave_parcial = None
    if user_key:
        k = user_key.strip()
        chave_parcial = k[:8] + "..." + k[-4:] if len(k) > 12 else k[:4] + "..."
    return {
        "gemini_habilitado": habilitado,
        "tem_chave": bool(user_key or tem_chave_servidor),
        "chave_propria": bool(user_key),
        "chave_parcial": chave_parcial,
        "tem_chave_servidor": tem_chave_servidor,
    }


@router.put("/config")
def salvar_ia_config(
    body: IAConfigIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if body.gemini_api_key is not None:
        current_user.gemini_api_key = body.gemini_api_key.strip() or None
    if body.gemini_habilitado is not None:
        current_user.gemini_habilitado = body.gemini_habilitado
    db.commit()
    return {"ok": True}


@router.get("/testar")
async def testar_ia(
    current_user: models.User = Depends(auth.get_current_user),
):
    user_key = getattr(current_user, "gemini_api_key", None)
    result = await ia_service.testar_conexao(user_key)
    return result
