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
        print("WEBHOOK PAYLOAD:", payload)

        from_field = payload.get("from", "")

        if from_field.endswith("@g.us"):
            # Mensagem de grupo — remetente é o participant (não o grupo)
            # WAHA pode enviar em payload.key.participant ou payload.participant
            raw_sender = (
                payload.get("participant")
                or (payload.get("key") or {}).get("participant")
                or payload.get("author")
                or ""
            )
        else:
            # Mensagem direta — remetente é o from
            raw_sender = from_field

        if not raw_sender:
            return {"ok": True}

        phone = normalize_phone(raw_sender)
        if not is_valid_phone(phone):
            return {"ok": True}

        name = (
            payload.get("notifyName")
            or payload.get("pushName")
            or payload.get("_data", {}).get("notifyName")
            or None
        )

        is_new = upsert_contact(db, sess.user_id, phone, name)
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
