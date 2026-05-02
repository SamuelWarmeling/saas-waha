import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import httpx
import asyncio
import random
import io
import csv

import models
import auth
import ban_wave_detector
import health_monitor
import content_variator
import rate_limiter
from database import get_db, SessionLocal
from config import settings, PLANS

BRAZIL_TZ = timezone(timedelta(hours=-3))
_ACTIVE_HOURS = (7, 21)       # 07:00–20:59 hora de Brasília
_PEAK_HOURS   = (9, 18)       # horário comercial: delay × 0.8
_LUNCH_HOUR   = 12            # almoço: delay × 1.5
_WEEKEND_FACTOR = 2.0         # fim de semana: delay × 2
_NEW_CHAT_DELAY = 3.0         # segundos de delay extra para primeiro contato
_BURST_MSGS     = 3           # primeiras N msgs de cada sessão: delay dividido por 3

router = APIRouter(prefix="/api/campanhas", tags=["Campanhas"])

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

_queue_lock = asyncio.Lock()
_active_campaign_tasks: set[int] = set()  # guard contra task duplicada

# ── Schemas ──────────────────────────────────────────────────────────────────

class MessageItem(BaseModel):
    tipo: str = "text"       # text | image | file | audio | buttons
    text: str = ""
    media_url: Optional[str] = None
    media_filename: Optional[str] = None
    botoes: Optional[List[dict]] = None


class ContatosPreviewRequest(BaseModel):
    fonte: str = "lista"          # lista | grupo | ddd | manual | leads
    grupo_ids: Optional[List[int]] = None
    ddds: Optional[List[str]] = None
    limite: Optional[int] = None
    aleatorio: bool = False
    contatos_manual: Optional[List[str]] = None   # legado: strings de telefone
    contact_ids: Optional[List[int]] = None        # manual picker: IDs de contatos
    min_score: Optional[int] = None               # leads: score mínimo de grupos em comum


class CampaignCreate(BaseModel):
    name: str
    messages: Optional[List[str]] = None      # legado: lista de textos
    message_items: Optional[List[MessageItem]] = None  # novo: lista rica
    session_ids: Optional[List[int]] = []     # opcional — campanha pode ser rascunho sem chip
    # Seleção de contatos por fonte
    fonte: str = "lista"          # lista | grupo | ddd | manual | leads
    contact_ids: Optional[List[int]] = None   # legado / lista com IDs específicos
    grupo_ids: Optional[List[int]] = None
    ddds: Optional[List[str]] = None
    min_score: Optional[int] = None           # leads: score mínimo de grupos em comum
    limite: Optional[int] = None
    aleatorio: bool = False
    contatos_manual: Optional[List[str]] = None
    # Config
    delay_min: Optional[int] = 3
    delay_max: Optional[int] = 8
    media_url: Optional[str] = None
    ordem_mensagens: Optional[str] = "aleatorio"
    usar_chips_sistema: bool = False           # usa chips is_system do admin
    scheduled_at: Optional[datetime] = None   # agendamento

    def get_message_items(self) -> List[MessageItem]:
        """Retorna message_items normalizados (prioriza message_items, cai em messages)."""
        if self.message_items:
            return self.message_items
        if self.messages:
            items = []
            for m in self.messages:
                m = (m or "").strip()
                if m:
                    items.append(MessageItem(tipo="text", text=m))
            return items
        return []


class CampaignOut(BaseModel):
    id: int
    name: str
    message: Optional[str]
    messages: List[str] = []
    message_items: Optional[List[dict]] = None
    session_ids: List[int] = []
    status: str
    total_contacts: int
    sent_count: int
    success_count: int
    fail_count: int
    delay_min: int
    delay_max: int
    ordem_mensagens: str = "aleatorio"
    media_url: Optional[str]
    scheduled_at: Optional[datetime]
    created_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]

    class Config:
        from_attributes = True


class CampaignProgress(BaseModel):
    id: int
    status: str
    total_contacts: int
    sent_count: int
    success_count: int
    fail_count: int
    percent: float


# ── Helpers ──────────────────────────────────────────────────────────────────

_OPT_OUT_FOOTER = "\n\n_Responda PARAR para sair da lista._"
# Pausa longa após enviar N mensagens seguidas (simula pausa humana)
_PAUSE_EVERY_N = 50
_PAUSE_MIN_SECS = 600   # 10 minutos
_PAUSE_MAX_SECS = 900   # 15 minutos


def human_delay(min_ms: int, max_ms: int, text: str = "") -> float:
    """Delay gaussiano em segundos simulando digitacao humana."""
    mean = (min_ms + max_ms) / 2
    std = (max_ms - min_ms) / 6
    base = max(float(min_ms), min(float(max_ms), random.gauss(mean, std)))
    typing_ms = len(text) * 30  # 30ms por caractere
    return (base + typing_ms) / 1000.0


def _normalizar_phone(raw: str) -> str:
    """Normaliza número para formato 55XXXXXXXXXXX."""
    digits = "".join(c for c in raw if c.isdigit())
    if digits and not digits.startswith("55") and len(digits) in (10, 11):
        digits = "55" + digits
    return digits


def _resolver_contatos(
    fonte: str,
    user_id: int,
    db: Session,
    grupo_ids: Optional[List[int]] = None,
    ddds: Optional[List[str]] = None,
    limite: Optional[int] = None,
    aleatorio: bool = False,
    contact_ids: Optional[List[int]] = None,
    contatos_manual: Optional[List[str]] = None,
    min_score: Optional[int] = None,
) -> List[models.Contact]:
    """Resolve lista de contatos de acordo com a fonte selecionada."""
    contacts: List[models.Contact] = []

    if fonte == "leads":
        score_minimo = min_score if min_score is not None else 1
        contacts = (
            db.query(models.Contact)
            .filter(
                models.Contact.user_id == user_id,
                models.Contact.is_blacklisted == False,
                models.Contact.group_score.isnot(None),
                models.Contact.group_score >= score_minimo,
            )
            .order_by(models.Contact.group_score.desc())
            .all()
        )

    elif fonte == "manual":
        if contact_ids:
            # Picker visual: contatos selecionados por ID
            contacts = (
                db.query(models.Contact)
                .filter(
                    models.Contact.user_id == user_id,
                    models.Contact.id.in_(contact_ids),
                    models.Contact.is_blacklisted == False,
                )
                .all()
            )
        elif contatos_manual:
            # Legado: strings de telefone digitadas manualmente
            seen_phones: set = set()
            for raw in contatos_manual:
                phone = _normalizar_phone(raw.strip())
                if not phone or len(phone) not in (12, 13) or phone in seen_phones:
                    continue
                seen_phones.add(phone)
                c = db.query(models.Contact).filter(
                    models.Contact.user_id == user_id,
                    models.Contact.phone == phone,
                ).first()
                if not c:
                    c = models.Contact(user_id=user_id, phone=phone)
                    db.add(c)
                    db.flush()
                if not c.is_blacklisted:
                    contacts.append(c)

    elif fonte == "grupo" and grupo_ids:
        members = (
            db.query(models.GroupMember)
            .join(models.Group, models.GroupMember.group_id == models.Group.id)
            .filter(
                models.Group.id.in_(grupo_ids),
                models.Group.user_id == user_id,
                models.GroupMember.status == "ativo",
            )
            .all()
        )
        seen_phones: set = set()
        for m in members:
            phone = (m.phone or "").strip()
            if not phone or phone in seen_phones:
                continue
            seen_phones.add(phone)
            c = None
            if m.contact_id:
                c = db.query(models.Contact).filter(
                    models.Contact.id == m.contact_id,
                    models.Contact.user_id == user_id,
                ).first()
            if not c:
                c = db.query(models.Contact).filter(
                    models.Contact.user_id == user_id,
                    models.Contact.phone == phone,
                ).first()
            if not c:
                c = models.Contact(user_id=user_id, phone=phone, name=m.name)
                db.add(c)
                db.flush()
            if c and not c.is_blacklisted:
                contacts.append(c)

    elif fonte == "ddd" and ddds:
        ddd_filters = [
            models.Contact.phone.like(f"55{ddd.strip()}%")
            for ddd in ddds if ddd.strip()
        ]
        if ddd_filters:
            contacts = (
                db.query(models.Contact)
                .filter(
                    models.Contact.user_id == user_id,
                    models.Contact.is_blacklisted == False,
                    or_(*ddd_filters),
                )
                .all()
            )

    else:
        # lista (padrão): todos os contatos, ou subset por contact_ids
        base_q = db.query(models.Contact).filter(
            models.Contact.user_id == user_id,
            models.Contact.is_blacklisted == False,
        )
        if contact_ids:
            base_q = base_q.filter(models.Contact.id.in_(contact_ids))
        contacts = base_q.all()

    if aleatorio:
        random.shuffle(contacts)
    if limite and limite > 0:
        contacts = contacts[:limite]

    return contacts


