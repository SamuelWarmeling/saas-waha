from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

import models
import auth
from database import get_db

router = APIRouter(prefix="/api/listas", tags=["Listas"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ListaCreate(BaseModel):
    nome: str
    cor: str = "#7c3aed"


class AddContatosRequest(BaseModel):
    contato_ids: List[int]


class RemoveContatosRequest(BaseModel):
    contato_ids: List[int]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_listas(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    listas = (
        db.query(models.Lista)
        .filter(models.Lista.user_id == current_user.id)
        .order_by(models.Lista.criado_em.asc())
        .all()
    )
    result = []
    for lst in listas:
        count = (
            db.query(models.ContatoLista)
            .filter(models.ContatoLista.lista_id == lst.id)
            .count()
        )
        result.append({
            "id": lst.id,
            "nome": lst.nome,
            "cor": lst.cor,
            "criado_em": lst.criado_em,
            "total_contatos": count,
        })
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
def create_lista(
    data: ListaCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    lst = models.Lista(
        user_id=current_user.id,
        nome=data.nome.strip(),
        cor=data.cor or "#7c3aed",
    )
    db.add(lst)
    db.commit()
    db.refresh(lst)
    return {"id": lst.id, "nome": lst.nome, "cor": lst.cor, "criado_em": lst.criado_em, "total_contatos": 0}


@router.delete("/{lista_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lista(
    lista_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    lst = db.query(models.Lista).filter(
        models.Lista.id == lista_id,
        models.Lista.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Lista não encontrada")
    db.delete(lst)
    db.commit()


@router.post("/{lista_id}/contatos")
def add_contatos_to_lista(
    lista_id: int,
    data: AddContatosRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    lst = db.query(models.Lista).filter(
        models.Lista.id == lista_id,
        models.Lista.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Lista não encontrada")

    added = 0
    for cid in data.contato_ids:
        contact = db.query(models.Contact).filter(
            models.Contact.id == cid,
            models.Contact.user_id == current_user.id,
        ).first()
        if not contact:
            continue
        existing = db.query(models.ContatoLista).filter(
            models.ContatoLista.contato_id == cid,
            models.ContatoLista.lista_id == lista_id,
        ).first()
        if not existing:
            db.add(models.ContatoLista(contato_id=cid, lista_id=lista_id))
            added += 1

    db.commit()
    return {"added": added, "lista_id": lista_id}


@router.delete("/{lista_id}/contatos")
def remove_contatos_from_lista(
    lista_id: int,
    data: RemoveContatosRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    lst = db.query(models.Lista).filter(
        models.Lista.id == lista_id,
        models.Lista.user_id == current_user.id,
    ).first()
    if not lst:
        raise HTTPException(status_code=404, detail="Lista não encontrada")

    db.query(models.ContatoLista).filter(
        models.ContatoLista.lista_id == lista_id,
        models.ContatoLista.contato_id.in_(data.contato_ids),
    ).delete(synchronize_session=False)
    db.commit()
    return {"removed": len(data.contato_ids)}
