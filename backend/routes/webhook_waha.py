import asyncio
import random

from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone, timedelta
import httpx
from database import get_db, SessionLocal
from config import settings
import models
from models import FunnelContatoStatus as FunnelContatoStatus, FunnelTemperatura as FunnelTemperatura

router = APIRouter(tags=["webhook"])

# Mantém referência forte às tasks de auto-resposta para evitar GC prematuro
_background_tasks: set[asyncio.Task] = set()


async def resposta_automatica_virtual(
    session_waha_id: str,
    to_phone: str,
    mensagem_recebida: str,
    aq_id: int,
    user_key: str | None,
):
    """
    Simula comportamento humano completo:
    leitura → seen → digitação → stopTyping → resposta.
    """
    chat_id = f"{to_phone}@c.us"
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY

    async def waha_post(path: str, body: dict) -> bool:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.post(
                    f"{settings.WAHA_API_URL}{path}",
                    json=body,
                    headers=headers,
                )
            ok = r.status_code in (200, 201, 204)
            if not ok:
                print(f"[VIRTUAL-AUTO-RESP] ❌ {path} → HTTP {r.status_code}: {r.text[:200]}")
            return ok
        except Exception as exc:
            print(f"[VIRTUAL-AUTO-RESP] ❌ Exceção em {path}: {exc}")
            return False

    try:
        print(f"🤖 [VIRTUAL] {session_waha_id} → auto-resposta iniciada para {to_phone[:6]}***")

        # a) Simula tempo para ler a mensagem (2-5s)
        delay_leitura = random.randint(2, 5)
        print(f"🤖 [VIRTUAL] Aguardando {delay_leitura}s (leitura)...")
        await asyncio.sleep(delay_leitura)

        # b) Marca como lido (sendSeen)
        print(f"🤖 [VIRTUAL] Marcando como lido...")
        visto = await waha_post(f"/api/{session_waha_id}/sendSeen", {"chatId": chat_id})
        print(f"🤖 [VIRTUAL] sendSeen → {'ok' if visto else 'falhou (continua)'}")

        # c) Delay antes de começar a digitar (3-8s)
        delay_antes_digitar = random.randint(3, 8)
        print(f"🤖 [VIRTUAL] Aguardando {delay_antes_digitar}s antes de digitar...")
        await asyncio.sleep(delay_antes_digitar)

        # d) Inicia indicador de digitação
        print(f"🤖 [VIRTUAL] Digitando...")
        await waha_post(f"/api/{session_waha_id}/startTyping", {"chatId": chat_id})

        # e) Gera resposta com IA (ou fallback) enquanto "digita"
        import ia_service
        print(f"🤖 [VIRTUAL] Gerando resposta (msg recebida: {mensagem_recebida[:40]!r})...")
        resposta = await ia_service.gerar_resposta_natural(mensagem_recebida, user_key)
        print(f"🤖 [VIRTUAL] Resposta gerada: {resposta[:80]!r}")

        # f) Delay proporcional ao tamanho da resposta (simula digitação real, 2-4s)
        delay_digitar = max(2, min(4, len(resposta) // 15))
        print(f"🤖 [VIRTUAL] Aguardando {delay_digitar}s (digitação)...")
        await asyncio.sleep(delay_digitar)

        # g) Para indicador de digitação
        await waha_post(f"/api/{session_waha_id}/stopTyping", {"chatId": chat_id})

        # h) Envia resposta — mesmo formato usado no aquecimento e campanhas
        print(f"🤖 [VIRTUAL] Enviando resposta via sendText...")
        ok = await waha_post("/api/sendText", {
            "session": session_waha_id,
            "chatId": chat_id,
            "text": resposta,
        })
        if ok:
            print(f"🤖 [VIRTUAL] ✅ Respondeu: {resposta[:60]!r}")
        else:
            print(f"🤖 [VIRTUAL] ❌ FALHOU ao enviar resposta para {to_phone[:6]}*** (veja log acima)")

        # Salva log no banco
        db: Session = SessionLocal()
        try:
            aq = db.query(models.AquecimentoConfig).filter(models.AquecimentoConfig.id == aq_id).first()
            if aq and ok:
                aq.respostas_enviadas = (getattr(aq, "respostas_enviadas", 0) or 0) + 1
                db.add(models.AquecimentoLog(
                    aquecimento_id=aq_id,
                    telefone_destino=to_phone,
                    mensagem=resposta,
                    status="respondido",
                ))
                db.commit()
        finally:
            db.close()

    except Exception as exc:
        import traceback
        print(f"[VIRTUAL-AUTO-RESP] ❌ Erro inesperado: {exc}")
        print(traceback.format_exc())


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
            "CONNECTED":    models.SessionStatus.connected,
            "WORKING":      models.SessionStatus.connected,
            "SCAN_QR_CODE": models.SessionStatus.connecting,
            "STOPPED":      models.SessionStatus.disconnected,
            "FAILED":       models.SessionStatus.error,
            "BANNED":       models.SessionStatus.error,
        }
        new_status = status_map.get(status_raw)

        # ── Ban detectado: registrar aprendizado ANTES de alterar status ──
        if status_raw == "BANNED" and sess:
            from fuzzy_chip import registrar_ban
            try:
                registrar_ban(sess, db)
                print(f"[BAN] Chip '{sess.name}' banido — contexto registrado para aprendizado.")
            except Exception as _exc:
                print(f"[BAN] Erro ao registrar ban: {_exc}")

            # Pausa aquecimento ativo
            aq_ativo = (
                db.query(models.AquecimentoConfig)
                .filter(
                    models.AquecimentoConfig.session_id == sess.id,
                    models.AquecimentoConfig.status == models.AquecimentoStatus.ativo,
                )
                .first()
            )
            if aq_ativo:
                aq_ativo.status = models.AquecimentoStatus.pausado
                db.commit()
                print(f"[BAN] Aquecimento #{aq_ativo.id} pausado automaticamente.")

            # Log de atividade para o usuário
            db.add(models.AtividadeLog(
                user_id=sess.user_id,
                tipo="chip_banido",
                descricao=(
                    f"🚨 Chip '{sess.name}' foi BANIDO pelo WhatsApp! "
                    f"Aquecimento pausado automaticamente. Verifique o uso deste chip."
                ),
            ))
            db.commit()

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

        # ── Registro de mensagem recebida (sinal anti-ban) ───────────────────
        db.add(models.ChipHealthLog(session_id=sess.id, ack=99))
        db.commit()

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

        # ── Chip virtual em aquecimento → auto-resposta ──────────────────────
        tipo_chip = getattr(sess, "tipo_chip", "fisico")
        print(f"[WEBHOOK] Sessão '{sess.session_id}' tipo_chip={tipo_chip}")
        if tipo_chip == "virtual" and not is_group:
            aq_virtual = (
                db.query(models.AquecimentoConfig)
                .filter(
                    models.AquecimentoConfig.session_id == sess.id,
                    models.AquecimentoConfig.status.in_([
                        models.AquecimentoStatus.ativo,
                        models.AquecimentoStatus.manutencao,
                    ]),
                )
                .first()
            )
            if aq_virtual:
                # Captura tudo ANTES do commit para não acessar ORM expirado
                _session_waha_id = sess.session_id
                _aq_id = aq_virtual.id
                _body_text = payload.get("body") or payload.get("text") or ""
                _user_key = None
                try:
                    if sess.user:
                        _user_key = sess.user.gemini_api_key
                except Exception:
                    pass

                aq_virtual.msgs_recebidas = (getattr(aq_virtual, "msgs_recebidas", 0) or 0) + 1
                db.commit()

                print(f"🤖 Virtual '{_session_waha_id}' (aq#{_aq_id}) recebeu de {phone[:6]}*** — disparando auto-resposta")

                # Armazena referência forte para evitar GC antes de completar
                task = asyncio.create_task(
                    resposta_automatica_virtual(
                        session_waha_id=_session_waha_id,
                        to_phone=phone,
                        mensagem_recebida=_body_text,
                        aq_id=_aq_id,
                        user_key=_user_key,
                    )
                )
                _background_tasks.add(task)
                task.add_done_callback(_background_tasks.discard)
            else:
                print(f"[WEBHOOK] Virtual '{sess.session_id}' sem AquecimentoConfig ativo — sem auto-resposta")

    # ── message.ack (entregue / lido / erro) ──────────────────────────────────
    elif event in ("message.ack", "message_ack") and sess:
        ack_val = payload.get("ack") or payload.get("status") or 0
        msg_key = payload.get("key") or {}
        waha_msg_id = msg_key.get("id") if isinstance(msg_key, dict) else None
        if not waha_msg_id:
            waha_msg_id = payload.get("id")

        # ── Registrar ACK no health log ───────────────────────────────────────
        db.add(models.ChipHealthLog(session_id=sess.id, ack=ack_val))
        db.commit()

        # ── ACK=-1 (erro de entrega): avaliar risco e acionar ações automáticas
        if ack_val == -1:
            from fuzzy_chip import calcular_risco_ban
            try:
                risco_info  = calcular_risco_ban(sess, db)
                risco_score = risco_info["risco"]
                now_ts      = datetime.now(timezone.utc)

                # Anti-spam: só cria alerta se não houve um nos últimos 30 minutos
                ultimo_alerta = (
                    db.query(models.AtividadeLog)
                    .filter(
                        models.AtividadeLog.user_id   == sess.user_id,
                        models.AtividadeLog.tipo      == "chip_risco",
                        models.AtividadeLog.descricao.like(f"%{sess.name}%"),
                        models.AtividadeLog.criado_em >= now_ts - timedelta(minutes=30),
                    )
                    .first()
                )

                if risco_score > 80 and not ultimo_alerta:
                    # Pausa aquecimento ativo
                    aq = (
                        db.query(models.AquecimentoConfig)
                        .filter(
                            models.AquecimentoConfig.session_id == sess.id,
                            models.AquecimentoConfig.status     == models.AquecimentoStatus.ativo,
                        )
                        .first()
                    )
                    if aq:
                        aq.status = models.AquecimentoStatus.pausado
                        db.commit()

                    # Pausa campanhas ativas que usam este chip
                    campanhas_ativas = (
                        db.query(models.Campaign)
                        .join(models.CampaignSession,
                              models.Campaign.id == models.CampaignSession.campaign_id)
                        .filter(
                            models.CampaignSession.session_id == sess.id,
                            models.Campaign.status == models.CampaignStatus.running,
                        )
                        .all()
                    )
                    for camp in campanhas_ativas:
                        camp.status = models.CampaignStatus.paused
                    if campanhas_ativas:
                        db.commit()

                    db.add(models.AtividadeLog(
                        user_id=sess.user_id,
                        tipo="chip_risco",
                        descricao=(
                            f"🚨 BAN IMINENTE: Chip '{sess.name}' risco {risco_score}%! "
                            f"Campanhas e aquecimento pausados automaticamente."
                        ),
                    ))
                    db.commit()
                    print(f"[RISCO-BAN] 🚨 {sess.name} risco={risco_score} — tudo pausado")

                elif risco_score > 60 and not ultimo_alerta:
                    db.add(models.AtividadeLog(
                        user_id=sess.user_id,
                        tipo="chip_risco",
                        descricao=(
                            f"⚠️ ATENÇÃO: Chip '{sess.name}' com risco de ban {risco_score}%. "
                            f"Considere reduzir os disparos."
                        ),
                    ))
                    db.commit()
                    print(f"[RISCO-BAN] ⚠️ {sess.name} risco={risco_score} — alerta criado")

            except Exception as _exc:
                print(f"[RISCO-BAN] Erro ao calcular risco: {_exc}")

        # ── Atualizar status de entrega na campanha ───────────────────────────
        if waha_msg_id and ack_val in (2, 3):
            cc = (
                db.query(models.CampaignContact)
                .filter(models.CampaignContact.waha_message_id == str(waha_msg_id))
                .first()
            )
            if cc:
                now_ts = datetime.now(timezone.utc)
                if ack_val >= 2 and not cc.delivered_at:
                    cc.delivered_at = now_ts
                if ack_val >= 3 and not cc.read_at:
                    cc.read_at = now_ts
                db.commit()

    return {"ok": True}
