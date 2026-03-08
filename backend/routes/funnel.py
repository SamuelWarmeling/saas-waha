import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth
import models
from config import settings
from database import get_db, SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/funnel", tags=["Funil"])

# ── Schemas ───────────────────────────────────────────────────────────────────

class MensagemIn(BaseModel):
    ordem: int
    mensagem: str
    tipo: str = "texto"
    aguardar_horas: float = 0.0


class SequenciaCreate(BaseModel):
    nome: str
    mensagens: List[MensagemIn]


class SequenciaUpdate(BaseModel):
    nome: Optional[str] = None
    status: Optional[str] = None
    mensagens: Optional[List[MensagemIn]] = None


class AdicionarContatosIn(BaseModel):
    contato_ids: List[int]
    session_id: int


class AtualizarTemperaturaIn(BaseModel):
    temperatura: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _seq_out(seq: models.FunnelSequencia):
    contatos = seq.contatos or []
    ativos = sum(1 for c in contatos if c.status == models.FunnelContatoStatus.ativo)
    responderam = sum(1 for c in contatos if c.status == models.FunnelContatoStatus.respondeu)
    concluidos = sum(1 for c in contatos if c.status == models.FunnelContatoStatus.concluido)
    convertidos = sum(1 for c in contatos if c.temperatura == models.FunnelTemperatura.convertido)
    total = len(contatos)
    taxa = round(convertidos / total * 100, 1) if total > 0 else 0.0
    return {
        "id": seq.id,
        "nome": seq.nome,
        "status": seq.status.value if hasattr(seq.status, "value") else seq.status,
        "criado_em": seq.criado_em.isoformat() if seq.criado_em else None,
        "total_mensagens": len(seq.mensagens or []),
        "total_contatos": total,
        "ativos": ativos,
        "responderam": responderam,
        "concluidos": concluidos,
        "convertidos": convertidos,
        "taxa_conversao": taxa,
        "mensagens": [
            {
                "id": m.id,
                "ordem": m.ordem,
                "mensagem": m.mensagem,
                "tipo": m.tipo.value if hasattr(m.tipo, "value") else m.tipo,
                "aguardar_horas": m.aguardar_horas,
            }
            for m in (seq.mensagens or [])
        ],
    }


def _contato_out(fc: models.FunnelContato, total_etapas: int):
    c = fc.contato
    return {
        "id": fc.id,
        "contato_id": fc.contato_id,
        "nome": c.name if c else None,
        "telefone": c.phone if c else None,
        "status": fc.status.value if hasattr(fc.status, "value") else fc.status,
        "temperatura": fc.temperatura.value if hasattr(fc.temperatura, "value") else fc.temperatura,
        "etapa_atual": fc.etapa_atual,
        "total_etapas": total_etapas,
        "iniciado_em": fc.iniciado_em.isoformat() if fc.iniciado_em else None,
        "ultimo_envio": fc.ultimo_envio.isoformat() if fc.ultimo_envio else None,
        "respondeu_em": fc.respondeu_em.isoformat() if fc.respondeu_em else None,
        "session_id": fc.session_id,
    }


async def _enviar_mensagem_waha(session_waha_id: str, phone: str, mensagem: str) -> bool:
    """Envia mensagem de texto via WAHA. Retorna True se sucesso."""
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
        logger.error(f"[FUNNEL] Erro ao enviar mensagem WAHA: {e}")
        return False


# ── Endpoints CRUD sequência ──────────────────────────────────────────────────

