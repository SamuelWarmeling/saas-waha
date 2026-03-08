"""
Sistema fuzzy de seleção de chips para campanhas.
Score 0-100 baseado em: taxa de uso diário, nível de aquecimento, status de conexão.

12 regras podadas (Mamdani simplificado com defuzzificação por centróide ponderado):
  R1  – IF desconectado          → score 0   (hard-block)
  R2  – IF em_adaptacao          → score 0   (hard-block)
  R3  – IF uso=alta  AND aq=baixo → score 5
  R4  – IF uso=alta  AND aq=medio → score 28
  R5  – IF uso=alta  AND aq=alto  → score 45
  R6  – IF uso=media AND aq=baixo → score 22
  R7  – IF uso=media AND aq=medio → score 55
  R8  – IF uso=media AND aq=alto  → score 72
  R9  – IF uso=baixa AND aq=baixo → score 40
  R10 – IF uso=baixa AND aq=medio → score 78
  R11 – IF uso=baixa AND aq=alto  → score 92
  R12 – IF veterano  AND uso=baixa → bônus +10 % (≤ 100)
"""
import logging
import random
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict

import models

logger = logging.getLogger(__name__)

# ── Configuração fuzzy em memória (atualizada por recalibrar_parametros) ───────
_FUZZY_CONFIG: dict = {
    "high_threshold":      70.0,
    "med_threshold":       40.0,
    "peso_risco":           0.0,
    "total_bans":             0,
    "ultima_recalibracao": None,
}

# ── Cache de risco de ban por sessão (TTL = 5 min) ─────────────────────────────
_RISCO_CACHE: Dict[int, dict] = {}  # session_id → {"risco": int, "ts": datetime}
_RISCO_CACHE_TTL = 300               # 5 minutos


# ── Funções de pertinência ─────────────────────────────────────────────────────

def _trap(x: float, a: float, b: float, c: float, d: float) -> float:
    """Trapezoidal: sobe a→b, plato b→c, desce c→d."""
    if x <= a or x >= d:
        return 0.0
    if b <= x <= c:
        return 1.0
    if x < b:
        return (x - a) / (b - a)
    return (d - x) / (d - c)


def _tri(x: float, a: float, b: float, c: float) -> float:
    """Triangular: sobe a→b, desce b→c."""
    if x <= a or x >= c:
        return 0.0
    if x == b:
        return 1.0
    return (x - a) / (b - a) if x < b else (c - x) / (c - b)


# ── Variáveis linguísticas de entrada ─────────────────────────────────────────

def _mu_uso(taxa: float) -> Dict[str, float]:
    """Taxa de uso diário (0-1) → {baixa, media, alta}."""
    return {
        "baixa": _trap(taxa, -0.1, 0.0, 0.30, 0.50),
        "media": _tri(taxa,  0.25, 0.55, 0.80),
        "alta":  _trap(taxa,  0.65, 0.85, 1.0,  1.1),
    }


def _mu_aq(nivel: float) -> Dict[str, float]:
    """Nível de aquecimento (0=cru, 0.5=aquecido, 1=veterano) → {baixo, medio, alto}."""
    return {
        "baixo": _trap(nivel, -0.1, 0.0, 0.20, 0.40),
        "medio": _tri(nivel,   0.30, 0.50, 0.75),
        "alto":  _trap(nivel,   0.60, 0.80, 1.0,  1.1),
    }


# ── Regras R3-R11 (uso × aquecimento → centróide de saída) ────────────────────

_REGRAS: List[tuple] = [
    ("alta",  "baixo",  5),   # R3
    ("alta",  "medio",  28),  # R4
    ("alta",  "alto",   45),  # R5
    ("media", "baixo",  22),  # R6
    ("media", "medio",  55),  # R7
    ("media", "alto",   72),  # R8
    ("baixa", "baixo",  40),  # R9
    ("baixa", "medio",  78),  # R10
    ("baixa", "alto",   92),  # R11
]


# ── Funções auxiliares ─────────────────────────────────────────────────────────

def _nivel_aquecimento(sess: models.WhatsAppSession) -> float:
    if getattr(sess, "is_veterano", False):
        return 1.0
    if getattr(sess, "is_aquecido", False):
        return 0.5
    return 0.0


def _build_result(
    score: int,
    label: str,
    razao: str,
    sess: models.WhatsAppSession,
    extra: Optional[dict] = None,
) -> dict:
    return {
        "session_id":          sess.id,
        "session_name":        sess.name,
        "phone_number":        sess.phone_number,
        "score":               score,
        "label":               label,
        "razao":               razao,
        "is_aquecido":         getattr(sess, "is_aquecido",  False),
        "is_veterano":         getattr(sess, "is_veterano",  False),
        "em_adaptacao":        getattr(sess, "em_adaptacao", False),
        "messages_sent_today": sess.messages_sent_today or 0,
        "max_daily_messages":  sess.max_daily_messages  or 200,
        **(extra or {}),
    }


