"""
Rotas para gerenciar grupos e extrair membros
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import logging

import models
import auth
from database import get_db
from grupo_extraction import fetch_groups_from_waha, extract_selected_groups

logger = logging.getLogger(__name__)

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
    auto_update_interval: Optional[int]
    last_extraction_result: Optional[str]  # JSON: {"novos":5,"sairam":2,"existentes":10}

    class Config:
        from_attributes = True


class GroupDetailOut(GroupOut):
    members: List[GroupMemberOut] = []


class GroupListOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[GroupOut]


class ExtractSelectedBody(BaseModel):
    group_ids: List[str]


class AutoUpdateBody(BaseModel):
    auto_update_interval: Optional[int] = None  # horas, None = desativar


class AddContactsToCampaignBody(BaseModel):
    campaign_id: int
    contact_ids: List[int]


# ── Endpoints de sessão (devem vir ANTES de /{group_id} para evitar conflito) ─
@router.get("/session/{session_id}/waha-list")
async def list_waha_groups(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Retorna a lista de grupos diretamente do WAHA sem salvar no banco.
    Usado para exibir checkboxes na UI antes da extração.
    Marca quais grupos já foram extraídos anteriormente.
    """
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Loga o status do banco mas não bloqueia — o WAHA é a fonte de verdade.
    # O banco pode estar desatualizado (webhook não recebido, restart, etc).
    db_status = str(session.status.value if hasattr(session.status, "value") else session.status)
    is_connected = db_status.lower() in ("connected", "working")
    if not is_connected:
        logger.warning(
            f"[GRUPOS] waha-list: sessão {session.session_id!r} tem status={db_status!r} "
            f"no banco. Tentando buscar grupos no WAHA mesmo assim..."
        )

    try:
        groups = await fetch_groups_from_waha(session.session_id)

        # Marcar os que já foram extraídos para esta sessão
        extracted_ids = {
            row.group_id_waha
            for row in db.query(models.Group.group_id_waha).filter(
                models.Group.user_id == current_user.id,
                models.Group.session_id == session_id,
            ).all()
        }

        for g in groups:
            g["already_extracted"] = g["id"] in extracted_ids

        return {"total": len(groups), "groups": groups}

    except Exception as e:
        logger.error(f"[GRUPOS] waha-list falhou para sessão {session.session_id!r} (status DB={db_status!r}): {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Erro ao buscar grupos do WAHA (status DB: {db_status}): {str(e)}",
        )