def _chips_ativos_count(user_id: int, db: Session) -> int:
    """Retorna o número de campanhas em execução ativa para o usuário."""
    return (
        db.query(models.Campaign)
        .filter(
            models.Campaign.user_id == user_id,
            models.Campaign.status == models.CampaignStatus.running,
        )
        .count()
    )


async def _start_next_queued(user_id: int):
    """Se houver slot livre, inicia a campanha mais antiga na fila do usuário."""
    async with _queue_lock:
        db = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            if not user:
                return
            limite = getattr(user, "chips_disparo_simultaneo", 3)
            em_uso = _chips_ativos_count(user_id, db)
            if em_uso >= limite:
                return
            queued = (
                db.query(models.Campaign)
                .filter(
                    models.Campaign.user_id == user_id,
                    models.Campaign.status == models.CampaignStatus.queued,
                )
                .order_by(models.Campaign.created_at.asc())
                .first()
            )
            if queued:
                queued.status = models.CampaignStatus.running
                queued.started_at = datetime.now(timezone.utc)
                db.commit()
                asyncio.create_task(send_campaign(queued.id, user_id))
        finally:
            db.close()


def _load_campaign_q(db: Session):
    return db.query(models.Campaign).options(
        joinedload(models.Campaign.messages),
        joinedload(models.Campaign.campaign_sessions),
    )


def _campaign_out(c: models.Campaign) -> dict:
    msgs = sorted(c.messages, key=lambda m: m.ordem)
    message_texts = [m.text or "" for m in msgs] if msgs else ([c.message] if c.message else [])
    session_ids = [cs.session_id for cs in c.campaign_sessions]
    message_items_out = [
        {
            "tipo": getattr(m, "tipo", "text") or "text",
            "text": m.text or "",
            "media_url": m.media_url,
            "media_filename": m.media_filename,
            "botoes": json.loads(m.botoes) if m.botoes else [],
        }
        for m in msgs
    ]
    return {
        "id": c.id,
        "name": c.name,
        "message": c.message,
        "messages": message_texts,
        "message_items": message_items_out,
        "session_ids": session_ids,
        "status": c.status,
        "total_contacts": c.total_contacts,
        "sent_count": c.sent_count,
        "success_count": c.success_count,
        "fail_count": c.fail_count,
        "delay_min": c.delay_min,
        "delay_max": c.delay_max,
        "ordem_mensagens": c.ordem_mensagens or "aleatorio",
        "media_url": c.media_url,
        "usar_chips_sistema": getattr(c, "usar_chips_sistema", False),
        "scheduled_at": c.scheduled_at,
        "created_at": c.created_at,
        "started_at": c.started_at,
        "completed_at": c.completed_at,
    }


async def _send_waha_message(
    client: httpx.AsyncClient,
    session_waha_id: str,
    phone: str,
    msg: models.CampaignMessage,
    headers: dict,
) -> tuple[str, str]:
    """
    Envia uma mensagem via WAHA de acordo com o tipo.
    Retorna (status_code_str, response_text).
    """
    base = settings.WAHA_API_URL
    chat_id = phone if phone.endswith("@c.us") else f"{phone}@c.us"
    payload_base = {"session": session_waha_id, "chatId": chat_id}
    tipo = getattr(msg, "tipo", None) or "text"

    def media_file_obj(url: str) -> dict:
        """Monta o objeto file para o WAHA com URL absoluta."""
        if url and url.startswith("/"):
            url = f"{settings.BACKEND_URL}{url}"
        return {"url": url}

    if tipo == "image":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendImage",
            json={**payload_base, "file": media_file_obj(url), "caption": msg.text or ""},
            headers=headers,
        )
    elif tipo == "file":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendFile",
            json={**payload_base, "file": {**media_file_obj(url), "filename": msg.media_filename or "arquivo"},
                  "caption": msg.text or ""},
            headers=headers,
        )
    elif tipo == "audio":
        url = msg.media_url or ""
        resp = await client.post(
            f"{base}/api/sendVoice",
            json={**payload_base, "file": media_file_obj(url)},
            headers=headers,
        )
    elif tipo == "buttons":
        try:
            botoes = json.loads(msg.botoes or "[]")
        except Exception:
            botoes = []
        buttons_payload = []
        for b in botoes:
            if b.get("tipo") == "link":
                buttons_payload.append({"type": "url", "url": b.get("valor", ""), "title": b.get("texto", "")})
            else:
                buttons_payload.append({"type": "reply", "id": b.get("id", str(random.randint(1, 9999))), "title": b.get("texto", "")})
        resp = await client.post(
            f"{base}/api/sendButtons",
            json={**payload_base, "body": msg.text or "", "buttons": buttons_payload},
            headers=headers,
        )
    else:
        # text (default)
        resp = await client.post(
            f"{base}/api/sendText",
            json={**payload_base, "text": msg.text or ""},
            headers=headers,
        )

    return resp.status_code, resp.text


# ── Background task de disparo ────────────────────────────────────────────────