# ── API pública ────────────────────────────────────────────────────────────────

def calcular_saude_chip(sess: models.WhatsAppSession, db=None) -> dict:
    """
    Calcula score fuzzy (0-100) e label HIGH / MED / LOW para um chip.
    Regras R1 e R2 são hard-blocks (retornam score 0 imediatamente).
    """
    # R1 – desconectado
    if sess.status != models.SessionStatus.connected:
        return _build_result(0, "OFFLINE", "Chip desconectado", sess)

    # R2 – em adaptação
    if getattr(sess, "em_adaptacao", False):
        return _build_result(0, "BLOCKED", "Em adaptação (disparos bloqueados)", sess)

    max_msgs  = sess.max_daily_messages or 200
    sent_hoje = sess.messages_sent_today or 0
    taxa      = min(1.0, sent_hoje / max_msgs)
    nivel_aq  = _nivel_aquecimento(sess)

    mu_u = _mu_uso(taxa)
    mu_a = _mu_aq(nivel_aq)

    # Defuzzificação centróide (R3-R11)
    num = den = 0.0
    for uso_lbl, aq_lbl, centro in _REGRAS:
        forca = min(mu_u[uso_lbl], mu_a[aq_lbl])
        if forca > 0:
            num += forca * centro
            den += forca

    score_f = (num / den) if den > 0 else 50.0

    # R12 – bônus veterano com uso baixo
    if getattr(sess, "is_veterano", False) and taxa < 0.20:
        score_f = min(100.0, score_f * 1.10 + 5)

    # Penalidade: sem aquecimento + uso alto (risco iminente de ban)
    if nivel_aq == 0.0 and taxa > 0.50:
        score_f = max(0.0, score_f * 0.70)

    # Penalidade de risco aprendida coletivamente
    peso_r = _FUZZY_CONFIG.get("peso_risco", 0.0)
    if peso_r > 0 and nivel_aq < 0.5 and taxa > 0.40:
        score_f = max(0.0, score_f * (1.0 - peso_r))

    score = round(min(100, max(0, score_f)))
    high_t = _FUZZY_CONFIG.get("high_threshold", 70.0)
    med_t  = _FUZZY_CONFIG.get("med_threshold",  40.0)
    label = "HIGH" if score >= high_t else ("MED" if score >= med_t else "LOW")

    restante = max(0, max_msgs - sent_hoje)
    if taxa >= 0.90:
        razao = f"Limite diário quase atingido ({sent_hoje}/{max_msgs})"
    elif nivel_aq == 0.0:
        razao = "Não aquecido — risco elevado de ban"
    elif taxa < 0.30:
        razao = f"Ótima capacidade ({restante} msgs restantes)"
    else:
        razao = f"Capacidade parcial ({restante} msgs restantes)"

    # Override baseado no cache de risco de ban (sem DB query no hot path)
    _rc = _RISCO_CACHE.get(sess.id)
    if _rc and (datetime.now(timezone.utc) - _rc["ts"]).total_seconds() < _RISCO_CACHE_TTL:
        _r = _rc["risco"]
        if _r > 80:
            return _build_result(0, "BLOCKED", f"🚨 Risco de ban iminente ({_r}%) — chip pausado", sess)
        elif _r > 60:
            label = "LOW"
            razao  = f"⚠️ Risco de ban elevado ({_r}%) — em modo precaução"

    return _build_result(score, label, razao, sess, extra={
        "taxa_uso_pct":        round(taxa * 100),
        "capacidade_restante": restante,
        "nivel_aquecimento":   nivel_aq,
    })


def selecionar_chip_inteligente(
    sessoes: List[models.WhatsAppSession],
    db=None,
) -> Optional[models.WhatsAppSession]:
    """
    Seleciona o melhor chip via score fuzzy com seleção probabilística ponderada.
    Chips com score == 0 são excluídos automaticamente (hard-blocks R1/R2).
    """
    candidatos: List[tuple] = []
    for s in sessoes:
        diag = calcular_saude_chip(s, db)
        if diag["score"] > 0:
            candidatos.append((s, diag["score"]))

    if not candidatos:
        return None

    sessoes_list = [c[0] for c in candidatos]
    pesos        = [float(c[1]) for c in candidatos]
    return random.choices(sessoes_list, weights=pesos, k=1)[0]


# ── Detecção precoce de ban por sinais ACK ─────────────────────────────────────

