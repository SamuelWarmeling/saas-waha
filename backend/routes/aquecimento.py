import asyncio
import logging
import random
from datetime import datetime, timezone, timedelta, date
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from config import settings
from database import get_db, SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/aquecimento", tags=["Aquecimento"])

BRAZIL_TZ = timezone(timedelta(hours=-3))

# ── Pool de mensagens naturais ────────────────────────────────────────────────

MENSAGENS_AQUECIMENTO: List[str] = [
    # Saudações manhã
    "Bom dia! ☀️ Tudo bem por aí?",
    "Bom dia! Que seu dia seja incrível hoje! 🌟",
    "Oi! Bom dia, como você está? 😊",
    "Bom dia! Semana começando com tudo 💪",
    "Bom dia! Hoje vai ser um ótimo dia ☀️",
    "Bom dia meu amigo! Espero que esteja bem 🌞",
    "Boa manhã! Café tomado e pronto pra encarar o dia? ☕",
    # Saudações tarde
    "Boa tarde! Tudo bem? 👋",
    "Boa tarde! Como está sendo seu dia? 😊",
    "Oi, boa tarde! 🌤️",
    "Boa tarde! Espero que esteja tudo ótimo por aí 😄",
    "Boa tarde! Já tomou água hoje? 💧",
    # Saudações noite
    "Boa noite! Como foi o dia? 🌙",
    "Boa noite! Espero que tenha sido um bom dia ✨",
    "Boa noite! Descansando? 😊",
    "Boa noite! 🌙 Terminou bem o dia?",
    # Comentários clima
    "Que calor hoje hein 😅 Como tá por aí?",
    "Que frio! Vai tomar um café? ☕",
    "Hoje tá um tempo lindo né? 😍",
    "Nossa que chuvarada hoje! Você tá bem? 🌧️",
    "Esse calor tá demais 🥵 Hidratou hoje?",
    "Que dia fresco hoje! Perfeito pra trabalhar 😊",
    # Mensagens semana
    "Feliz segunda! Vamos nessa 💪",
    "Feliz terça! Já na pegada da semana? 🚀",
    "Quarta-feira! Já tá na metade da semana, bora! 💪",
    "Quinta chegando no fim de semana! 🎉",
    "Sexta chegando! 🥳 Planos pro fim de semana?",
    "Bom sábado! Aproveitando o descanso? 😄",
    "Feliz domingo! Carregando as energias pra semana 😊",
    # Perguntas casuais
    "Você assistiu algo legal ultimamente? 📺",
    "Alguma dica de série boa? 😄",
    "Tá trabalhando muito? Cuida de você 🙏",
    "Já almoçou? 🍽️ O que comeu?",
    "Tomou água hoje? Hidratação é fundamental! 💧",
    "Você tem alguma dica boa pra compartilhar? 😊",
    "Tá correndo o dia aí? 😄",
    # Esporte e lazer
    "Você assiste futebol? Que time você torce? ⚽",
    "Que fim de semana hein! Descansou bem? 😊",
    "Aproveitando o feriado? 🎉",
    "Vai sair hoje? O tempo tá ótimo! 😄",
    "Fez algum exercício hoje? 🏃‍♂️",
    # Mensagens curtas e naturais
    "Oi! 👋",
    "Oi sumido! Tudo bem? 😄",
    "Ei! Passando pra dar um oi 👋",
    "Oi! Você tá bem? 😊",
    "Olá! Tudo certo? ✌️",
    "Eaí! Tudo bem? 😄",
    "Oi! Como você tá? 🙂",
    "Oi! Espero que esteja tudo bem 😊",
    # Motivação
    "Foco e persistência! Você consegue 💪",
    "Um dia de cada vez 🙏",
    "Hoje é um ótimo dia pra começar algo novo! ✨",
    "Acredita em você! Tudo vai dar certo 🌟",
    "Vai lá! Você é capaz 💪",
    # Humor e leveza
    "Segunda-feira não é tão ruim assim, vai! 😅",
    "Café, foco e fé! Bora 🚀",
    "O dia tá passando rápido demais! Você sentiu? 😮",
    "Já contou uma piada hoje? 😂",
    "Gratidão! Que dia bom pra estar vivo 🙏",
    # Perguntas abertas
    "O que você tem feito de diferente ultimamente? 😊",
    "Tem alguma novidade boa pra contar? 🎉",
    "Como estão as coisas por aí? 🙂",
    "Tudo certo na sua semana? 😊",
    "Algum plano legal pros próximos dias? 😄",
]