async def send_campaign(campaign_id: int, user_id: int):
    # ── Guard contra task duplicada ─────────────────────────────────────────
    if campaign_id in _active_campaign_tasks:
        print(f"[CAMPANHA-{campaign_id}] ⚠️  Task duplicada detectada — abortando (já existe uma task rodando)")
        return
    _active_campaign_tasks.add(campaign_id)

    db = SessionLocal()
    try:
        campaign = db.query(models.Campaign).filter(
            models.Campaign.id == campaign_id
        ).first()
        if not campaign:
            return

        # Garante status running (pode já estar marcado pelo endpoint)
        if campaign.status != models.CampaignStatus.running:
            campaign.status = models.CampaignStatus.running
            campaign.started_at = datetime.now(timezone.utc)
            db.commit()

        # Configurações de disparo do usuário
        user = db.query(models.User).filter(models.User.id == user_id).first()
        user_delay_min = user.dispatch_delay_min if user else 5
        user_delay_max = user.dispatch_delay_max if user else 15

        # Mensagens
        db_msgs = db.query(models.CampaignMessage).filter(
            models.CampaignMessage.campaign_id == campaign_id
        ).order_by(models.CampaignMessage.ordem).all()

        if not db_msgs and campaign.message:
            db_msgs = [models.CampaignMessage(
                campaign_id=campaign_id, text=campaign.message, ordem=0, tipo="text"
            )]

        if not db_msgs:
            campaign.status = models.CampaignStatus.cancelled
            db.commit()
            return

        # Sessões (chips)
        usar_sistema = getattr(campaign, "usar_chips_sistema", False)
        if usar_sistema:
            sessoes_candidatas = db.query(models.WhatsAppSession).filter(
                models.WhatsAppSession.is_system == True,
                models.WhatsAppSession.system_disponivel == True,
                models.WhatsAppSession.status == models.SessionStatus.connected,
            ).order_by(models.WhatsAppSession.system_msgs_hoje.asc()).all()
            if not sessoes_candidatas:
                campaign.status = models.CampaignStatus.cancelled
                db.commit()
                print(f"[CAMPANHA-{campaign_id}] ❌ Nenhum chip do sistema disponível")
                return
        else:
            camp_sess = db.query(models.CampaignSession).filter(
                models.CampaignSession.campaign_id == campaign_id
            ).all()
            session_ids = [cs.session_id for cs in camp_sess] if camp_sess else (
                [campaign.session_id] if campaign.session_id else []
            )
            if not session_ids:
                campaign.status = models.CampaignStatus.cancelled
                db.commit()
                return

            sessoes_candidatas = db.query(models.WhatsAppSession).filter(
                models.WhatsAppSession.id.in_(session_ids)
            ).all()
            if not sessoes_candidatas:
                campaign.status = models.CampaignStatus.cancelled
                db.commit()
                return

        n_chips = len(sessoes_candidatas)

        # ── Ban wave check antes de disparar ─────────────────────────────────
        if ban_wave_detector.is_system_paused():
            until = ban_wave_detector.paused_until()
            print(
                f"[CAMPANHA-{campaign_id}] Sistema pausado por ban wave ate "
                f"{until.strftime('%H:%M UTC') if until else '?'} — abortando"
            )
            campaign.status = models.CampaignStatus.paused
            db.commit()
            return

        # ── Contatos pendentes ───────────────────────────────────────────────
        pending = (
            db.query(models.CampaignContact)
            .filter(
                models.CampaignContact.campaign_id == campaign_id,
                models.CampaignContact.status == models.ContactStatus.pending,
            )
            .order_by(models.CampaignContact.id)
            .all()
        )
        total = len(pending)

        if total == 0:
            campaign.status = models.CampaignStatus.completed
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            asyncio.create_task(_start_next_queued(user_id))
            return

        # ── Hot leads: prioriza contatos que já responderam (funil quente/morno) ─
        contact_ids_list = [cc.contact_id for cc in pending]
        if contact_ids_list:
            try:
                funnel_rows = db.query(
                    models.FunnelContato.contato_id,
                    models.FunnelContato.temperatura,
                ).filter(
                    models.FunnelContato.contato_id.in_(contact_ids_list),
                ).all()
                funnel_temp_map: dict[int, str] = {}
                _priority_order = {
                    models.FunnelTemperatura.convertido: 0,
                    models.FunnelTemperatura.quente: 0,
                    models.FunnelTemperatura.morno: 1,
                    models.FunnelTemperatura.frio: 2,
                }
                for row in funnel_rows:
                    curr = funnel_temp_map.get(row.contato_id)
                    new_p = _priority_order.get(row.temperatura, 2)
                    if curr is None or new_p < _priority_order.get(curr, 2):
                        funnel_temp_map[row.contato_id] = row.temperatura

                def _lead_priority(cc):
                    return _priority_order.get(funnel_temp_map.get(cc.contact_id), 2)

                hot_count = sum(1 for cc in pending if _lead_priority(cc) == 0)
                pending.sort(key=_lead_priority)
                if hot_count > 0:
                    print(f"[CAMPANHA-{campaign_id}] {hot_count} leads quentes priorizados na fila")
            except Exception as _e:
                print(f"[CAMPANHA-{campaign_id}] Aviso: hot leads prioritization falhou: {_e}")

        # ── Pré-distribuição: cada contato recebe exatamente 1 chip ─────────
        session_map: dict[int, models.WhatsAppSession] = {s.id: s for s in sessoes_candidatas}

        for i, cc in enumerate(pending):
            chip_idx = i * n_chips // total
            cc.session_id = sessoes_candidatas[chip_idx].id
        db.commit()

        for chip_idx, sess in enumerate(sessoes_candidatas):
            start_i = chip_idx * total // n_chips
            end_i = (chip_idx + 1) * total // n_chips
            if start_i < end_i:
                print(
                    f"[CAMPANHA-{campaign_id}] Chip {sess.session_id}: "
                    f"contatos {start_i + 1}–{end_i} ({end_i - start_i} contatos)"
                )

        ordem = campaign.ordem_mensagens or "aleatorio"
        headers = {}
        if settings.WAHA_API_KEY:
            headers["X-Api-Key"] = settings.WAHA_API_KEY

        # ── Rastreamento de block rate por chip ──────────────────────────────
        # chip_waha_id -> (enviados, falhas)
        _chip_stats: dict[str, list[int]] = {}
        # chip_waha_id -> msgs enviadas nesta execucao (burst allowance)
        _burst_sent: dict[str, int] = {}
        # phones ja contatados nesta execucao por chip (new-chat delay)
        _contacted: dict[str, set] = {}

        def _check_block_rate(chip_waha_id: str) -> str:
            """Verifica block rate do chip. Retorna 'ok' | 'alert' | 'pause'."""
            stats = _chip_stats.get(chip_waha_id, [0, 0])
            total_sent, total_failed = stats
            if total_sent < 10:
                return "ok"
            rate = total_failed / total_sent
            if rate > 0.10:
                return "pause"
            if rate > 0.05:
                return "alert"
            return "ok"

        # Contador de msgs enviadas na sessao atual (para pausa a cada 50)
        msgs_nesta_sessao = 0

        async with httpx.AsyncClient(timeout=30.0) as client:
            for contact_index, cc in enumerate(pending):

                # Verificar pause/cancel
                db.refresh(campaign)
                if campaign.status in (
                    models.CampaignStatus.paused,
                    models.CampaignStatus.cancelled,
                ):
                    print(f"[CAMPANHA-{campaign_id}] Interrompido (status={campaign.status})")
                    break

                # Ban wave check periodico
                if ban_wave_detector.is_system_paused():
                    print(f"[CAMPANHA-{campaign_id}] Ban wave detectada durante disparo — pausando")
                    campaign.status = models.CampaignStatus.paused
                    db.commit()
                    break

                # Re-check status: pula se já foi processado
                db.refresh(cc)
                if cc.status != models.ContactStatus.pending:
                    continue

                contact = cc.contact
                if contact.is_blacklisted:
                    cc.status = models.ContactStatus.skipped
                    campaign.sent_count += 1
                    db.commit()
                    continue

                # Chip pré-atribuído
                used_session = session_map.get(cc.session_id)
                if not used_session:
                    used_session = sessoes_candidatas[contact_index % n_chips]

                # Para chips do sistema: checar limite diário
                if usar_sistema:
                    db.refresh(used_session)
                    if used_session.system_msgs_hoje >= used_session.system_max_msgs_dia:
                        chips_com_capacidade = [
                            s for s in sessoes_candidatas
                            if s.system_msgs_hoje < s.system_max_msgs_dia
                            and s.system_disponivel
                        ]
                        if not chips_com_capacidade:
                            print(f"[CAMPANHA-{campaign_id}] Todos os chips do sistema atingiram o limite diário")
                            break
                        used_session = min(chips_com_capacidade, key=lambda s: s.system_msgs_hoje)

                # Chip pausado manualmente
                db.refresh(used_session)
                if getattr(used_session, "pausado_manualmente", False):
                    print(
                        f"[CAMPANHA-{campaign_id}] Chip {used_session.session_id} "
                        f"pausado manualmente — pulando"
                    )
                    # Tenta próximo chip se disponível, senão pausa campanha
                    alt_chips = [
                        s for s in sessoes_candidatas
                        if s.id != used_session.id
                        and not getattr(s, "pausado_manualmente", False)
                    ]
                    if alt_chips:
                        used_session = alt_chips[contact_index % len(alt_chips)]
                    else:
                        campaign.status = models.CampaignStatus.paused
                        db.commit()
                        break

                # Smart Scheduler: verifica horário ativo (7h–21h BR)
                now_br = datetime.now(BRAZIL_TZ)
                hora_br  = now_br.hour
                weekday  = now_br.weekday()  # 0=seg … 6=dom
                if hora_br < _ACTIVE_HOURS[0] or hora_br >= _ACTIVE_HOURS[1]:
                    print(
                        f"[CAMPANHA-{campaign_id}] Fora do horário ativo "
                        f"({hora_br}h BR, permitido {_ACTIVE_HOURS[0]}h–{_ACTIVE_HOURS[1]}h) — pausando"
                    )
                    campaign.status = models.CampaignStatus.paused
                    db.commit()
                    break

                # Health monitor: verifica risco do chip
                hm_action = health_monitor.get_action(used_session.session_id)
                if hm_action == "stop":
                    score = health_monitor.get_score(used_session.session_id)
                    print(
                        f"[CAMPANHA-{campaign_id}] Chip {used_session.session_id} "
                        f"score critico ({score}) — parando campanha"
                    )
                    campaign.status = models.CampaignStatus.paused
                    db.commit()
                    break

                # Rate limiter: verifica limite por minuto/hora/dia
                rl_ok, rl_wait = rate_limiter.can_send(used_session.session_id)
                if not rl_ok:
                    if rl_wait > 90:
                        # Limite diário ou horário esgotado — pausa
                        print(
                            f"[CAMPANHA-{campaign_id}] Rate limit chip {used_session.session_id}: "
                            f"aguardaria {rl_wait:.0f}s — pausando campanha"
                        )
                        campaign.status = models.CampaignStatus.paused
                        db.commit()
                        break
                    else:
                        # Limite por minuto — aguarda (≤ 90s)
                        print(
                            f"[CAMPANHA-{campaign_id}] Rate limit chip {used_session.session_id}: "
                            f"aguardando {rl_wait:.1f}s"
                        )
                        await asyncio.sleep(rl_wait)

                # Block rate: verifica antes de enviar
                br_status = _check_block_rate(used_session.session_id)
                if br_status == "pause":
                    blk_stats = _chip_stats.get(used_session.session_id, [0, 0])
                    rate_pct = round(blk_stats[1] / blk_stats[0] * 100, 1) if blk_stats[0] else 0
                    print(
                        f"[CAMPANHA-{campaign_id}] Block rate CRITICO {used_session.session_id}: "
                        f"{rate_pct}% — pausando campanha"
                    )
                    campaign.status = models.CampaignStatus.paused
                    db.commit()
                    break
                elif br_status == "alert":
                    blk_stats = _chip_stats.get(used_session.session_id, [0, 0])
                    rate_pct = round(blk_stats[1] / blk_stats[0] * 100, 1) if blk_stats[0] else 0
                    print(
                        f"[CAMPANHA-{campaign_id}] Block rate ALERTA {used_session.session_id}: "
                        f"{rate_pct}% (>5%) — alertando"
                    )

                # Escolher mensagem
                if ordem == "sequencial":
                    msg = db_msgs[contact_index % len(db_msgs)]
                else:
                    msg = random.choice(db_msgs)

                # Personalizar texto com {nome} e aplicar content variator
                if msg.text:
                    msg_copy = models.CampaignMessage.__new__(models.CampaignMessage)
                    msg_copy.__dict__.update(msg.__dict__)
                    personalized = msg.text.replace("{nome}", contact.name or "Cliente")
                    # Adicionar opt-out footer na primeira mensagem (somente texto)
                    is_first_msg = (contact_index == 0)
                    if is_first_msg and msg.tipo in ("text", None, ""):
                        personalized += _OPT_OUT_FOOTER
                    # Variar conteudo para evitar fingerprint de spam
                    msg_copy.text = content_variator.vary_message(personalized)
                    msg = msg_copy

                phone = contact.phone
                print(
                    f"[CAMPANHA-{campaign_id}] Chip {used_session.session_id} "
                    f"-> {phone} ({contact_index + 1}/{total})"
                )

                # Calcula delay com jitter gaussiano + risco do chip + smart scheduler
                delay_min_ms = user_delay_min * 1000
                delay_max_ms = user_delay_max * 1000
                hm_multiplier = health_monitor.get_delay_multiplier(used_session.session_id)
                if hm_multiplier > 1.0:
                    delay_min_ms = int(delay_min_ms * hm_multiplier)
                    delay_max_ms = int(delay_max_ms * hm_multiplier)

                # Smart scheduler factors
                sched_factor = 1.0
                if weekday >= 5:  # fim de semana
                    sched_factor *= _WEEKEND_FACTOR
                if hora_br == _LUNCH_HOUR:  # almoço
                    sched_factor *= 1.5
                if _PEAK_HOURS[0] <= hora_br < _PEAK_HOURS[1]:  # horário comercial
                    sched_factor *= 0.8
                if sched_factor != 1.0:
                    delay_min_ms = int(delay_min_ms * sched_factor)
                    delay_max_ms = int(delay_max_ms * sched_factor)

                base_delay = human_delay(delay_min_ms, delay_max_ms, msg.text or "")

                # Burst allowance: primeiras 3 msgs de cada chip = delay / 3
                chip_burst_count = _burst_sent.get(used_session.session_id, 0)
                if chip_burst_count < _BURST_MSGS:
                    base_delay = max(0.5, base_delay / 3.0)

                # New-chat delay: primeiro contato com este número nesta execucao
                chip_key = used_session.session_id
                if chip_key not in _contacted:
                    _contacted[chip_key] = set()
                is_new_chat = contact.phone not in _contacted[chip_key]
                if is_new_chat:
                    base_delay += _NEW_CHAT_DELAY
                    _contacted[chip_key].add(contact.phone)

                try:
                    status_code, resp_text = await _send_waha_message(
                        client, used_session.session_id, phone, msg, headers
                    )

                    # Atualiza chip_stats
                    if used_session.session_id not in _chip_stats:
                        _chip_stats[used_session.session_id] = [0, 0]
                    _chip_stats[used_session.session_id][0] += 1

                    if status_code == 201:
                        cc.status = models.ContactStatus.sent
                        campaign.success_count += 1
                        msgs_nesta_sessao += 1
                        rate_limiter.record_send(used_session.session_id)
                        _burst_sent[used_session.session_id] = _burst_sent.get(used_session.session_id, 0) + 1
                        used_session.ultima_atividade = datetime.now(timezone.utc)
                        print(f"[CAMPANHA-{campaign_id}] OK {phone} via {used_session.session_id}")
                        try:
                            resp_json = json.loads(resp_text)
                            waha_id = resp_json.get("id") or resp_json.get("key", {}).get("id")
                            if waha_id:
                                cc.waha_message_id = str(waha_id)
                        except Exception:
                            pass
                    else:
                        cc.status = models.ContactStatus.failed
                        cc.error_message = resp_text[:200]
                        campaign.fail_count += 1
                        _chip_stats[used_session.session_id][1] += 1
                        # Health monitor: registra erro HTTP
                        health_monitor.record_http_error(used_session.session_id, status_code)
                        if status_code not in (200, 201):
                            health_monitor.record_send_failure(used_session.session_id)
                        print(
                            f"[CAMPANHA-{campaign_id}] FALHA {phone} "
                            f"HTTP {status_code}: {resp_text[:100]}"
                        )

                except Exception as e:
                    cc.status = models.ContactStatus.failed
                    cc.error_message = str(e)[:200]
                    campaign.fail_count += 1
                    if used_session.session_id in _chip_stats:
                        _chip_stats[used_session.session_id][1] += 1
                    health_monitor.record_send_failure(used_session.session_id)
                    print(f"[CAMPANHA-{campaign_id}] EXCECAO {phone}: {e}")

                cc.sent_at = datetime.now(timezone.utc)
                campaign.sent_count += 1
                if usar_sistema:
                    used_session.system_msgs_hoje += 1
                else:
                    used_session.messages_sent_today += 1
                db.commit()

                # ── Reply ratio guard: verifica a cada 50 msgs ───────────────
                if msgs_nesta_sessao > 0 and msgs_nesta_sessao % 50 == 0:
                    rr_stats = _chip_stats.get(used_session.session_id, [0, 0])
                    if rr_stats[0] >= 10:
                        fail_ratio = rr_stats[1] / rr_stats[0]
                        if fail_ratio > 0.20:
                            print(
                                f"[CAMPANHA-{campaign_id}] Chip {used_session.session_id} "
                                f"ratio muito baixo ({fail_ratio:.0%}) — pausando campanha"
                            )
                            campaign.status = models.CampaignStatus.paused
                            db.commit()
                            break
                        elif fail_ratio > 0.10:
                            print(
                                f"[CAMPANHA-{campaign_id}] Chip {used_session.session_id} "
                                f"reply ratio baixo ({fail_ratio:.0%}) — reduzindo velocidade 50%"
                            )
                            await asyncio.sleep(base_delay * 1.5)

                # Pausa longa a cada 50 mensagens (simula pausa humana)
                if msgs_nesta_sessao > 0 and msgs_nesta_sessao % _PAUSE_EVERY_N == 0:
                    pause_secs = random.randint(_PAUSE_MIN_SECS, _PAUSE_MAX_SECS)
                    print(
                        f"[CAMPANHA-{campaign_id}] Pausa de {pause_secs // 60}min "
                        f"apos {msgs_nesta_sessao} msgs (anti-ban)"
                    )
                    await asyncio.sleep(pause_secs)
                else:
                    await asyncio.sleep(base_delay)

        # Finaliza
        db.refresh(campaign)
        if campaign.status == models.CampaignStatus.running:
            campaign.status = models.CampaignStatus.completed
            campaign.completed_at = datetime.now(timezone.utc)
            db.commit()
            print(f"[CAMPANHA-{campaign_id}] 🏁 Concluída")

        asyncio.create_task(_start_next_queued(user_id))

    finally:
        _active_campaign_tasks.discard(campaign_id)
        db.close()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=List[CampaignOut])
