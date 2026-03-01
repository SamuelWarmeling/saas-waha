from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from database import get_db
import models

router = APIRouter(tags=["webhook"])


def normalize_phone(raw: str) -> str:
    """Remove @c.us/@g.us/@s.whatsapp.net suffix, mantém só dígitos."""
    phone = raw.split("@")[0].strip()
    phone = "".join(c for c in phone if c.isdigit())
    return phone


def is_valid_phone(phone: str) -> bool:
    """Valida que o número tem entre 10 e 15 dígitos."""
    return 10 <= len(phone) <= 15


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
                me = payload.get("me", {}) or {}
                raw_phone = me.get("id", "") or payload.get("id", "")
                if raw_phone:
                    sess.phone_number = normalize_phone(raw_phone)
                sess.qr_code = None
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

    return {"ok": True}