def calcular_risco_ban(sess: models.WhatsAppSession, db) -> dict:
    """
    Calcula score de risco de ban (0-100) a partir de 4 sinais:

      S1 – % msgs com ack=-1 nas últimas 2h:             peso 40
      S2 – horas sem receber mensagem do pool (ack=99):   peso 25
      S3 – sessão desconectada atualmente:                peso 20
      S4 – taxa de entrega < 80% nas últimas 2h:          peso 15

    Labels:  0-30 🟢 SAFE | 31-60 🟡 ATENCAO | 61-80 🔴 PERIGO | 81-100 🚨 IMINENTE
    Atualiza _RISCO_CACHE para uso em calcular_saude_chip sem DB query.
    """
    now    = datetime.now(timezone.utc)
    h2_ago = now - timedelta(hours=2)

    # Logs de ACK das últimas 2h (excluindo ack=99 = mensagem recebida)
    logs_2h = (
        db.query(models.ChipHealthLog)
        .filter(
            models.ChipHealthLog.session_id == sess.id,
            models.ChipHealthLog.criado_em  >= h2_ago,
            models.ChipHealthLog.ack        != 99,
        )
        .all()
    )
    total_2h = len(logs_2h)
    erro_2h  = sum(1 for l in logs_2h if l.ack == -1)

    # S1 – % ack=-1 (peso 40)
    s1_pct = (erro_2h / total_2h * 100) if total_2h > 0 else 0.0
    s1     = s1_pct * 0.40

    # S2 – horas sem receber mensagem do pool (ack=99, peso 25)
    last_recv = (
        db.query(models.ChipHealthLog)
        .filter(
            models.ChipHealthLog.session_id == sess.id,
            models.ChipHealthLog.ack        == 99,
        )
        .order_by(models.ChipHealthLog.criado_em.desc())
        .first()
    )
    if last_recv:
        recv_ts = last_recv.criado_em
        if recv_ts.tzinfo is None:
            recv_ts = recv_ts.replace(tzinfo=timezone.utc)
        horas_sem_recv = (now - recv_ts).total_seconds() / 3600.0
    else:
        created    = sess.created_at
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        chip_age_h = (now - created).total_seconds() / 3600.0 if created else 0.0
        # Chip novo < 48h que nunca recebeu: normal; chip antigo: suspeito
        horas_sem_recv = 0.0 if chip_age_h < 48 else min(chip_age_h, 48.0)
    s2 = min(1.0, horas_sem_recv / 24.0) * 25.0

    # S3 – sessão desconectada (peso 20)
    s3 = 20.0 if sess.status != models.SessionStatus.connected else 0.0

    # S4 – taxa de entrega < 80% (peso 15)
    sent_2h      = [l for l in logs_2h if l.ack >= 0]
    delivered_2h = [l for l in sent_2h if l.ack >= 2]
    delivery_rate = (len(delivered_2h) / len(sent_2h)) if sent_2h else 1.0
    s4 = max(0.0, ((0.80 - delivery_rate) / 0.80) * 15.0) if delivery_rate < 0.80 else 0.0

    risco = round(min(100.0, s1 + s2 + s3 + s4))
    label = (
        "SAFE"     if risco <= 30 else
        "ATENCAO"  if risco <= 60 else
        "PERIGO"   if risco <= 80 else
        "IMINENTE"
    )
    emoji = {"SAFE": "🟢", "ATENCAO": "🟡", "PERIGO": "🔴", "IMINENTE": "🚨"}[label]

    # Atualiza cache em memória (usado por calcular_saude_chip sem DB)
    _RISCO_CACHE[sess.id] = {"risco": risco, "ts": now}

    return {
        "session_id":   sess.id,
        "session_name": sess.name,
        "phone_number": sess.phone_number,
        "risco":        risco,
        "label":        label,
        "emoji":        emoji,
        "sinais": {
            "erro_ack_pct":   round(s1_pct, 1),
            "horas_sem_recv": round(horas_sem_recv, 1),
            "desconectado":   sess.status != models.SessionStatus.connected,
            "taxa_entrega":   round(delivery_rate * 100, 1),
        },
    }


# ── Aprendizado coletivo de bans ───────────────────────────────────────────────

def carregar_config_fuzzy(db) -> None:
    """Carrega thresholds salvos no banco para o cache em memória. Chamar no startup."""
    try:
        cfg = db.query(models.FuzzyConfig).filter(models.FuzzyConfig.user_id.is_(None)).first()
        if cfg:
            _FUZZY_CONFIG["high_threshold"] = cfg.high_threshold
            _FUZZY_CONFIG["med_threshold"]  = cfg.med_threshold
            _FUZZY_CONFIG["peso_risco"]     = cfg.peso_risco
            if cfg.atualizado_em:
                _FUZZY_CONFIG["ultima_recalibracao"] = cfg.atualizado_em.isoformat()
            logger.info(
                f"[FUZZY] Config carregada do banco: "
                f"HIGH>={cfg.high_threshold}, MED>={cfg.med_threshold}, "
                f"peso_risco={cfg.peso_risco}"
            )
        total = db.query(models.BanRecord).count()
        _FUZZY_CONFIG["total_bans"] = total
    except Exception as exc:
        logger.warning(f"[FUZZY] Erro ao carregar config: {exc}")


