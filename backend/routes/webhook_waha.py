import httpx
from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from database import get_db
from config import settings
import models
import circuit_breaker
import health_monitor
import ban_wave_detector

router = APIRouter(tags=["webhook"])

# Palavras que indicam opt-out do contato
_OPT_OUT_KEYWORDS = {"parar", "stop", "sair", "cancelar", "descadastrar", "remover"}


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


async def _send_reply(session_waha_id: str, phone: str, text: str):
    """Envia resposta via WAHA (usado para opt-out confirmation)."""
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(
                f"{settings.WAHA_API_URL}/api/sendText",
                json={
                    "chatId": f"{phone}@c.us",
                    "text": text,
                    "session": session_waha_id,
                },
                headers=headers,
            )
    except Exception:
        pass


def _is_opt_out(body: str) -> bool:
    """Verifica se a mensagem e um pedido de opt-out."""
    clean = body.strip().lower()
    # Remove pontuacao basica
    for ch in ["!", ".", ",", "?"]:
        clean = clean.replace(ch, "")
    return clean in _OPT_OUT_KEYWORDS


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

        # ── Ban wave detection ────────────────────────────────────────────────
        if status_raw == "BANNED" and sess:
            triggered_wave = ban_wave_detector.record_ban(session_waha_id)
            sess.status = models.SessionStatus.error
            db.commit()
            if triggered_wave:
                print(f"[WEBHOOK] BAN WAVE ativada por {session_waha_id}")
            return {"ok": True}

        if sess and new_status:
            old_status = sess.status

            # ── Circuit breaker: registra reconexao ──────────────────────────
            if (
                new_status == models.SessionStatus.connected
                and old_status != models.SessionStatus.connected
            ):
                circuit_open = circuit_breaker.record_reconnect(session_waha_id)
                if circuit_open:
                    print(f"[WEBHOOK] Circuit aberto para {session_waha_id} — reconexao bloqueada")

            # ── Health monitor: registra desconexao ──────────────────────────
            if new_status in (
                models.SessionStatus.disconnected,
                models.SessionStatus.error,
            ) and old_status == models.SessionStatus.connected:
                score = health_monitor.record_disconnect(session_waha_id)
                action = health_monitor.get_action(session_waha_id)
                if action == "stop":
                    print(f"[WEBHOOK] ALERTA CRITICO {session_waha_id} score={score} — chip deve ser pausado imediatamente")
                elif action == "alert":
                    print(f"[WEBHOOK] ALERTA {session_waha_id} score={score} — aumentar delays")

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

        # ── Opt-out detection ─────────────────────────────────────────────────
        msg_body = (
            payload.get("body", "")
            or payload.get("text", "")
            or ""
        )
        if msg_body and _is_opt_out(msg_body):
            # Blacklist o contato
            contact = (
                db.query(models.Contact)
                .filter(
                    models.Contact.user_id == sess.user_id,
                    models.Contact.phone == phone,
                )
                .first()
            )
            if contact:
                contact.is_blacklisted = True
                db.commit()
                print(f"[OPT-OUT] {phone} adicionado à blacklist via resposta '{msg_body}'")
            else:
                # Cria ja na blacklist
                db.add(models.Contact(
                    user_id=sess.user_id,
                    phone=phone,
                    name=name,
                    is_blacklisted=True,
                ))
                db.commit()
                print(f"[OPT-OUT] {phone} criado na blacklist diretamente")

            # Responde confirmacao
            await _send_reply(
                session_waha_id,
                phone,
                "Removido com sucesso! ✅\n\nVocê não receberá mais mensagens nossas.",
            )
            db.add(models.AtividadeLog(
                user_id=sess.user_id,
                tipo="opt_out",
                descricao=f"Contato {phone} optou por sair via '{msg_body}'",
            ))
            db.commit()
            return {"ok": True}

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
