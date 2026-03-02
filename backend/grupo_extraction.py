"""
Funções para extração de grupos do WhatsApp via WAHA API
"""
import asyncio
import httpx
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from config import settings
import models

logger = logging.getLogger(__name__)


async def waha_request(method: str, path: str, accept_json: bool = True, **kwargs):
    """Faz requisição autenticada para a WAHA API."""
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    if accept_json:
        headers["Accept"] = "application/json"

    async with httpx.AsyncClient(timeout=30.0) as client:
        url = f"{settings.WAHA_API_URL}{path}"
        resp = await client.request(method, url, headers=headers, **kwargs)
        resp.raise_for_status()
        return resp.json()


def normalize_phone(raw: str) -> str:
    """Remove @c.us/@g.us/@s.whatsapp.net suffix, mantém só dígitos."""
    phone = raw.split("@")[0].strip()
    phone = "".join(c for c in phone if c.isdigit())
    return phone


def is_valid_phone(phone: str) -> bool:
    """Valida que o número tem entre 10 e 15 dígitos."""
    return 10 <= len(phone) <= 15


async def extract_groups_for_session(session_id_db: int, session_id_waha: str, user_id: int, db: Session):
    """
    Extrai todos os grupos de uma sessão conectada.
    1. Lista grupos via GET /api/{session}/chats?filter=group
    2. Para cada grupo, extrai os membros via GET /api/{session}/chats/{id}/members
    3. Cria contatos automáticos para os membros
    """
    try:
        logger.info(f"[GRUPOS] Iniciando extração para sessão {session_id_waha} (user={user_id})")

        # ── 1. Listar grupos ──────────────────────────────────────────────────────
        logger.info(f"[GRUPOS] Buscando lista de grupos...")
        groups_data = await waha_request(
            "GET",
            f"/api/{session_id_waha}/groups",
        )

        groups_list = groups_data.get("data", []) if isinstance(groups_data, dict) else groups_data
        logger.info(f"[GRUPOS] Encontrados {len(groups_list)} grupos")

        if not groups_list:
            logger.info("[GRUPOS] Nenhum grupo encontrado")
            return

        # ── 2. Para cada grupo, extrair membros ────────────────────────────────
        extracted_groups = 0
        extracted_members = 0

        for group_info in groups_list:
            try:
                group_id_waha = group_info.get("id", "")
                group_name = group_info.get("name", group_info.get("subject", "Sem nome"))

                if not group_id_waha:
                    logger.warning("[GRUPOS] Grupo sem ID, pulando...")
                    continue

                logger.info(f"[GRUPOS] Processando grupo: {group_name} ({group_id_waha})")

                # Salva o grupo no DB
                existing_group = db.query(models.Group).filter(
                    models.Group.group_id_waha == group_id_waha
                ).first()

                if existing_group:
                    group_obj = existing_group
                    logger.info(f"[GRUPOS] Grupo já existe no DB")
                else:
                    group_obj = models.Group(
                        user_id=user_id,
                        session_id=session_id_db,
                        group_id_waha=group_id_waha,
                        name=group_name,
                        subject=group_info.get("subject", ""),
                        member_count=0,
                    )
                    db.add(group_obj)
                    db.flush()
                    extracted_groups += 1
                    logger.info(f"[GRUPOS] Grupo criado no DB (id={group_obj.id})")

                # ── 3. Extrair membros do grupo ───────────────────────────────────
                try:
                    members_data = await waha_request(
                        "GET",
                        f"/api/{session_id_waha}/groups/{group_id_waha}/participants",
                    )
                    members_list = members_data.get("data", []) if isinstance(members_data, dict) else members_data

                    logger.info(f"[GRUPOS] Grupo {group_name} tem {len(members_list)} membros")

                    # Limpar membros antigos do grupo
                    db.query(models.GroupMember).filter(
                        models.GroupMember.group_id == group_obj.id
                    ).delete()

                    for member_info in members_list:
                        try:
                            member_id = member_info.get("id", "")  # ID completo com @c.us
                            member_name = member_info.get("name", member_info.get("pushName", ""))
                            is_admin = member_info.get("isAdmin", False)

                            if not member_id:
                                logger.warning("[GRUPOS] Membro sem ID, pulando...")
                                continue

                            phone = normalize_phone(member_id)

                            if not is_valid_phone(phone):
                                logger.warning(f"[GRUPOS] Telefone inválido para membro {member_id}")
                                continue

                            # Criar ou buscar contato
                            existing_contact = db.query(models.Contact).filter(
                                models.Contact.user_id == user_id,
                                models.Contact.phone == phone,
                            ).first()

                            if existing_contact:
                                contact = existing_contact
                                if member_name and member_name != contact.name:
                                    contact.name = member_name
                            else:
                                contact = models.Contact(
                                    user_id=user_id,
                                    phone=phone,
                                    name=member_name or None,
                                )
                                db.add(contact)
                                db.flush()
                                logger.info(f"[GRUPOS] Novo contato criado: {phone} ({member_name})")

                            # Criar membro do grupo
                            group_member = models.GroupMember(
                                group_id=group_obj.id,
                                contact_id=contact.id,
                                phone=phone,
                                name=member_name or None,
                                is_admin=is_admin,
                            )
                            db.add(group_member)
                            extracted_members += 1

                        except Exception as e:
                            logger.error(f"[GRUPOS] Erro ao processar membro {member_info}: {e}")
                            continue

                    # Atualizar contagem de membros
                    group_obj.member_count = len([m for m in members_list if m.get("id")])
                    group_obj.last_extracted_at = datetime.now(timezone.utc)

                except httpx.HTTPStatusError as e:
                    logger.error(f"[GRUPOS] Erro HTTP ao buscar membros: {e.response.status_code} - {e.response.text}")
                except Exception as e:
                    logger.error(f"[GRUPOS] Erro ao buscar membros: {e}")

            except Exception as e:
                logger.error(f"[GRUPOS] Erro ao processar grupo: {e}")
                continue

        db.commit()

        logger.info(
            f"[GRUPOS] Extração concluída: {extracted_groups} grupos, {extracted_members} membros extraídos"
        )

        # Registrar atividade
        db.add(models.AtividadeLog(
            user_id=user_id,
            tipo="grupos_extraidos",
            descricao=f"Extração automática: {extracted_groups} grupos, {extracted_members} membros via sessão {session_id_waha}",
        ))
        db.commit()

    except Exception as e:
        logger.error(f"[GRUPOS] Erro geral na extração de grupos: {e}", exc_info=True)


async def extract_groups_task(session_id_db: int, session_id_waha: str, user_id: int):
    """
    Tarefa assíncrona (para ser executada em background) que extrai grupos.
    """
    from database import SessionLocal
    db = SessionLocal()
    try:
        await extract_groups_for_session(session_id_db, session_id_waha, user_id, db)
    finally:
        db.close()