def recalibrar_parametros(db) -> None:
    """
    Analisa os últimos 50 bans e ajusta thresholds globais:
      - avg liquidez > 70  → HIGH threshold = 75  (chips com uso alto se banindo → ser mais seletivo)
      - avg risco > 50     → peso_risco = 0.30    (bans em chips de risco → penalizar mais)
      - avg score > 60     → MED threshold = 50   (bans mesmo com score alto → elevar critério MED)
    Salva em FuzzyConfig(user_id=NULL) e atualiza cache em memória.
    """
    try:
        records = (
            db.query(models.BanRecord)
            .order_by(models.BanRecord.criado_em.desc())
            .limit(50)
            .all()
        )
        if not records:
            return

        n = len(records)
        avg_liquidez = sum((r.liquidez_momento or 0.0) for r in records) / n
        avg_risco    = sum((r.risco_momento    or 0.0) for r in records) / n
        avg_score    = sum((r.score_momento    or 0.0) for r in records) / n

        high_t  = 75.0 if avg_liquidez > 70 else 70.0
        peso_r  = 0.30 if avg_risco    > 50 else 0.0
        med_t   = 50.0 if avg_score    > 60 else 40.0

        total = db.query(models.BanRecord).count()

        cfg = db.query(models.FuzzyConfig).filter(models.FuzzyConfig.user_id.is_(None)).first()
        if cfg:
            cfg.high_threshold       = high_t
            cfg.med_threshold        = med_t
            cfg.peso_risco           = peso_r
            cfg.total_bans_calibracao = total
        else:
            cfg = models.FuzzyConfig(
                user_id=None,
                high_threshold=high_t,
                med_threshold=med_t,
                peso_risco=peso_r,
                total_bans_calibracao=total,
            )
            db.add(cfg)
        db.commit()

        _FUZZY_CONFIG["high_threshold"]      = high_t
        _FUZZY_CONFIG["med_threshold"]       = med_t
        _FUZZY_CONFIG["peso_risco"]          = peso_r
        _FUZZY_CONFIG["total_bans"]          = total
        _FUZZY_CONFIG["ultima_recalibracao"] = datetime.now(timezone.utc).isoformat()

        logger.info(
            f"[FUZZY] Recalibração concluída com {n} bans: "
            f"HIGH>={high_t}, MED>={med_t}, peso_risco={peso_r} "
            f"(avg_liq={avg_liquidez:.1f}, avg_risco={avg_risco:.1f}, avg_score={avg_score:.1f})"
        )
    except Exception as exc:
        logger.error(f"[FUZZY] Erro em recalibrar_parametros: {exc}")


def registrar_ban(sess: models.WhatsAppSession, db) -> None:
    """
    Registra contexto do ban no banco. Deve ser chamado ANTES de alterar sess.status.
    Dispara recalibrar_parametros() a cada 10 bans.
    """
    try:
        max_msgs  = sess.max_daily_messages or 200
        sent_hoje = sess.messages_sent_today or 0
        taxa      = min(1.0, sent_hoje / max_msgs)

        # Score calculado enquanto status ainda é connected
        diag  = calcular_saude_chip(sess)
        score = float(diag.get("score", 0))
        label = diag.get("label", "OFFLINE")

        now = datetime.now(timezone.utc)
        created = sess.created_at
        if created and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        dias_de_vida = (now - created).days if created else 0

        record = models.BanRecord(
            session_id=sess.id,
            user_id=sess.user_id,
            tipo_chip=getattr(sess, "tipo_chip", "fisico"),
            liquidez_momento=round(taxa * 100, 2),
            valor_esperado_momento=score,
            risco_momento=round(100.0 - score, 2),
            score_momento=score,
            action_momento=label,
            msgs_enviadas_hoje=sent_hoje,
            dias_de_vida=dias_de_vida,
        )
        db.add(record)
        db.commit()

        total = db.query(models.BanRecord).count()
        _FUZZY_CONFIG["total_bans"] = total

        if total % 10 == 0:
            logger.info(f"[FUZZY] {total} bans registrados — iniciando recalibração automática...")
            recalibrar_parametros(db)
    except Exception as exc:
        logger.error(f"[FUZZY] Erro em registrar_ban: {exc}")