def list_campaigns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaigns = (
        _load_campaign_q(db)
        .filter(models.Campaign.user_id == current_user.id)
        .order_by(models.Campaign.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return [_campaign_out(c) for c in campaigns]


@router.post("/upload-media")
async def upload_media(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    """Faz upload de arquivo de mídia (imagem, PDF, áudio) para uso em campanhas."""
    # Determinar tipo de mídia pelo mimetype
    content_type = file.content_type or ""
    if content_type.startswith("image/"):
        tipo = "image"
    elif content_type.startswith("audio/"):
        tipo = "audio"
    elif content_type in ("application/pdf", "application/msword",
                          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                          "application/vnd.ms-excel",
                          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"):
        tipo = "file"
    else:
        tipo = "file"

    # Salvar arquivo
    user_dir = UPLOAD_DIR / str(current_user.id)
    user_dir.mkdir(exist_ok=True)

    ext = Path(file.filename or "arquivo").suffix or ""
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = user_dir / filename

    content = await file.read()
    file_path.write_bytes(content)

    relative_url = f"/uploads/{current_user.id}/{filename}"
    return {
        "url": relative_url,
        "tipo": tipo,
        "filename": file.filename,
        "size": len(content),
    }


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
def create_campaign(
    data: CampaignCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    if data.session_ids:
        sessions = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id.in_(data.session_ids),
            models.WhatsAppSession.user_id == current_user.id,
        ).all()
    else:
        sessions = []  # campanha rascunho sem chip — chip pode ser adicionado depois

    contacts = _resolver_contatos(
        fonte=data.fonte,
        user_id=current_user.id,
        db=db,
        grupo_ids=data.grupo_ids,
        ddds=data.ddds,
        limite=data.limite,
        aleatorio=data.aleatorio,
        contact_ids=data.contact_ids,
        contatos_manual=data.contatos_manual,
        min_score=data.min_score,
    )
    # Contatos 0 é permitido — campanha fica em rascunho até adicionar contatos depois

    message_items = data.get_message_items()
    if not message_items:
        raise HTTPException(status_code=400, detail="Adicione ao menos 1 mensagem")

    # Status inicial: agendada ou rascunho
    if data.scheduled_at:
        camp_status = models.CampaignStatus.scheduled
    else:
        camp_status = models.CampaignStatus.draft

    first_text = message_items[0].text if message_items else ""
    campaign = models.Campaign(
        user_id=current_user.id,
        name=data.name,
        message=first_text,
        session_id=sessions[0].id if sessions else None,
        delay_min=data.delay_min,
        delay_max=data.delay_max,
        media_url=data.media_url,
        ordem_mensagens=data.ordem_mensagens or "aleatorio",
        usar_chips_sistema=data.usar_chips_sistema,
        total_contacts=len(contacts),
        scheduled_at=data.scheduled_at,
        status=camp_status,
    )
    db.add(campaign)
    db.flush()

    # Mensagens ricas
    for i, item in enumerate(message_items):
        db.add(models.CampaignMessage(
            campaign_id=campaign.id,
            text=item.text,
            ordem=i,
            tipo=item.tipo,
            media_url=item.media_url,
            media_filename=item.media_filename,
            botoes=json.dumps(item.botoes) if item.botoes else None,
        ))

    for sess in sessions:
        db.add(models.CampaignSession(campaign_id=campaign.id, session_id=sess.id))

    for contact in contacts:
        db.add(models.CampaignContact(campaign_id=campaign.id, contact_id=contact.id))

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao salvar campanha no banco de dados: {str(e)}"
        )

    db.refresh(campaign)
    c = _load_campaign_q(db).filter(models.Campaign.id == campaign.id).first()
    return _campaign_out(c)


@router.get("/slots")
def get_slots(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna uso atual de slots de disparo simultâneo."""
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    na_fila = (
        db.query(models.Campaign)
        .filter(
            models.Campaign.user_id == current_user.id,
            models.Campaign.status == models.CampaignStatus.queued,
        )
        .count()
    )
    return {
        "em_uso": em_uso,
        "limite": limite,
        "disponiveis": max(0, limite - em_uso),
        "na_fila_count": na_fila,
    }


@router.get("/{campaign_id}/analise-risco")
def analise_risco_campanha(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Análise de risco anti-ban antes de disparar uma campanha. Score 0-100."""
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    msgs = db.query(models.CampaignMessage).filter(
        models.CampaignMessage.campaign_id == campaign_id
    ).order_by(models.CampaignMessage.ordem).all()

    camp_sessions_rows = db.query(models.CampaignSession).filter(
        models.CampaignSession.campaign_id == campaign_id
    ).all()
    session_ids = [cs.session_id for cs in camp_sessions_rows]
    sessions = (
        db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id.in_(session_ids)
        ).all()
        if session_ids else []
    )

    score = 0
    fatores = []
    recomendacoes = []

    # Fator 1: chip sem aquecimento (+20)
    if not sessions:
        score += 15
        fatores.append("Nenhum chip selecionado para a campanha")
        recomendacoes.append("Selecione pelo menos um chip conectado antes de disparar")
    else:
        chips_frios = [s for s in sessions if not getattr(s, "is_aquecido", False)]
        if chips_frios:
            score += 20
            names = ", ".join(s.name for s in chips_frios[:3])
            fatores.append(f"Chip(s) sem aquecimento completo: {names}")
            recomendacoes.append("Aqueça o chip por pelo menos 7 dias antes de usar em campanhas")

    # Fator 2: limite diário alto (+15)
    user = db.query(models.User).filter(models.User.id == current_user.id).first()
    if user and getattr(user, "dispatch_daily_limit", 200) > 200:
        score += 15
        fatores.append(f"Limite diário elevado: {user.dispatch_daily_limit} msgs/dia")
        recomendacoes.append("Reduza o limite para no máximo 200 msgs/dia inicialmente")

    # Fator 3: mensagens idênticas/sem variação (+25)
    if msgs:
        textos = [m.text or "" for m in msgs if m.tipo in ("text", "text", None)]
        textos_unicos = set(t for t in textos if t.strip())
        if len(textos_unicos) == 1:
            score += 25
            fatores.append("Todas as mensagens são idênticas (fingerprint de spam)")
            recomendacoes.append("Crie 2-3 variações da mensagem para reduzir detecção de spam")
    else:
        score += 20
        fatores.append("Nenhuma mensagem configurada na campanha")
        recomendacoes.append("Configure pelo menos uma mensagem antes de disparar")

    # Fator 4: chip com health score > 60 (+20)
    chips_risco = []
    for s in sessions:
        hs = health_monitor.get_score(s.session_id)
        if hs > 60:
            chips_risco.append(f"{s.name} (score={hs})")
    if chips_risco:
        score += 20
        fatores.append(f"Chips com risco elevado: {', '.join(chips_risco[:2])}")
        recomendacoes.append("Aguarde os chips de alto risco se recuperarem antes de disparar")

    # Fator 5: horário fora do comercial (+10) — usa BRT (UTC-3)
    now_utc_hour = datetime.now(timezone.utc).hour
    brt_hour = (now_utc_hour - 3) % 24
    if not (8 <= brt_hour <= 20):
        score += 10
        fatores.append(f"Horário fora do período comercial ({brt_hour}h BRT)")
        recomendacoes.append("Dispare entre 8h e 20h (horário de Brasília) para maior entrega")

    # Fator 6: contatos inválidos (+15)
    invalid_count = (
        db.query(models.CampaignContact)
        .join(models.Contact, models.CampaignContact.contact_id == models.Contact.id)
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.Contact.is_invalid == True,
        )
        .count()
    )
    if invalid_count > 0 and campaign.total_contacts > 0:
        pct = round(invalid_count / campaign.total_contacts * 100, 1)
        score += 15
        fatores.append(f"{invalid_count} contatos inválidos ({pct}% da lista)")
        recomendacoes.append("Remova os contatos inválidos antes de disparar para proteger o chip")

    # Fator 7: sem instrução de opt-out (+20) — opt-out é adicionado automaticamente
    # Apenas alerta se a campanha não tem nenhum texto (impossível adicionar footer)
    has_any_text = any((m.text or "").strip() for m in msgs)
    if msgs and not has_any_text:
        score += 20
        fatores.append("Campanha sem texto — opt-out automático não pode ser adicionado")
        recomendacoes.append("Adicione texto na mensagem para que o opt-out seja incluído automaticamente")

    # Fator 8: link na primeira mensagem (+10)
    if msgs:
        first_text = msgs[0].text or ""
        if "http://" in first_text or "https://" in first_text:
            score += 10
            fatores.append("Link detectado na primeira mensagem")
            recomendacoes.append("Envie o link em uma mensagem separada — links na 1ª msg aumentam detecção de spam")

    score = min(100, score)

    if score <= 30:
        nivel = "baixo"
        pode_disparar = True
    elif score <= 60:
        nivel = "medio"
        pode_disparar = True
    elif score <= 80:
        nivel = "alto"
        pode_disparar = True
    else:
        nivel = "critico"
        pode_disparar = False

    return {
        "score": score,
        "nivel": nivel,
        "fatores": fatores,
        "recomendacoes": recomendacoes,
        "pode_disparar": pode_disparar,
        "chips_total": len(sessions),
        "contatos_total": campaign.total_contacts,
    }


@router.get("/ddds-disponiveis")
def ddds_disponiveis(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna DDDs disponíveis na base de contatos com quantidade por DDD."""
    contacts = db.query(models.Contact.phone).filter(
        models.Contact.user_id == current_user.id,
        models.Contact.is_blacklisted == False,
    ).all()

    ddd_counts: dict = {}
    for (phone,) in contacts:
        if phone and len(phone) >= 4:
            ddd = phone[2:4]
            if ddd.isdigit():
                ddd_counts[ddd] = ddd_counts.get(ddd, 0) + 1

    return {
        "ddds": [
            {"ddd": ddd, "total": count}
            for ddd, count in sorted(ddd_counts.items(), key=lambda x: -x[1])
        ]
    }


@router.post("/contatos-preview")
def contatos_preview(
    data: ContatosPreviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Preview de quantos contatos serão usados com os filtros fornecidos."""
    if data.fonte == "manual" and data.contatos_manual and not data.contact_ids:
        # Legado: strings de telefone — conta sem criar registros no banco
        seen: set = set()
        valid: List[str] = []
        for raw in (data.contatos_manual or []):
            phone = _normalizar_phone(raw.strip())
            if phone and len(phone) in (12, 13) and phone not in seen:
                seen.add(phone)
                valid.append(phone)
        if data.limite and data.limite > 0:
            valid = valid[:data.limite]
        return {
            "total": len(valid),
            "amostra": [{"phone": p, "name": None} for p in valid[:10]],
            "por_ddd": {},
        }

    contacts = _resolver_contatos(
        fonte=data.fonte,
        user_id=current_user.id,
        db=db,
        grupo_ids=data.grupo_ids,
        ddds=data.ddds,
        limite=data.limite,
        aleatorio=data.aleatorio,
        contact_ids=data.contact_ids,
        min_score=data.min_score,
    )
    por_ddd: dict = {}
    for c in contacts:
        if c.phone and len(c.phone) >= 4:
            ddd = c.phone[2:4]
            por_ddd[ddd] = por_ddd.get(ddd, 0) + 1

    return {
        "total": len(contacts),
        "amostra": [{"phone": c.phone, "name": c.name} for c in contacts[:10]],
        "por_ddd": por_ddd,
    }


@router.post("/{campaign_id}/adicionar-contatos")
def adicionar_contatos(
    campaign_id: int,
    data: ContatosPreviewRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    """Adiciona (substitui) contatos em uma campanha rascunho."""
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (models.CampaignStatus.draft,):
        raise HTTPException(status_code=400, detail="Só é possível editar contatos em campanhas rascunho")

    contacts = _resolver_contatos(
        fonte=data.fonte,
        user_id=current_user.id,
        db=db,
        grupo_ids=data.grupo_ids,
        ddds=data.ddds,
        limite=data.limite,
        aleatorio=data.aleatorio,
        contatos_manual=data.contatos_manual,
        min_score=data.min_score,
    )

    db.query(models.CampaignContact).filter(
        models.CampaignContact.campaign_id == campaign_id
    ).delete(synchronize_session=False)

    for c in contacts:
        db.add(models.CampaignContact(campaign_id=campaign_id, contact_id=c.id))

    campaign.total_contacts = len(contacts)
    db.commit()

    return {"total": len(contacts), "message": f"{len(contacts)} contatos adicionados à campanha"}


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    message_items: Optional[List[MessageItem]] = None
    session_ids: Optional[List[int]] = None
    ordem_mensagens: Optional[str] = None


@router.put("/{campaign_id}", response_model=CampaignOut)
def update_campaign(
    campaign_id: int,
    data: CampaignUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    """Atualiza uma campanha em rascunho ou pausada."""
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (models.CampaignStatus.draft, models.CampaignStatus.paused):
        raise HTTPException(
            status_code=400,
            detail="Só é possível editar campanhas com status rascunho ou pausada"
        )

    if data.name is not None:
        campaign.name = data.name

    if data.ordem_mensagens is not None:
        campaign.ordem_mensagens = data.ordem_mensagens

    if data.message_items is not None:
        db.query(models.CampaignMessage).filter(
            models.CampaignMessage.campaign_id == campaign_id
        ).delete(synchronize_session=False)
        for i, item in enumerate(data.message_items):
            db.add(models.CampaignMessage(
                campaign_id=campaign.id,
                text=item.text,
                ordem=i,
                tipo=item.tipo,
                media_url=item.media_url,
                media_filename=item.media_filename,
                botoes=json.dumps(item.botoes) if item.botoes else None,
            ))
        if data.message_items:
            campaign.message = data.message_items[0].text

    if data.session_ids is not None:
        db.query(models.CampaignSession).filter(
            models.CampaignSession.campaign_id == campaign_id
        ).delete(synchronize_session=False)
        if data.session_ids:
            sessions = db.query(models.WhatsAppSession).filter(
                models.WhatsAppSession.id.in_(data.session_ids),
                models.WhatsAppSession.user_id == current_user.id,
            ).all()
            for sess in sessions:
                db.add(models.CampaignSession(campaign_id=campaign.id, session_id=sess.id))
            if sessions:
                campaign.session_id = sessions[0].id
        else:
            campaign.session_id = None

    db.commit()
    c = _load_campaign_q(db).filter(models.Campaign.id == campaign.id).first()
    return _campaign_out(c)


@router.get("/{campaign_id}", response_model=CampaignOut)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    c = _load_campaign_q(db).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    return _campaign_out(c)


@router.get("/{campaign_id}/progresso", response_model=CampaignProgress)
def get_campaign_progress(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    percent = (
        (campaign.sent_count / campaign.total_contacts * 100)
        if campaign.total_contacts > 0 else 0
    )
    return CampaignProgress(
        id=campaign.id,
        status=campaign.status,
        total_contacts=campaign.total_contacts,
        sent_count=campaign.sent_count,
        success_count=campaign.success_count,
        fail_count=campaign.fail_count,
        percent=round(percent, 1),
    )


@router.get("/{campaign_id}/relatorio")
def get_campaign_report(
    campaign_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Relatório detalhado de uma campanha com breakdown por contato."""
    campaign = _load_campaign_q(db).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    # Resumo
    skipped_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.status == models.ContactStatus.skipped,
        )
        .scalar() or 0
    )
    delivered_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.delivered_at.isnot(None),
        )
        .scalar() or 0
    )
    read_count = (
        db.query(func.count(models.CampaignContact.id))
        .filter(
            models.CampaignContact.campaign_id == campaign_id,
            models.CampaignContact.read_at.isnot(None),
        )
        .scalar() or 0
    )

    # Detalhes por contato (paginado)
    total_rows = (
        db.query(func.count(models.CampaignContact.id))
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .scalar() or 0
    )
    rows = (
        db.query(models.CampaignContact)
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .order_by(models.CampaignContact.sent_at.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    contacts_out = []
    for cc in rows:
        contact = cc.contact
        session = cc.session
        contacts_out.append({
            "id": cc.id,
            "contact_id": cc.contact_id,
            "name": contact.name if contact else None,
            "phone": contact.phone if contact else None,
            "status": cc.status,
            "error_message": cc.error_message,
            "session_name": session.name if session else None,
            "sent_at": cc.sent_at,
            "delivered_at": cc.delivered_at,
            "read_at": cc.read_at,
        })

    msgs = sorted(campaign.messages, key=lambda m: m.ordem)
    message_items_out = [
        {
            "tipo": getattr(m, "tipo", "text") or "text",
            "text": m.text,
            "media_url": m.media_url,
            "media_filename": m.media_filename,
        }
        for m in msgs
    ]

    return {
        "id": campaign.id,
        "name": campaign.name,
        "status": campaign.status,
        "message_items": message_items_out,
        "summary": {
            "total": campaign.total_contacts,
            "sent": campaign.success_count,
            "failed": campaign.fail_count,
            "skipped": skipped_count,
            "delivered": delivered_count,
            "read": read_count,
        },
        "total_rows": total_rows,
        "page": page,
        "page_size": page_size,
        "contacts": contacts_out,
    }


@router.get("/{campaign_id}/relatorio/exportar")
def export_campaign_report(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Exporta relatório como CSV."""
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")

    rows = (
        db.query(models.CampaignContact)
        .filter(models.CampaignContact.campaign_id == campaign_id)
        .order_by(models.CampaignContact.sent_at.desc().nullslast())
        .all()
    )

    output = io.StringIO()
    output.write("\ufeff")  # BOM
    writer = csv.writer(output)
    writer.writerow(["Nome", "Telefone", "Status", "Chip", "Enviado em", "Entregue em", "Lido em", "Erro"])
    for cc in rows:
        contact = cc.contact
        session = cc.session
        writer.writerow([
            contact.name if contact else "",
            contact.phone if contact else "",
            cc.status,
            session.name if session else "",
            cc.sent_at.strftime("%d/%m/%Y %H:%M") if cc.sent_at else "",
            cc.delivered_at.strftime("%d/%m/%Y %H:%M") if cc.delivered_at else "",
            cc.read_at.strftime("%d/%m/%Y %H:%M") if cc.read_at else "",
            cc.error_message or "",
        ])

    output.seek(0)
    filename = f"relatorio_{campaign.name}_{datetime.now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv; charset=utf-8-sig",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _resolve_session(campaign: models.Campaign, user_id: int, db: Session) -> models.Campaign:
    has_sessions = db.query(models.CampaignSession).filter(
        models.CampaignSession.campaign_id == campaign.id
    ).first()
    if has_sessions:
        return campaign

    if not campaign.session_id:
        connected = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.user_id == user_id,
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.is_active == True,
        ).first()
        if not connected:
            raise HTTPException(
                status_code=400,
                detail="Nenhuma sessão WhatsApp conectada. Conecte uma sessão primeiro."
            )
        campaign.session_id = connected.id
        db.commit()
    return campaign


@router.post("/{campaign_id}/disparar")
async def fire_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (
        models.CampaignStatus.draft,
        models.CampaignStatus.paused,
        models.CampaignStatus.scheduled,
    ):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser disparada (status: {campaign.status})")
    if not getattr(campaign, "usar_chips_sistema", False):
        campaign = _resolve_session(campaign, current_user.id, db)
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    if em_uso >= limite:
        campaign.status = models.CampaignStatus.queued
        db.commit()
        return {
            "message": f"Aguardando slot disponível ({em_uso}/{limite} em uso)",
            "campaign_id": campaign_id,
            "queued": True,
        }
    # Marcar como running ANTES de iniciar o background task.
    # Isso impede que uma segunda chamada ao endpoint veja status=draft e
    # inicie uma segunda task simultânea (causando envio duplicado por chip).
    campaign.status = models.CampaignStatus.running
    campaign.started_at = datetime.now(timezone.utc)
    db.commit()
    background_tasks.add_task(send_campaign, campaign_id, current_user.id)
    return {"message": "Disparo iniciado", "campaign_id": campaign_id}


@router.post("/{campaign_id}/iniciar")
async def start_campaign(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_active_plan),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status not in (
        models.CampaignStatus.draft,
        models.CampaignStatus.paused,
        models.CampaignStatus.scheduled,
    ):
        raise HTTPException(status_code=400, detail=f"Campanha não pode ser iniciada (status: {campaign.status})")
    if not getattr(campaign, "usar_chips_sistema", False):
        campaign = _resolve_session(campaign, current_user.id, db)
    limite = getattr(current_user, "chips_disparo_simultaneo", 3)
    em_uso = _chips_ativos_count(current_user.id, db)
    if em_uso >= limite:
        campaign.status = models.CampaignStatus.queued
        db.commit()
        return {
            "message": f"Aguardando slot disponível ({em_uso}/{limite} em uso)",
            "campaign_id": campaign_id,
            "queued": True,
        }
    campaign.status = models.CampaignStatus.running
    campaign.started_at = datetime.now(timezone.utc)
    db.commit()
    background_tasks.add_task(send_campaign, campaign_id, current_user.id)
    return {"message": "Campanha iniciada", "campaign_id": campaign_id}


@router.post("/{campaign_id}/pausar")
def pause_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status != models.CampaignStatus.running:
        raise HTTPException(status_code=400, detail="Campanha não está em execução")
    campaign.status = models.CampaignStatus.paused
    db.commit()
    return {"message": "Campanha pausada"}


@router.post("/{campaign_id}/parar")
def stop_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status in (models.CampaignStatus.completed, models.CampaignStatus.cancelled):
        raise HTTPException(status_code=400, detail="Campanha já finalizada")
    was_running = campaign.status == models.CampaignStatus.running
    campaign.status = models.CampaignStatus.cancelled
    campaign.completed_at = datetime.now(timezone.utc)
    db.commit()
    if was_running:
        asyncio.create_task(_start_next_queued(campaign.user_id))
    return {"message": "Campanha cancelada"}


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    campaign = db.query(models.Campaign).filter(
        models.Campaign.id == campaign_id,
        models.Campaign.user_id == current_user.id,
    ).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campanha não encontrada")
    if campaign.status == models.CampaignStatus.running:
        raise HTTPException(status_code=400, detail="Pare a campanha antes de deletar")
    db.delete(campaign)
    db.commit()
