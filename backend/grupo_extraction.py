"""
Funções para extração de grupos do WhatsApp via WAHA API
"""
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


async def fetch_groups_from_waha(session_id_waha: str) -> list:
    """
    Busca a lista de grupos do WAHA sem salvar no banco.
    Retorna lista de {id, name, size} para exibição na UI.
    """
    groups_data = await waha_request("GET", f"/api/{session_id_waha}/groups")

    if isinstance(groups_data, dict):
        groups_list = list(groups_data.values())
    elif isinstance(groups_data, list):
        groups_list = groups_data
    else:
        return []

    result = []
    for g in groups_list:
        group_id = g.get("id", "")
        if not group_id:
            continue
        size = g.get("size") or len(g.get("participants", []))
        if size < 2:
            continue  # ignora grupos com menos de 2 participantes
        result.append({
            "id": group_id,
            "name": g.get("subject") or g.get("name") or "Sem nome",
            "size": size,
        })

    return result


async def extract_selected_groups(
    session_id_db: int,
    session_id_waha: str,
    user_id: int,
    group_ids_waha: list,
    db: Session,
) -> dict:
    """
    Extrai membros dos grupos selecionados, aplicando filtros:
    - Ignora administradores do grupo
    - Ignora números que não começam com "55" (fora do Brasil)
    - Aceita apenas números com 12 ou 13 dígitos (55 + DDD + 8/9 dígitos)

    Retorna dicionário com contadores.
    """
    logger.info(
        f"[GRUPOS] Iniciando extração seletiva: {len(group_ids_waha)} grupos "
        f"| sessão {session_id_waha} | user={user_id}"
    )

    # Busca todos os grupos do WAHA de uma vez
    groups_data = await waha_request("GET", f"/api/{session_id_waha}/groups")

    if isinstance(groups_data, dict):
        all_groups = groups_data  # {group_id@g.us: group_data}
    elif isinstance(groups_data, list):
        all_groups = {g.get("id", ""): g for g in groups_data if g.get("id")}
    else:
        raise ValueError(f"Formato de resposta inesperado do WAHA: {type(groups_data)}")

    extracted_groups = 0
    extracted_members = 0
    skipped_admin = 0
    skipped_nonbr = 0
    skipped_invalid = 0
    skipped_small = 0

    for group_id_waha in group_ids_waha:
        group_info = all_groups.get(group_id_waha)
        if not group_info:
            logger.warning(f"[GRUPOS] Grupo {group_id_waha} não encontrado no WAHA, pulando")
            continue

        group_name = group_info.get("subject") or group_info.get("name") or "Sem nome"
        logger.info(f"[GRUPOS] Processando: {group_name!r} ({group_id_waha})")

        # Salvar ou atualizar grupo no DB
        existing_group = db.query(models.Group).filter(
            models.Group.user_id == user_id,
            models.Group.group_id_waha == group_id_waha,
        ).first()

        if existing_group:
            group_obj = existing_group
            group_obj.name = group_name
            group_obj.subject = group_info.get("subject", "")
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

        # Participantes já vêm embutidos na resposta do WAHA
        members_list = group_info.get("participants", [])

        # Limpa membros antigos antes de reinserir
        db.query(models.GroupMember).filter(
            models.GroupMember.group_id == group_obj.id
        ).delete()

        group_member_count = 0
        for member_info in members_list:

            # ── FILTRO 1: ignorar admins ─────────────────────────────────────
            admin_val = member_info.get("admin") or ""
            is_admin = (
                admin_val in ("admin", "superadmin")
                or bool(member_info.get("isAdmin", False))
            )
            if is_admin:
                skipped_admin += 1
                continue

            # ── Extrair telefone (WAHA usa LID em "id"; telefone real em "phoneNumber") ──
            raw_phone = member_info.get("phoneNumber") or member_info.get("id", "")
            if not raw_phone:
                continue

            phone = normalize_phone(raw_phone)

            # ── FILTRO 2: apenas números do Brasil (começam com 55) ──────────
            if not phone.startswith("55"):
                skipped_nonbr += 1
                logger.debug(f"[GRUPOS] Ignorado (não-BR): {phone!r}")
                continue

            # ── FILTRO 3: 12 ou 13 dígitos (55 + DDD 2d + número 8 ou 9d) ──
            if not (12 <= len(phone) <= 13):
                skipped_invalid += 1
                logger.debug(f"[GRUPOS] Ignorado (tamanho {len(phone)}): {phone!r}")
                continue

            member_name = (
                member_info.get("name")
                or member_info.get("pushName")
                or ""
            )

            # Upsert contato (deduplicação garantida pelo unique(user_id, phone))
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

            db.add(models.GroupMember(
                group_id=group_obj.id,
                contact_id=contact.id,
                phone=phone,
                name=member_name or None,
                is_admin=False,  # admins foram filtrados acima
            ))
            extracted_members += 1
            group_member_count += 1

        # ── FILTRO: ignorar grupos com menos de 2 membros válidos ───────────
        if group_member_count < 2:
            logger.info(
                f"[GRUPOS] Grupo {group_name!r} ignorado: apenas "
                f"{group_member_count} membro(s) válido(s) após filtros"
            )
            db.query(models.GroupMember).filter(
                models.GroupMember.group_id == group_obj.id
            ).delete()
            db.delete(group_obj)
            db.flush()
            skipped_small += 1
            continue

        group_obj.member_count = group_member_count
        group_obj.last_extracted_at = datetime.now(timezone.utc)

    db.commit()

    logger.info(
        f"[GRUPOS] Extração concluída: {extracted_groups} grupos novos, "
        f"{extracted_members} membros salvos | ignorados: "
        f"{skipped_admin} admins, {skipped_nonbr} não-BR, {skipped_invalid} inválidos, "
        f"{skipped_small} grupos com < 2 membros"
    )

    db.add(models.AtividadeLog(
        user_id=user_id,
        tipo="grupos_extraidos",
        descricao=(
            f"Extração seletiva: {len(group_ids_waha)} grupos selecionados, "
            f"{extracted_members} membros salvos "
            f"({skipped_admin} admins, {skipped_nonbr} não-BR ignorados, "
            f"{skipped_small} grupos pequenos ignorados)"
        ),
    ))
    db.commit()

    return {
        "extracted_groups": extracted_groups,
        "extracted_members": extracted_members,
        "skipped_admin": skipped_admin,
        "skipped_nonbr": skipped_nonbr,
        "skipped_invalid": skipped_invalid,
        "skipped_small": skipped_small,
    }