def get_meta_dia(dia: int) -> int:
    """Retorna a meta de mensagens para o dia do aquecimento."""
    if dia <= 3:
        return 3
    if dia <= 7:
        return 8
    if dia <= 14:
        return 20
    return 40


def get_meta_adaptacao(dia: int) -> int:
    """Meta de mensagens para o modo adaptação (chip pré-aquecido)."""
    if dia <= 2:
        return 0   # fase passiva: só recebe e responde
    if dia <= 4:
        return 5   # fase gradual leve
    if dia <= 6:
        return 15  # fase gradual média
    return 30      # dia 7: pré-liberação


def get_destinos_virtuais(db: Session, session_id: int) -> List[str]:
    """Físico → busca chips VIRTUAIS conectados para enviar mensagem."""
    # Diagnóstico: todos os chips virtuais (sem filtro de status/phone)
    todos_virtuais = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.tipo_chip == "virtual",
            models.WhatsAppSession.id != session_id,
        )
        .all()
    )
    if todos_virtuais:
        for s in todos_virtuais:
            logger.info(
                f"🔥 Pool virtual diagnóstico: id={s.id} user={s.user_id} "
                f"nome='{s.name}' status={s.status.value if s.status else 'None'} "
                f"phone={s.phone_number or 'NULL'}"
            )
    else:
        logger.warning("🔥 Pool: NENHUM chip virtual cadastrado no sistema (tipo_chip='virtual')")

    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.id != session_id,
            models.WhatsAppSession.phone_number.isnot(None),
            models.WhatsAppSession.tipo_chip == "virtual",
        )
        .all()
    )
    numeros = [s.phone_number for s in sessoes if s.phone_number]
    logger.info(f"🔥 Pool: encontrei {len(numeros)} chips virtuais disponíveis (connected + phone preenchido)")

    # Fallback: env numbers (tratados como virtuais externos)
    if not numeros and settings.AQUECIMENTO_NUMBERS:
        numeros = [n.strip() for n in settings.AQUECIMENTO_NUMBERS.split(",") if n.strip()]
        if numeros:
            logger.info(f"🔥 Pool: usando fallback AQUECIMENTO_NUMBERS ({len(numeros)} números)")

    return numeros


def count_fisicos_disponiveis(db: Session, session_id: int) -> int:
    """Virtual → conta chips FÍSICOS conectados disponíveis para enviar."""
    # Diagnóstico: todos os chips físicos (sem filtro de status/phone)
    todos_fisicos = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.tipo_chip == "fisico",
            models.WhatsAppSession.id != session_id,
        )
        .all()
    )
    if todos_fisicos:
        for s in todos_fisicos:
            logger.info(
                f"🔥 Pool físico diagnóstico: id={s.id} user={s.user_id} "
                f"nome='{s.name}' status={s.status.value if s.status else 'None'} "
                f"phone={s.phone_number or 'NULL'}"
            )
    else:
        logger.warning("🔥 Pool: NENHUM chip físico cadastrado no sistema (tipo_chip='fisico')")

    count = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.id != session_id,
            models.WhatsAppSession.phone_number.isnot(None),
            models.WhatsAppSession.tipo_chip == "fisico",
        )
        .count()
    )
    logger.info(f"🔥 Pool: encontrei {count} chips físicos disponíveis (connected + phone preenchido)")
    return count


