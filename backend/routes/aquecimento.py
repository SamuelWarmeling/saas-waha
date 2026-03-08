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


def get_destinos(db: Session, session_id: int) -> List[str]:
    """Busca destinos para aquecimento: outras sessões conectadas → fallback env."""
    sessoes = (
        db.query(models.WhatsAppSession)
        .filter(
            models.WhatsAppSession.status == models.SessionStatus.connected,
            models.WhatsAppSession.id != session_id,
            models.WhatsAppSession.phone_number.isnot(None),
        )
        .all()
    )
    numeros = [s.phone_number for s in sessoes if s.phone_number]

    if not numeros and settings.AQUECIMENTO_NUMBERS:
        numeros = [n.strip() for n in settings.AQUECIMENTO_NUMBERS.split(",") if n.strip()]

    return numeros


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


def _aq_out(aq: models.AquecimentoConfig):
    sess = aq.session
    progresso_pct = round((aq.dia_atual - 1) / aq.dias_total * 100, 1) if aq.dias_total > 0 else 0
    saude = "otima"
    if not sess or sess.status != models.SessionStatus.connected:
        saude = "risco"
    elif aq.status == models.AquecimentoStatus.pausado:
        saude = "atencao"
    return {
        "id": aq.id,
        "user_id": aq.user_id,
        "session_id": aq.session_id,
        "session_name": sess.name if sess else "—",
        "session_phone": sess.phone_number if sess else None,
        "session_status": sess.status.value if sess else "disconnected",
        "status": aq.status.value if hasattr(aq.status, "value") else aq.status,
        "dia_atual": aq.dia_atual,
        "dias_total": aq.dias_total,
        "msgs_hoje": aq.msgs_hoje,
        "meta_hoje": aq.meta_hoje,
        "progresso_pct": progresso_pct,
        "saude": saude,
        "criado_em": aq.criado_em.isoformat() if aq.criado_em else None,
        "ultimo_envio": aq.ultimo_envio.isoformat() if aq.ultimo_envio else None,
        "proximo_envio": aq.proximo_envio.isoformat() if aq.proximo_envio else None,
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class AquecimentoCreate(BaseModel):
    session_id: int
    dias_total: int = 14


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
    aq = models.AquecimentoConfig(
        user_id=current_user.id,
        session_id=body.session_id,
        dias_total=body.dias_total,
        dia_atual=1,
        msgs_hoje=0,
        meta_hoje=get_meta_dia(1),
        msgs_sem_pausa=0,
        inicio_dia_atual=now,
    )
    db.add(aq)
    db.commit()
    db.refresh(aq)
    return _aq_out(aq)


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
    return [_aq_out(a) for a in qs]


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
    return _aq_out(aq)


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
    return _aq_out(aq)


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

        # Só envia entre 08:00 e 20:00 horário de Brasília
        if hora_br < 8 or hora_br >= 20:
            return

        ativos = (
            db.query(models.AquecimentoConfig)
            .filter(models.AquecimentoConfig.status == models.AquecimentoStatus.ativo)
            .all()
        )

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

                if hoje_br > inicio_br_local:
                    # Novo dia — avança
                    aq.dia_atual += 1
                    if aq.dia_atual > aq.dias_total:
                        aq.status = models.AquecimentoStatus.concluido
                        db.add(models.AtividadeLog(
                            user_id=aq.user_id,
                            tipo="aquecimento_concluido",
                            descricao=(
                                f"✅ Aquecimento do chip '{aq.session.name}' "
                                f"concluído com sucesso após {aq.dias_total} dias!"
                            ),
                        ))
                        db.commit()
                        continue
                    aq.msgs_hoje = 0
                    aq.msgs_sem_pausa = 0
                    aq.meta_hoje = get_meta_dia(aq.dia_atual)
                    aq.inicio_dia_atual = now
                    aq.proximo_envio = now + timedelta(minutes=random.randint(5, 15))
                    db.commit()
                    logger.info(f"[AQUECIMENTO] #{aq.id} avançou para dia {aq.dia_atual} (meta: {aq.meta_hoje} msgs)")
                    continue

                # ── Meta do dia já atingida ───────────────────────────────────
                if aq.msgs_hoje >= aq.meta_hoje:
                    continue

                # ── Verifica próximo envio ────────────────────────────────────
                if aq.proximo_envio:
                    pe = aq.proximo_envio
                    if pe.tzinfo is None:
                        pe = pe.replace(tzinfo=timezone.utc)
                    if now < pe:
                        continue  # ainda não está na hora

                # ── Busca sessão ──────────────────────────────────────────────
                session = aq.session
                if not session or session.status != models.SessionStatus.connected:
                    logger.warning(f"[AQUECIMENTO] #{aq.id} sessão offline, pulando")
                    continue

                # ── Busca destinos ────────────────────────────────────────────
                destinos = get_destinos(db, aq.session_id)
                if not destinos:
                    logger.warning(f"[AQUECIMENTO] #{aq.id} sem destinos disponíveis")
                    continue

                # ── Seleciona mensagem (não repete a última) ──────────────────
                idx = random.randint(0, len(MENSAGENS_AQUECIMENTO) - 1)
                if aq.ultima_msg_idx is not None and idx == aq.ultima_msg_idx:
                    idx = (idx + 1) % len(MENSAGENS_AQUECIMENTO)
                mensagem = MENSAGENS_AQUECIMENTO[idx]
                destino = random.choice(destinos)

                # ── Envia ─────────────────────────────────────────────────────
                ok = await enviar_msg_aquecimento(session.session_id, destino, mensagem)

                log_status = "enviado" if ok else "erro"
                db.add(models.AquecimentoLog(
                    aquecimento_id=aq.id,
                    telefone_destino=destino,
                    mensagem=mensagem,
                    status=log_status,
                ))

                if ok:
                    aq.msgs_hoje += 1
                    aq.ultima_msg_idx = idx
                    aq.ultimo_envio = now
                    aq.msgs_sem_pausa = (aq.msgs_sem_pausa or 0) + 1

                    # Após 3 msgs seguidas, pausa longa (45-90 min)
                    if aq.msgs_sem_pausa >= 3:
                        delay = random.randint(45, 90)
                        aq.msgs_sem_pausa = 0
                    else:
                        delay = random.randint(10, 40)

                    aq.proximo_envio = now + timedelta(minutes=delay)
                    logger.info(
                        f"[AQUECIMENTO] #{aq.id} dia {aq.dia_atual} — "
                        f"msg {aq.msgs_hoje}/{aq.meta_hoje} enviada para {destino[:6]}*** "
                        f"(próxima em {delay}min)"
                    )
                else:
                    # Em caso de erro, tenta novamente em 5 minutos
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
    logger.info("[AQUECIMENTO] Worker iniciado.")
    while True:
        try:
            await asyncio.sleep(300)  # 5 minutos
            logger.info("[AQUECIMENTO] Verificando aquecimentos ativos...")
            await processar_aquecimento()
        except asyncio.CancelledError:
            logger.info("[AQUECIMENTO] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[AQUECIMENTO] Erro inesperado: {e}")