@router.post("/sequencias", status_code=201)
def criar_sequencia(
    body: SequenciaCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = models.FunnelSequencia(user_id=current_user.id, nome=body.nome)
    db.add(seq)
    db.flush()
    for m in body.mensagens:
        db.add(models.FunnelMensagem(
            sequencia_id=seq.id,
            ordem=m.ordem,
            mensagem=m.mensagem,
            tipo=m.tipo,
            aguardar_horas=m.aguardar_horas,
        ))
    db.commit()
    db.refresh(seq)
    return _seq_out(seq)


@router.get("/sequencias")
def listar_sequencias(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seqs = (
        db.query(models.FunnelSequencia)
        .filter(models.FunnelSequencia.user_id == current_user.id)
        .order_by(models.FunnelSequencia.criado_em.desc())
        .all()
    )
    return [_seq_out(s) for s in seqs]


@router.put("/sequencias/{seq_id}")
def editar_sequencia(
    seq_id: int,
    body: SequenciaUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.id == seq_id,
        models.FunnelSequencia.user_id == current_user.id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequência não encontrada")

    if body.nome is not None:
        seq.nome = body.nome
    if body.status is not None:
        try:
            seq.status = models.FunnelSequenciaStatus(body.status)
        except ValueError:
            raise HTTPException(status_code=400, detail="Status inválido")

    if body.mensagens is not None:
        # Recria mensagens
        for m in seq.mensagens:
            db.delete(m)
        db.flush()
        for m in body.mensagens:
            db.add(models.FunnelMensagem(
                sequencia_id=seq.id,
                ordem=m.ordem,
                mensagem=m.mensagem,
                tipo=m.tipo,
                aguardar_horas=m.aguardar_horas,
            ))

    db.commit()
    db.refresh(seq)
    return _seq_out(seq)


@router.delete("/sequencias/{seq_id}", status_code=204)
def deletar_sequencia(
    seq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.id == seq_id,
        models.FunnelSequencia.user_id == current_user.id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequência não encontrada")
    db.delete(seq)
    db.commit()


# ── Endpoints de contatos ─────────────────────────────────────────────────────

@router.post("/sequencias/{seq_id}/adicionar-contatos")
def adicionar_contatos(
    seq_id: int,
    body: AdicionarContatosIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.id == seq_id,
        models.FunnelSequencia.user_id == current_user.id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequência não encontrada")

    session = db.query(models.WhatsAppSession).filter(
        models.WhatsAppSession.id == body.session_id,
        models.WhatsAppSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Sessão não encontrada")

    adicionados = 0
    ignorados = 0
    for cid in body.contato_ids:
        contato = db.query(models.Contact).filter(
            models.Contact.id == cid,
            models.Contact.user_id == current_user.id,
        ).first()
        if not contato or contato.is_blacklisted:
            ignorados += 1
            continue
        # Verifica se já existe
        existe = db.query(models.FunnelContato).filter(
            models.FunnelContato.sequencia_id == seq_id,
            models.FunnelContato.contato_id == cid,
        ).first()
        if existe:
            ignorados += 1
            continue
        db.add(models.FunnelContato(
            sequencia_id=seq_id,
            contato_id=cid,
            session_id=body.session_id,
            status=models.FunnelContatoStatus.ativo,
            etapa_atual=1,
        ))
        adicionados += 1

    db.commit()
    return {"adicionados": adicionados, "ignorados": ignorados}


@router.post("/sequencias/{seq_id}/iniciar")
def iniciar_sequencia(
    seq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.id == seq_id,
        models.FunnelSequencia.user_id == current_user.id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequência não encontrada")
    seq.status = models.FunnelSequenciaStatus.ativo
    db.commit()
    return {"ok": True, "status": "ativo"}


@router.get("/sequencias/{seq_id}/contatos")
def listar_contatos(
    seq_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    seq = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.id == seq_id,
        models.FunnelSequencia.user_id == current_user.id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequência não encontrada")
    total_etapas = len(seq.mensagens or [])
    return [_contato_out(fc, total_etapas) for fc in seq.contatos]


@router.put("/contatos/{fc_id}/status")
def atualizar_contato(
    fc_id: int,
    body: AtualizarTemperaturaIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    fc = (
        db.query(models.FunnelContato)
        .join(models.FunnelSequencia, models.FunnelContato.sequencia_id == models.FunnelSequencia.id)
        .filter(
            models.FunnelContato.id == fc_id,
            models.FunnelSequencia.user_id == current_user.id,
        )
        .first()
    )
    if not fc:
        raise HTTPException(status_code=404, detail="Contato do funil não encontrado")
    try:
        fc.temperatura = models.FunnelTemperatura(body.temperatura)
    except ValueError:
        raise HTTPException(status_code=400, detail="Temperatura inválida")
    # Convertido => parar automação
    if fc.temperatura == models.FunnelTemperatura.convertido:
        fc.status = models.FunnelContatoStatus.concluido
    db.commit()
    return {"ok": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
def stats_funil(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    uid = current_user.id
    seqs = db.query(models.FunnelSequencia).filter(
        models.FunnelSequencia.user_id == uid,
    ).all()

    total_contatos = sum(len(s.contatos) for s in seqs)
    total_ativos = sum(
        sum(1 for c in s.contatos if c.status == models.FunnelContatoStatus.ativo)
        for s in seqs
    )
    total_responderam = sum(
        sum(1 for c in s.contatos if c.status == models.FunnelContatoStatus.respondeu)
        for s in seqs
    )
    total_convertidos = sum(
        sum(1 for c in s.contatos if c.temperatura == models.FunnelTemperatura.convertido)
        for s in seqs
    )
    taxa = round(total_convertidos / total_contatos * 100, 1) if total_contatos > 0 else 0.0

    return {
        "total_sequencias": len(seqs),
        "total_contatos": total_contatos,
        "total_ativos": total_ativos,
        "total_responderam": total_responderam,
        "total_convertidos": total_convertidos,
        "taxa_conversao": taxa,
    }


# ── Background worker ─────────────────────────────────────────────────────────

async def processar_funnel():
    """Verifica contatos ativos no funil e envia próxima mensagem se o intervalo passou."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        contatos_ativos = (
            db.query(models.FunnelContato)
            .join(models.FunnelSequencia, models.FunnelContato.sequencia_id == models.FunnelSequencia.id)
            .filter(
                models.FunnelContato.status == models.FunnelContatoStatus.ativo,
                models.FunnelSequencia.status == models.FunnelSequenciaStatus.ativo,
            )
            .all()
        )

        for fc in contatos_ativos:
            try:
                seq = fc.sequencia
                mensagens = sorted(seq.mensagens, key=lambda m: m.ordem)
                if not mensagens:
                    continue

                etapa_idx = fc.etapa_atual - 1  # 0-indexed
                if etapa_idx >= len(mensagens):
                    fc.status = models.FunnelContatoStatus.concluido
                    db.commit()
                    continue

                msg = mensagens[etapa_idx]

                # Primeiro envio (ultimo_envio é None): verifica aguardar_horas desde iniciado_em
                ref_time = fc.ultimo_envio or fc.iniciado_em
                if ref_time and ref_time.tzinfo is None:
                    ref_time = ref_time.replace(tzinfo=timezone.utc)

                horas_necessarias = msg.aguardar_horas
                if ref_time is not None:
                    diff = (now - ref_time).total_seconds() / 3600
                    if diff < horas_necessarias:
                        continue  # ainda não é hora

                # Busca sessão
                session = db.query(models.WhatsAppSession).filter(
                    models.WhatsAppSession.id == fc.session_id,
                ).first()
                if not session or session.status != models.SessionStatus.connected:
                    logger.warning(f"[FUNNEL] Sessão {fc.session_id} indisponível para contato {fc.contato_id}")
                    continue

                contato = fc.contato
                if not contato:
                    fc.status = models.FunnelContatoStatus.cancelado
                    db.commit()
                    continue

                ok = await _enviar_mensagem_waha(session.session_id, contato.phone, msg.mensagem)
                if ok:
                    fc.ultimo_envio = now
                    fc.etapa_atual += 1
                    # Verifica se foi a última etapa
                    if fc.etapa_atual > len(mensagens):
                        fc.status = models.FunnelContatoStatus.concluido
                    db.commit()
                    logger.info(
                        f"[FUNNEL] Etapa {msg.ordem} enviada para contato {contato.phone} "
                        f"(seq={seq.id}, fc={fc.id})"
                    )
                    db.add(models.AtividadeLog(
                        user_id=seq.user_id,
                        tipo="funnel_mensagem_enviada",
                        descricao=(
                            f"Funil '{seq.nome}': etapa {msg.ordem} enviada para "
                            f"{contato.name or contato.phone}"
                        ),
                    ))
                    db.commit()
                else:
                    logger.warning(f"[FUNNEL] Falha ao enviar para {contato.phone}")
            except Exception as e:
                logger.error(f"[FUNNEL] Erro ao processar contato {fc.id}: {e}")

    except Exception as e:
        logger.error(f"[FUNNEL] Erro geral no worker: {e}")
    finally:
        db.close()


async def funnel_worker_task():
    """Task de background que roda o funil a cada 5 minutos."""
    logger.info("[FUNNEL] Worker iniciado.")
    while True:
        try:
            await asyncio.sleep(300)  # 5 minutos
            logger.info("[FUNNEL] Rodando verificação do funil...")
            await processar_funnel()
        except asyncio.CancelledError:
            logger.info("[FUNNEL] Worker cancelado.")
            break
        except Exception as e:
            logger.error(f"[FUNNEL] Erro inesperado: {e}")