@router.post("/session/{session_id}/extract-selected")
async def extract_selected(
    session_id: int,
    body: ExtractSelectedBody,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """
    Extrai membros dos grupos selecionados aplicando filtros:
    - Ignora admins do grupo
    - Apenas números brasileiros (55...)
    - Apenas 12 ou 13 dígitos
    Retorna os contadores de extração imediatamente (síncrono).
    """
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Loga se o banco não marcou como connected, mas não bloqueia.
    db_status = str(session.status.value if hasattr(session.status, "value") else session.status)
    is_connected = db_status.lower() in ("connected", "working")
    if not is_connected:
        logger.warning(
            f"[GRUPOS] extract-selected: sessão {session.session_id!r} tem status={db_status!r} "
            f"no banco. Tentando extrair mesmo assim..."
        )

    if not body.group_ids:
        raise HTTPException(status_code=400, detail="Nenhum grupo selecionado")

    try:
        result = await extract_selected_groups(
            session.id,
            session.session_id,
            current_user.id,
            body.group_ids,
            db,
        )
        parts = []
        if result["novos"] > 0:
            parts.append(f"+{result['novos']} novos")
        if result["sairam"] > 0:
            parts.append(f"-{result['sairam']} saíram")
        if result["existentes"] > 0:
            parts.append(f"{result['existentes']} já existiam")
        delta_msg = " | ".join(parts) if parts else "Nenhuma alteração"
        return {
            "status": "ok",
            "message": f"Grupo atualizado: {delta_msg}",
            **result,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na extração: {str(e)}")


# ── Endpoints de grupos (DB) ──────────────────────────────────────────────────
@router.delete("/cleanup")
def cleanup_small_groups(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Deleta grupos com 0 ou 1 membro e limpa group_members órfãos."""
    small_groups = db.query(models.Group).filter(
        models.Group.user_id == current_user.id,
        models.Group.member_count <= 1,
    ).all()

    deleted_count = len(small_groups)
    for group in small_groups:
        db.delete(group)  # CASCADE deleta GroupMembers vinculados
    db.flush()

    # Safety net: limpa GroupMembers cujo grupo não existe mais
    result = db.execute(
        text("DELETE FROM group_members WHERE group_id NOT IN (SELECT id FROM groups)")
    )
    orphaned_count = result.rowcount

    db.commit()

    return {
        "deleted_groups": deleted_count,
        "orphaned_members_cleaned": orphaned_count,
        "message": (
            f"{deleted_count} grupo(s) com 0 ou 1 membro removido(s). "
            f"{orphaned_count} membro(s) órfão(s) limpos."
        ),
    }


@router.get("", response_model=GroupListOut)
def list_groups(
    session_id: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Lista grupos extraídos (salvos no banco). Retorna apenas grupos com >= 2 membros."""
    query = db.query(models.Group).filter(
        models.Group.user_id == current_user.id,
        models.Group.member_count >= 2,  # ignora grupos com < 2 membros
    )

    if session_id:
        query = query.filter(models.Group.session_id == session_id)

    total = query.count()
    items = query.order_by(models.Group.created_at.desc()).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    return GroupListOut(total=total, page=page, page_size=page_size, items=items)


@router.get("/{group_id}/members")
def list_group_members(
    group_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: Optional[str] = None,
    filter_type: Optional[str] = None,  # all | named | unnamed | admins
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Lista membros de um grupo com paginação, busca e filtros opcionais."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    query = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    )

    # Status filter: by default exclude "saiu" members
    if filter_type == "saiu":
        query = query.filter(models.GroupMember.status == "saiu")
    else:
        query = query.filter(models.GroupMember.status != "saiu")

    if search:
        query = query.filter(
            (models.GroupMember.phone.ilike(f"%{search}%")) |
            (models.GroupMember.name.ilike(f"%{search}%"))
        )

    if filter_type == "named":
        query = query.filter(
            models.GroupMember.name.isnot(None),
            models.GroupMember.name != "",
        )
    elif filter_type == "unnamed":
        query = query.filter(
            (models.GroupMember.name.is_(None)) | (models.GroupMember.name == "")
        )
    elif filter_type == "admins":
        query = query.filter(models.GroupMember.is_admin == True)  # noqa: E712

    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    # Busca status de blacklist dos contatos
    contact_ids_with_val = [m.contact_id for m in items if m.contact_id]
    blacklisted_ids: set = set()
    if contact_ids_with_val:
        bl = db.query(models.Contact.id).filter(
            models.Contact.id.in_(contact_ids_with_val),
            models.Contact.is_blacklisted == True,  # noqa: E712
        ).all()
        blacklisted_ids = {c.id for c in bl}

    return {
        "group_id": group_id,
        "group_name": group.name,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": m.id,
                "contact_id": m.contact_id,
                "phone": m.phone,
                "name": m.name,
                "is_admin": m.is_admin,
                "is_blacklisted": m.contact_id in blacklisted_ids,
                "status": m.status,
                "added_at": m.added_at,
            }
            for m in items
        ],
    }


@router.post("/{group_id}/add-contacts-to-campaign")
def add_contacts_to_campaign_selected(
    group_id: int,
    body: AddContactsToCampaignBody,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Adiciona contatos específicos (por contact_id) de um grupo a uma campanha."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()
    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == body.campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    added = 0
    for contact_id in body.contact_ids:
        existing = db.query(models.CampaignContact).filter(
            models.CampaignContact.campaign_id == body.campaign_id,
            models.CampaignContact.contact_id == contact_id,
        ).first()
        if not existing:
            db.add(models.CampaignContact(
                campaign_id=body.campaign_id,
                contact_id=contact_id,
            ))
            added += 1

    db.commit()
    return {
        "campaign_id": body.campaign_id,
        "added_count": added,
        "message": f"{added} contato(s) adicionado(s) à campanha",
    }


@router.post("/{group_id}/add-to-campaign")
def add_group_members_to_campaign(
    group_id: int,
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Adiciona todos os membros de um grupo para uma campanha."""
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

    members = db.query(models.GroupMember).filter(
        models.GroupMember.group_id == group_id
    ).all()

    added_count = 0
    for member in members:
        existing = db.query(models.CampaignContact).filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.contact_id == member.contact_id,
        ).first()

        if not existing and member.contact_id:
            db.add(models.CampaignContact(
                campaign_id=campaign_id,
                contact_id=member.contact_id,
            ))
            added_count += 1

    db.commit()

    return {
        "campaign_id": campaign_id,
        "group_id": group_id,
        "added_count": added_count,
        "message": f"{added_count} membros adicionados à campanha",
    }


@router.patch("/{group_id}/auto-update")
def set_auto_update(
    group_id: int,
    body: AutoUpdateBody,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Define ou remove o intervalo de auto-atualização de um grupo."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    group.auto_update_interval = body.auto_update_interval
    db.commit()
    db.refresh(group)
    return {"id": group.id, "auto_update_interval": group.auto_update_interval}


@router.delete("/{group_id}")
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Deleta um grupo e seus membros."""
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.user_id == current_user.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Grupo não encontrado")

    db.delete(group)
    db.commit()

    return {"status": "deleted", "group_id": group_id}
