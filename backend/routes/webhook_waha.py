from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import httpx
from database import get_db
from config import settings
import models
from models import FunnelContatoStatus as FunnelContatoStatus, FunnelTemperatura as FunnelTemperatura

router = APIRouter(tags=["webhook"])


def normalize_phone(raw: str) -> str:
    """Remove @c.us/@g.us/@s.whatsapp.net suffix, mantém só dígitos."""
    phone = raw.split("@")[0].strip()
    phone = "".join(c for c in phone if c.isdigit())
    return phone


def is_valid_phone(phone: str) -> bool:
    """Valida número brasileiro: começa com '55' e tem 12 ou 13 dígitos."""
    return phone.startswith("55") and len(phone) in (12, 13)


def upsert_contact(db: Session, user_id: int, phone: str, name: str | None) -> bool:
    """Insere ou atualiza contato. Retorna True se o contato foi criado agora."""
    existing = (
        db.query(models.Contact)
        .filter(
            models.Contact.user_id == user_id,
            models.Contact.phone == phone,
        )
        .first()
    )
    if existing:
        if name and name != existing.name:
            existing.name = name
            db.commit()
        return False
    else:
        db.add(models.Contact(user_id=user_id, phone=phone, name=name))
        db.commit()
        return True


@router.post("/waha")
async def waha_webhook(request: Request, db: Session = Depends(get_db)):
    try:
        body = await request.json()
    except Exception:
        return {"ok": True}

    event = body.get("event", "")
    session_waha_id = body.get("session", "")
    payload = body.get("payload", {})

    print(f"=== WEBHOOK === Evento: {event!r} | Sessão: {session_waha_id!r}")

    # Find the session in DB
    sess = (
        db.query(models.WhatsAppSession)
        .filter(models.WhatsAppSession.session_id == session_waha_id)
        .first()
    )

    # ── session.status ────────────────────────────────────────────────────────
    if event == "session.status":
        status_raw = payload.get("status", "")
        status_map = {
            "CONNECTED": models.SessionStatus.connected,
            "WORKING":   models.SessionStatus.connected,
            "SCAN_QR_CODE": models.SessionStatus.connecting,
            "STOPPED":   models.SessionStatus.disconnected,
            "FAILED":    models.SessionStatus.error,
        }
        new_status = status_map.get(status_raw)
        if sess and new_status:
            sess.status = new_status
            if new_status == models.SessionStatus.connected:
                # 1. Tenta extrair número do payload do webhook
                me = payload.get("me", {}) or {}
                raw_phone = (
                    me.get("id", "")
                    or me.get("phoneNumber", "")
                    or payload.get("id", "")
                    or payload.get("phoneNumber", "")
                )
                if raw_phone:
                    sess.phone_number = normalize_phone(raw_phone)
                    print(f"[webhook] Número salvo do payload: {sess.phone_number}")

                # 2. Fallback: busca /me direto na WAHA API se número não veio
                if not sess.phone_number:
                    try:
                        headers = {}
                        if settings.WAHA_API_KEY:
                            headers["X-Api-Key"] = settings.WAHA_API_KEY
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            r = await client.get(
                                f"{settings.WAHA_API_URL}/api/{session_waha_id}/me",
                                headers=headers,
                            )
                        if r.status_code == 200:
                            me_data = r.json()
                            raw = (
                                me_data.get("id", "")
                                or me_data.get("phoneNumber", "")
                            )
                            if raw:
                                sess.phone_number = normalize_phone(raw)
                                print(f"[webhook] Número salvo via /me: {sess.phone_number}")
                    except Exception as exc:
                        print(f"[webhook] Erro ao buscar /me: {exc}")

                sess.qr_code = None
                db.commit()
            else:
                db.commit()

    # ── message ───────────────────────────────────────────────────────────────
    elif event == "message" and sess:
        from_field = payload.get("from", "")
        participant_field = (
            payload.get("participant")
            or (payload.get("key") or {}).get("participant")
            or payload.get("author")
            or ""
        )
        is_group = from_field.endswith("@g.us")

        print("=== WEBHOOK ===")
        print(f"Evento:      message")
        print(f"Sessão:      {session_waha_id}")
        print(f"De:          {from_field or '(vazio)'} ({'GRUPO' if is_group else 'DIRETO'})")
        print(f"Participante:{participant_field or '(vazio)'}")
        print(f"Payload completo: {payload}")

        if is_group:
            raw_sender = participant_field
        else:
            raw_sender = from_field

        print(f"raw_sender:  {raw_sender or '(vazio)'}")

        if not raw_sender:
            print(">>> IGNORADO: raw_sender vazio")
            print("===============")
            return {"ok": True}

        phone_dirty = raw_sender
        phone = normalize_phone(raw_sender)
        print(f"Telefone:    {phone_dirty!r} → {phone!r}")

        if not is_valid_phone(phone):
            print(f">>> IGNORADO: telefone inválido (len={len(phone)})")
            print("===============")
            return {"ok": True}

        name = (
            payload.get("notifyName")
            or payload.get("pushName")
            or payload.get("_data", {}).get("notifyName")
            or None
        )

        is_new = upsert_contact(db, sess.user_id, phone, name)
        print(f"Contato:     {'NOVO' if is_new else 'EXISTENTE'} | nome={name!r}")
        print("===============")

        if is_new:
            label = name or phone
            descricao = f"Contato extraído: {label} via sessão {session_waha_id}"
            db.add(models.AtividadeLog(
                user_id=sess.user_id,
                tipo="contato_extraido",
                descricao=descricao,
            ))
            db.commit()

        # ── Verifica se o remetente tem funil ativo ──────────────────────────
        contato_db = (
            db.query(models.Contact)
            .filter(
                models.Contact.user_id == sess.user_id,
                models.Contact.phone == phone,
            )
            .first()
        )
        if contato_db:
            fc_ativo = (
                db.query(models.FunnelContato)
                .join(models.FunnelSequencia, models.FunnelContato.sequencia_id == models.FunnelSequencia.id)
                .filter(
                    models.FunnelContato.contato_id == contato_db.id,
                    models.FunnelContato.status == models.FunnelContatoStatus.ativo,
                    models.FunnelSequencia.user_id == sess.user_id,
                )
                .first()
            )
            if fc_ativo:
                now_ts = datetime.now(timezone.utc)
                fc_ativo.status = models.FunnelContatoStatus.respondeu
                fc_ativo.respondeu_em = now_ts
                fc_ativo.temperatura = models.FunnelTemperatura.quente
                db.commit()
                seq_nome = fc_ativo.sequencia.nome if fc_ativo.sequencia else "?"
                label_contato = contato_db.name or phone
                db.add(models.AtividadeLog(
                    user_id=sess.user_id,
                    tipo="funnel_respondeu",
                    descricao=(
                        f"💬 Lead {label_contato} respondeu! "
                        f"Funil '{seq_nome}' pausado automaticamente."
                    ),
                ))
                db.commit()
                print(f"[FUNNEL] Lead {phone} respondeu — funil pausado.")

    # ── message.ack (entregue / lido) ─────────────────────────────────────────
    elif event in ("message.ack", "message_ack") and sess:
        ack = payload.get("ack") or payload.get("status") or 0
        msg_key = payload.get("key") or {}
        waha_msg_id = msg_key.get("id") if isinstance(msg_key, dict) else None
        if not waha_msg_id:
            waha_msg_id = payload.get("id")

        if waha_msg_id and ack in (2, 3):
            cc = (
                db.query(models.CampaignContact)
                .filter(models.CampaignContact.waha_message_id == str(waha_msg_id))
                .first()
            )
            if cc:
                now_ts = datetime.now(timezone.utc)
                if ack >= 2 and not cc.delivered_at:
                    cc.delivered_at = now_ts
                if ack >= 3 and not cc.read_at:
                    cc.read_at = now_ts
                db.commit()

    return {"ok": True}
