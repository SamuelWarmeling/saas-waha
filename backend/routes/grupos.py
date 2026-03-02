"""
Rotas para gerenciar grupos e extrair membros
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import asyncio

import models
import auth
from database import get_db
from grupo_extraction import extract_groups_task

router = APIRouter(prefix="/api/grupos", tags=["Grupos"])


# ── Schemas ───────────────────────────────────────────────────────────────────
class GroupMemberOut(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    is_admin: bool
    added_at: datetime

    class Config:
        from_attributes = True


class GroupOut(BaseModel):
    id: int
    name: str
    subject: Optional[str]
    member_count: int
    is_active: bool
    created_at: datetime
    last_extracted_at: Optional[datetime]

    class Config:
        from_attributes = True


class GroupDetailOut(GroupOut):
    members: List[GroupMemberOut] = []


class GroupListOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[GroupOut]


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("", response_model=GroupListOut)
def list_groups(
    session_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Lista todos os grupos do usuário."""
    query = db.query(models.Group).filter(models.Group.user_id == current_user.id)

    if session_id:
        query = query.filter(models.Group.session_id == session_id)

    total = query.count()
    items = query.order_by(models.Group.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    return GroupListOut(total=total, page=page, page_size=page_size, items=items)


@router.get("/{group_id}", response_model=GroupDetailOut)
def get_group_detail(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Obtém detalhes de um grupo com todos os membros."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    return GroupDetailOut(
        id=group.id,
        name=group.name,
        subject=group.subject,
        member_count=group.member_count,
        is_active=group.is_active,
        created_at=group.created_at,
        last_extracted_at=group.last_extracted_at,
        members=[
            GroupMemberOut(
                id=m.id,
                phone=m.phone,
                name=m.name,
                is_admin=m.is_admin,
                added_at=m.added_at,
            )
            for m in group.members
        ] if group.members else [],
    )


@router.post("/{group_id}/re-extract")
async def re_extract_group(
    group_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Força uma re-extração dos membros de um grupo específico.
    """
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == group.session_id
    ).first()

    if not session or session.status != models.SessionStatus.connected:
        raise HTTPException(status_code=400, detail="Sessão não está conectada")

    # Dispara extração em background
    asyncio.create_task(
        extract_groups_task(group.session_id, session.session_id, current_user.id)
    )

    return {"status": "extraindo", "message": "Extração iniciada em background"}


@router.post("/session/{session_id}/extract-all")
async def extract_all_groups(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Força extração completa de todos os grupos da sessão.
    """
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    if session.status != models.SessionStatus.connected:
        raise HTTPException(status_code=400, detail="Sessão não está conectada")

    # Dispara extração em background
    asyncio.create_task(
        extract_groups_task(session.id, session.session_id, current_user.id)
    )

    return {
        "status": "extraindo",
        "message": f"Extração de grupos da sessão {session.name} iniciada em background",
    }


@router.get("/{group_id}/members")
def list_group_members(
    group_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Lista membros de um grupo com paginação."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    query = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    )

    if search:
        query = query.filter(
            (models.GroupMember.phone.ilike(f"%{search}%")) |
            (models.GroupMember.name.ilike(f"%{search}%"))
        )

    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "group_id": group_id,
        "group_name": group.name,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": m.id,
                "phone": m.phone,
                "name": m.name,
                "is_admin": m.is_admin,
                "added_at": m.added_at,
            }
            for m in items
        ],
    }


@router.post("/{group_id}/add-to-campaign")
def add_group_members_to_campaign(
    group_id: int,
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Adiciona todos os membros de um grupo para uma campanha.
    """
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()

    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    # Adicionar membros à campanha
    members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    ).all()

    added_count = 0
    for member in members:
        # Verificar se já existe
        existing = db.query(models.CampaignContact).filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.contact_id == member.contact_id,
        ).first()

        if not existing and member.contact_id:
            campaign_contact = models.CampaignContact(
                campaign_id=campaign_id,
                contact_id=member.contact_id,
            )
            db.add(campaign_contact)
            added_count += 1

    db.commit()

    return {
        "campaign_id": campaign_id,
        "group_id": group_id,
        "added_count": added_count,
        "message": f"{added_count} membros adicionados à campanha",
    }


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Delete um grupo e seus membros."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    db.delete(group)
    db.commit()

    return {"status": "deleted", "group_id": group_id}