async def enviar_msg_aquecimento(session_waha_id: str, phone: str, mensagem: str) -> bool:
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    payload = {
        "chatId": f"{phone}@c.us",
        "text": mensagem,
        "session": session_waha_id,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(
                f"{settings.WAHA_API_URL}/api/sendText",
                json=payload,
                headers=headers,
            )
        return r.status_code in (200, 201)
    except Exception as e:
        logger.error(f"[AQUECIMENTO] Erro WAHA: {e}")
        return False


async def buscar_phone_waha(session_waha_id: str) -> Optional[str]:
    """Busca phone_number via GET /api/{session}/me no WAHA."""
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{settings.WAHA_API_URL}/api/{session_waha_id}/me",
                headers=headers,
            )
        if r.status_code == 200:
            data = r.json()
            raw = data.get("id", "") or data.get("phoneNumber", "")
            if raw:
                phone = raw.split("@")[0].strip()
                phone = "".join(c for c in phone if c.isdigit())
                return phone if phone else None
    except Exception as e:
        logger.error(f"[AQUECIMENTO] Erro ao buscar /me para {session_waha_id}: {e}")
    return None


def _aq_out(aq: models.AquecimentoConfig, db: Session = None):
    sess = aq.session
    tipo_chip = getattr(sess, "tipo_chip", "fisico") if sess else "fisico"
    progresso_pct = round((aq.dia_atual - 1) / aq.dias_total * 100, 1) if aq.dias_total > 0 else 0
    saude = "otima"
    if not sess or sess.status != models.SessionStatus.connected:
        saude = "risco"
    elif aq.status == models.AquecimentoStatus.pausado:
        saude = "atencao"

    # Para chip virtual: contar físicos disponíveis
    fisicos_disponiveis = 0
    if db and tipo_chip == "virtual":
        fisicos_disponiveis = count_fisicos_disponiveis(db, aq.session_id)
        if fisicos_disponiveis == 0 and aq.status == models.AquecimentoStatus.ativo:
            saude = "atencao"

    is_manutencao = aq.status == models.AquecimentoStatus.manutencao
    origem_chip = getattr(aq, "origem_chip", "novo")
    is_adaptacao = origem_chip == "pre_aquecido"
    fase_adaptacao = None
    dias_adaptacao_restantes = 0
    if is_adaptacao and aq.status == models.AquecimentoStatus.ativo:
        dias_adaptacao_restantes = max(0, 7 - (aq.dia_atual - 1))
        if aq.dia_atual <= 2:
            fase_adaptacao = "passiva"
        elif aq.dia_atual <= 4:
            fase_adaptacao = "gradual_leve"
        elif aq.dia_atual <= 6:
            fase_adaptacao = "gradual_media"
        else:
            fase_adaptacao = "pre_liberacao"

    return {
        "id": aq.id,
        "user_id": aq.user_id,
        "session_id": aq.session_id,
        "session_name": sess.name if sess else "—",
        "session_phone": sess.phone_number if sess else None,
        "session_status": sess.status.value if sess else "disconnected",
        "session_is_aquecido": getattr(sess, "is_aquecido", False) if sess else False,
        "status": aq.status.value if hasattr(aq.status, "value") else aq.status,
        "tipo_chip": tipo_chip,
        "dia_atual": aq.dia_atual,
        "dias_total": aq.dias_total,
        "msgs_hoje": aq.msgs_hoje,
        "meta_hoje": aq.meta_hoje,
        "progresso_pct": progresso_pct,
        "saude": saude,
        "usar_ia": getattr(aq, "usar_ia", True),
        "manutencao_ativa": getattr(aq, "manutencao_ativa", True),
        "is_manutencao": is_manutencao,
        "origem_chip": origem_chip,
        "is_adaptacao": is_adaptacao,
        "fase_adaptacao": fase_adaptacao,
        "dias_adaptacao_restantes": dias_adaptacao_restantes,
        "msgs_recebidas": getattr(aq, "msgs_recebidas", 0),
        "respostas_enviadas": getattr(aq, "respostas_enviadas", 0),
        "fisicos_disponiveis": fisicos_disponiveis,
        "criado_em": aq.criado_em.isoformat() if aq.criado_em else None,
        "ultimo_envio": aq.ultimo_envio.isoformat() if aq.ultimo_envio else None,
        "proximo_envio": aq.proximo_envio.isoformat() if aq.proximo_envio else None,
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class AquecimentoCreate(BaseModel):
    session_id: int
    dias_total: int = 14
    usar_ia: bool = True
    manutencao_ativa: bool = True
    origem_chip: str = "novo"  # "novo" | "pre_aquecido" | "pessoal_antigo"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/stats")
def stats_aquecimento(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    uid = current_user.id
    qs = db.query(models.AquecimentoConfig).filter(models.AquecimentoConfig.user_id == uid).all()
    ativos = [a for a in qs if a.status == models.AquecimentoStatus.ativo]
    concluidos = [a for a in qs if a.status == models.AquecimentoStatus.concluido]
    progresso_medio = 0.0
    if ativos:
        progresso_medio = round(
            sum((a.dia_atual - 1) / a.dias_total * 100 for a in ativos if a.dias_total > 0) / len(ativos),
            1,
        )
    return {
        "total_ativos": len(ativos),
        "total_concluidos": len(concluidos),
        "progresso_medio": progresso_medio,
    }


@router.post("", status_code=201)
def iniciar_aquecimento(
    body: AquecimentoCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if body.origem_chip not in ("novo", "pre_aquecido", "pessoal_antigo"):
        raise HTTPException(status_code=400, detail="origem_chip inválido")

    # Chip pessoal antigo → marcar como veterano diretamente sem aquecimento
    if body.origem_chip == "pessoal_antigo":
        session_vet = db.query(models.WhatsAppSession).filter(
            models.WhatsAppSession.id == body.session_id,
            models.WhatsAppSession.user_id == current_user.id,
        ).first()
        if not session_vet:
            raise HTTPException(status_code=404, detail="Sessão não encontrada")
        session_vet.is_aquecido = True
        session_vet.is_veterano = True
        session_vet.max_daily_messages = 150
        db.add(models.AtividadeLog(
            user_id=current_user.id,
            tipo="aquecimento_concluido",
            descricao=f"⭐ Chip '{session_vet.name}' marcado como veterano (150 msgs/dia liberados)",
        ))
        db.commit()
        return {"veterano": True, "session_id": body.session_id, "max_daily_messages": 150}

    # Chip pré-aquecido → forçar 7 dias em modo adaptação
    if body.origem_chip == "pre_aquecido":
        body = body.model_copy(update={"dias_total": 7})

    if body.dias_total not in (7, 14, 21):
        raise HTTPException(status_code=400, detail="dias_total deve ser 7, 14 ou 21")

    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == body.session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    # Verifica se já existe aquecimento ativo/pausado para essa sessão
    existente = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.session_id == body.session_id,
        models.AquecimentoConfig.status.in_([
            models.AquecimentoStatus.ativo,
            models.AquecimentoStatus.pausado,
        ]),
    ).first()
    if existente:
        raise HTTPException(status_code=409, detail="Já existe um aquecimento ativo para este chip")

    now = datetime.now(timezone.utc)
    is_adaptacao = body.origem_chip == "pre_aquecido"
    meta_inicial = get_meta_adaptacao(1) if is_adaptacao else get_meta_dia(1)

    aq = models.AquecimentoConfig(
        user_id=current_user.id,
        session_id=body.session_id,
        dias_total=body.dias_total,
        dia_atual=1,
        msgs_hoje=0,
        meta_hoje=meta_inicial,
        msgs_sem_pausa=0,
        inicio_dia_atual=now,
        usar_ia=body.usar_ia,
        manutencao_ativa=body.manutencao_ativa,
        origem_chip=body.origem_chip,
    )

    # Marcar sessão em adaptação
    if is_adaptacao:
        session.em_adaptacao = True
    db.add(aq)
    db.commit()
    db.refresh(aq)
    return _aq_out(aq, db)


@router.get("/pool-status")
def pool_status(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Retorna contagem de chips físicos e virtuais conectados no pool global."""
    fisicos = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.phone_number.isnot(None),
            models.WhatsAppSession.tipo_chip == "fisico",
        )
        .count()
    )
    virtuais = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.phone_number.isnot(None),
            models.WhatsAppSession.tipo_chip == "virtual",
        )
        .count()
    )
    return {"fisicos": fisicos, "virtuais": virtuais}


@router.post("/marcar-veterano", status_code=200)
def marcar_veterano(
    body: AquecimentoCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Marca sessão diretamente como veterana (chip pessoal antigo)."""
    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == body.session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    session.is_aquecido = True
    session.is_veterano = True
    session.max_daily_messages = 150
    db.add(models.AtividadeLog(
        user_id=current_user.id,
        tipo="aquecimento_concluido",
        descricao=f"⭐ Chip '{session.name}' marcado como veterano (150 msgs/dia liberados)",
    ))
    db.commit()
    return {"ok": True, "session_id": body.session_id, "is_veterano": True, "max_daily_messages": 150}


@router.get("")
def listar_aquecimentos(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    qs = (
        db.query(models.AquecimentoConfig)
        .filter(models.AquecimentoConfig.user_id == current_user.id)
        .order_by(models.AquecimentoConfig.criado_em.desc())
        .all()
    )
    return [_aq_out(a, db) for a in qs]


@router.put("/{aq_id}/pausar")
def pausar_aquecimento(
    aq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    aq = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.id == aq_id,
        models.AquecimentoConfig.user_id == current_user.id,
    ).first()
    if not aq:
        raise HTTPException(status_code=404, detail="Aquecimento não encontrado")
    if aq.status != models.AquecimentoStatus.ativo:
        raise HTTPException(status_code=400, detail="Aquecimento não está ativo")
    aq.status = models.AquecimentoStatus.pausado
    db.commit()
    return _aq_out(aq, db)


@router.put("/{aq_id}/retomar")
def retomar_aquecimento(
    aq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    aq = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.id == aq_id,
        models.AquecimentoConfig.user_id == current_user.id,
    ).first()
    if not aq:
        raise HTTPException(status_code=404, detail="Aquecimento não encontrado")
    if aq.status != models.AquecimentoStatus.pausado:
        raise HTTPException(status_code=400, detail="Aquecimento não está pausado")
    aq.status = models.AquecimentoStatus.ativo
    # Reset proximo_envio pra não esperar muito ao retomar
    aq.proximo_envio = datetime.now(timezone.utc) + timedelta(minutes=2)
    db.commit()
    return _aq_out(aq, db)


@router.delete("/{aq_id}", status_code=204)
def cancelar_aquecimento(
    aq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    aq = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.id == aq_id,
        models.AquecimentoConfig.user_id == current_user.id,
    ).first()
    if not aq:
        raise HTTPException(status_code=404, detail="Aquecimento não encontrado")
    aq.status = models.AquecimentoStatus.cancelado
    db.commit()


@router.put("/{aq_id}/manutencao")
def toggle_manutencao(
    aq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Ativa manutenção contínua num aquecimento concluído ou desativa."""
    aq = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.id == aq_id,
        models.AquecimentoConfig.user_id == current_user.id,
    ).first()
    if not aq:
        raise HTTPException(status_code=404, detail="Aquecimento não encontrado")
    if aq.status == models.AquecimentoStatus.manutencao:
        # Desativar manutenção
        aq.status = models.AquecimentoStatus.concluido
        aq.manutencao_ativa = False
    elif aq.status == models.AquecimentoStatus.concluido:
        # Reativar manutenção
        aq.status = models.AquecimentoStatus.manutencao
        aq.manutencao_ativa = True
        aq.msgs_hoje = 0
        aq.meta_hoje = random.randint(3, 5)
        aq.proximo_envio = datetime.now(timezone.utc) + timedelta(minutes=random.randint(10, 30))
    else:
        raise HTTPException(status_code=400, detail="Aquecimento deve estar concluído ou em manutenção")
    db.commit()
    return _aq_out(aq, db)


@router.get("/{aq_id}/logs")
def logs_aquecimento(
    aq_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    aq = db.query(models.AquecimentoConfig).filter(
        models.AquecimentoConfig.id == aq_id,
        models.AquecimentoConfig.user_id == current_user.id,
    ).first()
    if not aq:
        raise HTTPException(status_code=404, detail="Aquecimento não encontrado")
    logs = (
        db.query(models.AquecimentoLog)
        .filter(models.AquecimentoLog.aquecimento_id == aq_id)
        .order_by(models.AquecimentoLog.criado_em.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": l.id,
            "telefone_destino": l.telefone_destino[:4] + "*****" + l.telefone_destino[-2:] if len(l.telefone_destino) > 6 else "****",
            "mensagem": l.mensagem,
            "status": l.status,
            "criado_em": l.criado_em.isoformat() if l.criado_em else None,
        }
        for l in logs
    ]


# ── Background worker ─────────────────────────────────────────────────────────

async def processar_aquecimento():
    """Verifica aquecimentos ativos e envia mensagens respeitando a progressão anti-ban."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        now_br = now.astimezone(BRAZIL_TZ)
        hora_br = now_br.hour

        logger.info(f"🔥 Aquecimento worker rodando... hora BR={hora_br:02d}:{now_br.minute:02d}")

        # Só envia entre 08:00 e 20:00 horário de Brasília
        if hora_br < 7 or hora_br >= 21:
            logger.info(f"🔥 Fora do horário permitido (07-21h BR), pulando.")
            return

        ativos = (
            db.query(models.AquecimentoConfig)
            .filter(models.AquecimentoConfig.status.in_([
                models.AquecimentoStatus.ativo,
                models.AquecimentoStatus.manutencao,
            ]))
            .all()
        )

        logger.info(f"🔥 Processando {len(ativos)} chips em aquecimento")

        for aq in ativos:
            try:
                hoje_br: date = now_br.date()

                # ── Inicializa dia se não tiver inicio_dia_atual ──────────────
                if aq.inicio_dia_atual is None:
                    aq.inicio_dia_atual = now
                    aq.meta_hoje = get_meta_dia(aq.dia_atual)
                    db.commit()
                    continue  # espera próximo ciclo para primeira mensagem

                # ── Verifica avanço de dia ────────────────────────────────────
                inicio_br = aq.inicio_dia_atual
                if inicio_br.tzinfo is None:
                    inicio_br = inicio_br.replace(tzinfo=timezone.utc)
                inicio_br_local = inicio_br.astimezone(BRAZIL_TZ).date()

                is_manutencao = aq.status == models.AquecimentoStatus.manutencao

                is_adapt = getattr(aq, "origem_chip", "novo") == "pre_aquecido"

                if hoje_br > inicio_br_local:
                    if is_manutencao:
                        # Manutenção — novo dia com meta baixa (3-5 msgs)
                        aq.msgs_hoje = 0
                        aq.msgs_sem_pausa = 0
                        aq.meta_hoje = random.randint(3, 5)
                        aq.inicio_dia_atual = now
                        aq.proximo_envio = now + timedelta(minutes=random.randint(15, 45))
                        db.commit()
                        logger.info(f"[AQUECIMENTO] #{aq.id} manutenção — novo dia (meta: {aq.meta_hoje} msgs)")
                        continue
                    # Aquecimento normal — avança dia
                    aq.dia_atual += 1
                    if aq.dia_atual > aq.dias_total:
                        # Marcar chip como aquecido
                        sess_local = aq.session
                        if sess_local:
                            sess_local.is_aquecido = True
                            if is_adapt:
                                sess_local.em_adaptacao = False
                        manutencao = getattr(aq, "manutencao_ativa", True)
                        if manutencao:
                            aq.status = models.AquecimentoStatus.manutencao
                            aq.msgs_hoje = 0
                            aq.meta_hoje = random.randint(3, 5)
                            aq.inicio_dia_atual = now
                            aq.proximo_envio = now + timedelta(minutes=random.randint(30, 60))
                            descricao_status = "manutenção contínua ativada"
                        else:
                            aq.status = models.AquecimentoStatus.concluido
                            descricao_status = "concluído"
                        chip_nome = sess_local.name if sess_local else "?"
                        emoji_tipo = "🛍️" if is_adapt else "🔥"
                        db.add(models.AtividadeLog(
                            user_id=aq.user_id,
                            tipo="aquecimento_concluido",
                            descricao=(
                                f"{emoji_tipo} Chip '{chip_nome}' {'adaptado' if is_adapt else 'aquecido'} com sucesso após {aq.dias_total} dias! "
                                f"({descricao_status})"
                            ),
                        ))
                        db.commit()
                        logger.info(f"[AQUECIMENTO] #{aq.id} concluído — chip marcado como aquecido ({descricao_status})")
                        continue
                    aq.msgs_hoje = 0
                    aq.msgs_sem_pausa = 0
                    aq.meta_hoje = get_meta_adaptacao(aq.dia_atual) if is_adapt else get_meta_dia(aq.dia_atual)
                    aq.inicio_dia_atual = now
                    aq.proximo_envio = now + timedelta(minutes=random.randint(5, 15))
                    db.commit()
                    logger.info(f"[AQUECIMENTO] #{aq.id} avançou para dia {aq.dia_atual} (meta: {aq.meta_hoje} msgs{'- FASE PASSIVA' if aq.meta_hoje == 0 else ''})")
                    continue

                # ── Meta do dia já atingida ───────────────────────────────────
                # Em manutenção: 3-5; adaptação: usa get_meta_adaptacao; normal: get_meta_dia
                if aq.meta_hoje == 0 and not is_adapt:
                    aq.meta_hoje = random.randint(3, 5) if is_manutencao else get_meta_dia(aq.dia_atual)
                    db.commit()
                if aq.msgs_hoje >= aq.meta_hoje:
                    logger.info(f"🔥 #{aq.id} meta do dia atingida ({aq.msgs_hoje}/{aq.meta_hoje}), aguardando amanhã")
                    continue

                # ── Verifica próximo envio ────────────────────────────────────
                if aq.proximo_envio:
                    pe = aq.proximo_envio
                    if pe.tzinfo is None:
                        pe = pe.replace(tzinfo=timezone.utc)
                    if now < pe:
                        espera = int((pe - now).total_seconds() // 60)
                        logger.info(f"🔥 #{aq.id} aguardando proximo_envio (faltam ~{espera}min)")
                        continue  # ainda não está na hora

                # ── Busca sessão ──────────────────────────────────────────────
                session = aq.session
                if not session or session.status != models.SessionStatus.connected:
                    logger.warning(f"🔥 #{aq.id} sessão offline (status={session.status.value if session else 'None'}), pulando")
                    continue

                # ── Auto-fetch phone_number se NULL ───────────────────────────
                if not session.phone_number:
                    logger.warning(f"🔥 #{aq.id} phone_number NULL para '{session.name}' — buscando no WAHA...")
                    phone_found = await buscar_phone_waha(session.session_id)
                    if phone_found:
                        session.phone_number = phone_found
                        db.commit()
                        logger.info(f"🔥 Phone encontrado: {phone_found} para {session.session_id}")
                    else:
                        logger.error(f"🔥 #{aq.id} não conseguiu obter phone_number de '{session.name}' — pulando")
                        continue

                tipo_chip = getattr(session, "tipo_chip", "fisico")
                logger.info(f"🔥 #{aq.id} processando chip {tipo_chip} '{session.name}' dia={aq.dia_atual} msgs={aq.msgs_hoje}/{aq.meta_hoje}")

                # ════════════════════════════════════════════════════════
                # CHIP VIRTUAL — só responde, nunca inicia
                # ════════════════════════════════════════════════════════
                if tipo_chip == "virtual":
                    fisicos = count_fisicos_disponiveis(db, aq.session_id)
                    if fisicos == 0:
                        # Sem chips físicos no pool — registra apenas 1x por ciclo
                        if not aq.proximo_envio or now >= aq.proximo_envio:
                            db.add(models.AquecimentoLog(
                                aquecimento_id=aq.id,
                                telefone_destino="—",
                                mensagem="Aguardando chip físico no pool para receber mensagens",
                                status="aguardando",
                            ))
                            aq.proximo_envio = now + timedelta(minutes=30)
                            db.commit()
                            logger.info(f"[AQUECIMENTO] #{aq.id} virtual — sem chips físicos, aguardando")
                    else:
                        logger.info(f"[AQUECIMENTO] #{aq.id} virtual — {fisicos} chip(s) físico(s) no pool, aguardando mensagens")
                    continue  # virtual nunca inicia envio

                # ════════════════════════════════════════════════════════
                # CHIP FÍSICO — inicia conversa com virtuais
                # ════════════════════════════════════════════════════════

                # ── Busca destinos (chips virtuais) ───────────────────────────
                destinos = get_destinos_virtuais(db, aq.session_id)
                if not destinos:
                    logger.warning(f"[AQUECIMENTO] #{aq.id} físico — sem chips virtuais no pool")
                    db.add(models.AquecimentoLog(
                        aquecimento_id=aq.id,
                        telefone_destino="—",
                        mensagem="Sem chips virtuais disponíveis no pool para receber mensagens",
                        status="aguardando",
                    ))
                    aq.proximo_envio = now + timedelta(minutes=15)
                    db.commit()
                    continue

                # ── Seleciona mensagem (IA ou pool fixo) ─────────────────────
                usar_ia = getattr(aq, "usar_ia", True)
                historico_recente = (
                    db.query(models.AquecimentoLog.mensagem)
                    .filter(models.AquecimentoLog.aquecimento_id == aq.id)
                    .order_by(models.AquecimentoLog.criado_em.desc())
                    .limit(10)
                    .all()
                )
                historico_msgs = [r[0] for r in historico_recente]

                user = aq.user
                user_key = getattr(user, "gemini_api_key", None) if user else None
                gemini_habilitado = getattr(user, "gemini_habilitado", True) if user else True

                import ia_service
                mensagem, gerada_por_ia = await ia_service.gerar_mensagem_aquecimento(
                    historico=historico_msgs,
                    user_key=user_key,
                    gemini_habilitado=usar_ia and gemini_habilitado,
                )

                if not gerada_por_ia:
                    idx = random.randint(0, len(MENSAGENS_AQUECIMENTO) - 1)
                    if aq.ultima_msg_idx is not None and idx == aq.ultima_msg_idx:
                        idx = (idx + 1) % len(MENSAGENS_AQUECIMENTO)
                    mensagem = MENSAGENS_AQUECIMENTO[idx]
                    aq.ultima_msg_idx = idx

                destino = random.choice(destinos)

                # ── Envia ─────────────────────────────────────────────────────
                ok = await enviar_msg_aquecimento(session.session_id, destino, mensagem)

                log_status = ("enviado_ia" if gerada_por_ia else "enviado") if ok else "erro"
                db.add(models.AquecimentoLog(
                    aquecimento_id=aq.id,
                    telefone_destino=destino,
                    mensagem=mensagem,
                    status=log_status,
                ))

                if ok:
                    aq.msgs_hoje += 1
                    aq.ultimo_envio = now
                    aq.msgs_sem_pausa = (aq.msgs_sem_pausa or 0) + 1

                    # Após 3 msgs seguidas, pausa longa (45-90 min)
                    if aq.msgs_sem_pausa >= 3:
                        delay = random.randint(45, 90)
                        aq.msgs_sem_pausa = 0
                    else:
                        delay = random.randint(10, 40)

                    aq.proximo_envio = now + timedelta(minutes=delay)
                    mode = "manutenção" if is_manutencao else f"dia {aq.dia_atual}"
                    logger.info(
                        f"[AQUECIMENTO] #{aq.id} físico {mode} — "
                        f"msg {aq.msgs_hoje}/{aq.meta_hoje} → {destino[:6]}*** "
                        f"(próxima em {delay}min)"
                    )
                else:
                    aq.proximo_envio = now + timedelta(minutes=5)
                    logger.warning(f"[AQUECIMENTO] #{aq.id} falha ao enviar, tentará em 5min")

                db.commit()

            except Exception as e:
                logger.error(f"[AQUECIMENTO] Erro ao processar #{aq.id}: {e}")

    except Exception as e:
        logger.error(f"[AQUECIMENTO] Erro geral no worker: {e}")
    finally:
        db.close()


async def aquecimento_worker_task():
    """Background task que roda o aquecimento a cada 5 minutos."""
    logger.info("🔥 Aquecimento worker iniciado.")
    # Aguarda 30s no startup para o banco estar pronto, depois roda imediatamente
    await asyncio.sleep(30)
    while True:
        try:
            await processar_aquecimento()
            await asyncio.sleep(300)  # 5 minutos
        except asyncio.CancelledError:
            logger.info("🔥 Aquecimento worker cancelado.")
            break
        except Exception as e:
            logger.error(f"🔥 Aquecimento worker erro inesperado: {e}")
            await asyncio.sleep(60)  # espera 1min antes de tentar novamente após erro
