"""
Diagnostico completo do sistema anti-ban.
Uso: python backend/scripts/diagnostico_antiban.py
     (executar a partir da raiz do projeto)
"""
import os
import re
import sys

# ── Paths ─────────────────────────────────────────────────────────────────────

_HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.normpath(os.path.join(_HERE, ".."))
ROUTES  = os.path.join(BACKEND, "routes")

def _path(*parts):
    return os.path.join(BACKEND, *parts)

def _read(filepath):
    try:
        with open(filepath, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""

# ── Helpers de output ─────────────────────────────────────────────────────────

OK      = "[OK]"
FAIL    = "[FALTANDO]"
INFO    = "[INFO]"
SEP     = "-" * 60

_results = []   # (label, ok: bool)

def ok(msg):
    print(f"  {OK} {msg}")
    _results.append((msg, True))

def fail(msg, hint=""):
    line = f"  {FAIL} {msg}"
    if hint:
        line += f"\n         -> {hint}"
    print(line)
    _results.append((msg, False))

def info(msg):
    print(f"  {INFO} {msg}")

def section(title):
    print(f"\n{SEP}")
    print(f"  {title}")
    print(SEP)

# ── Utilitarios de verificacao ─────────────────────────────────────────────────

def file_exists(rel_path, label=None):
    full = _path(rel_path)
    exists = os.path.isfile(full)
    lbl = label or rel_path
    if exists:
        ok(f"Arquivo {lbl} existe")
    else:
        fail(f"Arquivo {lbl} NAO encontrado", f"criar em backend/{rel_path}")
    return exists

def has_pattern(filepath, pattern, label, hint=""):
    content = _read(filepath)
    found = bool(re.search(pattern, content))
    if found:
        ok(label)
    else:
        fail(label, hint)
    return found

def has_import(filepath, module, label=None):
    content = _read(filepath)
    lbl = label or f"import {module}"
    found = bool(re.search(rf"\bimport\s+{module}\b|from\s+{module}\b", content))
    if found:
        ok(lbl)
    else:
        fail(lbl, f"adicionar 'import {module}' em {os.path.basename(filepath)}")
    return found

# ══════════════════════════════════════════════════════════════════════════════
# 1. CONTENT VARIATOR
# ══════════════════════════════════════════════════════════════════════════════

section("1. CONTENT VARIATOR")

cv_exists = file_exists("content_variator.py", "content_variator.py")
has_import(_path("routes", "campanhas.py"),   "content_variator", "importado em campanhas.py")
has_import(_path("routes", "aquecimento.py"), "content_variator", "importado em aquecimento.py")

has_pattern(
    _path("routes", "campanhas.py"),
    r"content_variator\.vary_message",
    "vary_message() chamado em campanhas.py",
    "adicionar content_variator.vary_message(msg.text) antes do envio"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"content_variator\.vary_message",
    "vary_message() chamado em aquecimento.py",
    "adicionar content_variator.vary_message(mensagem) em enviar_msg_aquecimento()"
)

if cv_exists:
    print()
    print("  [TESTE] 5 variacoes de 'Ola tudo bem?':")
    sys.path.insert(0, BACKEND)
    try:
        import content_variator as cv
        import importlib
        importlib.reload(cv)
        for i in range(5):
            variacao = cv.vary_message("Ola tudo bem?")
            printable = variacao.replace("\u200b", "<ZW>").replace("\u200c", "<ZW>").replace("\u200d", "<ZW>").replace("\u2060", "<ZW>")
            print(f"    [{i+1}] {printable!r}")
    except Exception as e:
        info(f"Nao foi possivel importar content_variator para teste: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# 2. GAUSSIAN JITTER
# ══════════════════════════════════════════════════════════════════════════════

section("2. GAUSSIAN JITTER (human_delay)")

has_pattern(
    _path("routes", "campanhas.py"),
    r"def human_delay\(",
    "human_delay() definido em campanhas.py",
    "adicionar funcao human_delay(min_ms, max_ms, text='') em campanhas.py"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"def human_delay\(",
    "human_delay() definido em aquecimento.py",
    "adicionar funcao human_delay(min_ms, max_ms, text='') em aquecimento.py"
)

# Verificar que nao ha random.uniform nos delays de envio
camp_src = _read(_path("routes", "campanhas.py"))
if "random.uniform" in camp_src:
    fail("random.uniform removido de campanhas.py",
         "substituir por human_delay(delay_min*1000, delay_max*1000, texto)")
else:
    ok("random.uniform nao encontrado em campanhas.py (substituido)")

aq_src = _read(_path("routes", "aquecimento.py"))
# Nos delays de envio/agendamento — random.randint para metas de msgs e indices e OK
# Contamos apenas usos em timedelta/sleep (delays reais)
aq_randint_delays = re.findall(r"timedelta.*random\.randint|asyncio\.sleep.*random\.randint", aq_src)
if aq_randint_delays:
    fail(f"random.randint ainda usado em {len(aq_randint_delays)} delay(s) de aquecimento.py",
         "substituir por human_delay() nos timedelta e asyncio.sleep")
else:
    ok("random.randint nao encontrado em delays de aquecimento.py (substituido)")

has_pattern(
    _path("routes", "campanhas.py"),
    r"human_delay\(",
    "human_delay() sendo chamado em campanhas.py",
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"human_delay\(",
    "human_delay() sendo chamado em aquecimento.py",
)

print()
print("  [TESTE] 5 delays para texto 'Ola' (delay min=5s max=15s):")
try:
    import random, math
    def _human_delay(min_ms, max_ms, text=""):
        mean = (min_ms + max_ms) / 2
        std  = (max_ms - min_ms) / 6
        base = max(float(min_ms), min(float(max_ms), random.gauss(mean, std)))
        return (base + len(text) * 30) / 1000.0
    for i in range(5):
        d = _human_delay(5000, 15000, "Ola")
        print(f"    [{i+1}] {d:.3f}s")
except Exception as e:
    info(f"Erro no teste: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# 3. CIRCUIT BREAKER
# ══════════════════════════════════════════════════════════════════════════════

section("3. CIRCUIT BREAKER")

file_exists("circuit_breaker.py", "circuit_breaker.py")
has_import(_path("routes", "webhook_waha.py"), "circuit_breaker",
           "circuit_breaker importado em webhook_waha.py")
has_pattern(
    _path("routes", "webhook_waha.py"),
    r"circuit_breaker\.record_reconnect",
    "record_reconnect() chamado no webhook",
    "adicionar circuit_breaker.record_reconnect(session_waha_id) quando status -> CONNECTED"
)

# Verificar configuracao do circuit breaker
cb_src = _read(_path("circuit_breaker.py"))
if cb_src:
    max_r = re.search(r"MAX_RECONNECTS_PER_HOUR\s*=\s*(\d+)", cb_src)
    pause_h = re.search(r"PAUSE_HOURS\s*=\s*(\d+)", cb_src)
    if max_r and pause_h:
        info(f"Config: max {max_r.group(1)} reconexoes/hora -> pausa de {pause_h.group(1)}h")
    ok("Circuit breaker configurado") if max_r else fail("MAX_RECONNECTS_PER_HOUR nao encontrado")

# ══════════════════════════════════════════════════════════════════════════════
# 4. HEALTH MONITOR
# ══════════════════════════════════════════════════════════════════════════════

section("4. HEALTH MONITOR")

file_exists("health_monitor.py", "health_monitor.py")
has_import(_path("routes", "campanhas.py"),    "health_monitor", "health_monitor importado em campanhas.py")
has_import(_path("routes", "webhook_waha.py"), "health_monitor", "health_monitor importado em webhook_waha.py")
has_pattern(
    _path("routes", "campanhas.py"),
    r"health_monitor\.get_action",
    "get_action() verificado antes de cada envio em campanhas.py",
    "adicionar health_monitor.get_action(session_id) antes do envio"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"health_monitor\.record_http_error",
    "record_http_error() chamado em falhas de campanha",
    "adicionar health_monitor.record_http_error(session_id, status_code) nas falhas"
)
has_pattern(
    _path("routes", "webhook_waha.py"),
    r"health_monitor\.record_disconnect",
    "record_disconnect() chamado no webhook",
    "adicionar health_monitor.record_disconnect(session_waha_id) em status -> disconnected"
)

hm_src = _read(_path("health_monitor.py"))
if hm_src:
    scores = {
        "401=+60": r"status_code == 401.*60|60.*401",
        "403=+40": r"status_code == 403.*40|40.*403",
        "desconexao=+15": r"add_risk.*15.*desconex|desconex.*15",
        "3+descon=+30":   r"add_risk.*30|30.*descon",
        "falha=+20":      r"add_risk.*20",
    }
    all_ok = True
    for label, pat in scores.items():
        if not re.search(pat, hm_src):
            fail(f"Score {label} nao encontrado em health_monitor.py")
            all_ok = False
    if all_ok:
        ok("Todos os scores de risco configurados (401/403/descon/falha)")

# ══════════════════════════════════════════════════════════════════════════════
# 5. BAN WAVE DETECTOR
# ══════════════════════════════════════════════════════════════════════════════

section("5. BAN WAVE DETECTOR")

file_exists("ban_wave_detector.py", "ban_wave_detector.py")
has_import(_path("routes", "campanhas.py"),    "ban_wave_detector", "ban_wave_detector importado em campanhas.py")
has_import(_path("routes", "aquecimento.py"),  "ban_wave_detector", "ban_wave_detector importado em aquecimento.py")
has_import(_path("routes", "webhook_waha.py"), "ban_wave_detector", "ban_wave_detector importado em webhook_waha.py")
has_pattern(
    _path("routes", "webhook_waha.py"),
    r"ban_wave_detector\.record_ban",
    "record_ban() chamado no webhook ao detectar BANNED",
    "adicionar ban_wave_detector.record_ban(session_waha_id) quando status_raw == 'BANNED'"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"ban_wave_detector\.is_system_paused",
    "is_system_paused() verificado em campanhas.py",
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"ban_wave_detector\.is_system_paused",
    "is_system_paused() verificado em aquecimento.py",
)

bwd_src = _read(_path("ban_wave_detector.py"))
if bwd_src:
    thr = re.search(r"BAN_WAVE_THRESHOLD\s*=\s*(\d+)", bwd_src)
    ph  = re.search(r"PAUSE_HOURS\s*=\s*(\d+)", bwd_src)
    if thr and ph:
        info(f"Config: {thr.group(1)}+ bans/hora -> sistema pausado por {ph.group(1)}h")

# ══════════════════════════════════════════════════════════════════════════════
# 6. OPT-OUT AUTOMATICO
# ══════════════════════════════════════════════════════════════════════════════

section("6. OPT-OUT AUTOMATICO")

wh_src = _read(_path("routes", "webhook_waha.py"))

has_pattern(
    _path("routes", "webhook_waha.py"),
    r"parar|PARAR",
    "palavra-chave 'PARAR' detectada em webhook_waha.py",
    "adicionar deteccao de opt-out keywords no handler de mensagens"
)
has_pattern(
    _path("routes", "webhook_waha.py"),
    r"is_blacklisted\s*=\s*True",
    "blacklist automatica implementada em webhook_waha.py",
    "adicionar contact.is_blacklisted = True quando opt-out detectado"
)
has_pattern(
    _path("routes", "webhook_waha.py"),
    r"Removido com sucesso",
    "resposta de confirmacao 'Removido com sucesso' implementada",
    "adicionar envio de confirmacao ao contato que optou por sair"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"OPT_OUT_FOOTER|PARAR para sair",
    "opt-out footer adicionado nas campanhas",
    "adicionar '\\n\\n_Responda PARAR para sair da lista._' na 1a mensagem"
)

# Verificar keywords completas
opt_keywords = ["parar", "stop", "sair", "cancelar"]
found_kw = [kw for kw in opt_keywords if kw in wh_src.lower()]
missing_kw = [kw for kw in opt_keywords if kw not in wh_src.lower()]
if not missing_kw:
    ok(f"Todas as keywords detectadas: {opt_keywords}")
else:
    fail(f"Keywords faltando: {missing_kw}")

# ══════════════════════════════════════════════════════════════════════════════
# 7. PAUSA A CADA 50 MENSAGENS
# ══════════════════════════════════════════════════════════════════════════════

section("7. PAUSA A CADA 50 MENSAGENS")

has_pattern(
    _path("routes", "campanhas.py"),
    r"PAUSE_EVERY_N\s*=\s*50|msgs_nesta_sessao",
    "contador de mensagens por sessao existe em campanhas.py",
    "adicionar variavel msgs_nesta_sessao e verificar a cada 50"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"% _PAUSE_EVERY_N|% 50",
    "logica de pausa a cada N msgs implementada",
    "adicionar: if msgs_nesta_sessao % 50 == 0: await asyncio.sleep(pausa)"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"PAUSE_MIN_SECS|PAUSE_MAX_SECS|600|900",
    "duracao de pausa 10-15min configurada",
    "definir PAUSE_MIN_SECS=600 e PAUSE_MAX_SECS=900"
)

# ══════════════════════════════════════════════════════════════════════════════
# 8. STATUS SEM MASSA (Issue #2309)
# ══════════════════════════════════════════════════════════════════════════════

section("8. STATUS SEM MASSA (Issue #2309)")

aq_src_full = _read(_path("routes", "aquecimento.py"))

# Status deve ir para status@broadcast APENAS (nunca para lista de contatos)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"status@broadcast",
    "status enviado apenas para status@broadcast (nao para lista)",
)

# Verificar que nao ha envio de status em massa
bulk_status = re.search(r"for.*contact.*status@broadcast|status@broadcast.*for.*contact", aq_src_full)
if bulk_status:
    fail("status sendo enviado em loop para lista de contatos (CRITICO - causa ban)",
         "remover loop e enviar status@broadcast apenas 1x por dia por chip")
else:
    ok("Nao ha envio de status em massa para lista de contatos")

# Verificar limite de 1 status por dia por chip
has_pattern(
    _path("routes", "aquecimento.py"),
    r"ultimo_status_em|ultimo_status",
    "controle de 1 status/dia por chip implementado",
    "adicionar verificacao: se ja postou status hoje, pular"
)

# ══════════════════════════════════════════════════════════════════════════════
# 9. BLOCK RATE MONITOR
# ══════════════════════════════════════════════════════════════════════════════

section("9. BLOCK RATE MONITOR")

has_pattern(
    _path("routes", "campanhas.py"),
    r"_chip_stats|block_rate|block rate",
    "rastreamento de block rate por chip existe em campanhas.py",
    "adicionar dict _chip_stats[session_id] = [total, falhas]"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"0\.05|5%|rate > 0",
    "alerta em block rate > 5% implementado",
    "adicionar: if falhas/total > 0.05: alertar"
)
has_pattern(
    _path("routes", "campanhas.py"),
    r"0\.10|10%",
    "pausa automatica em block rate > 10% implementada",
    "adicionar: if falhas/total > 0.10: pausar chip"
)

# ══════════════════════════════════════════════════════════════════════════════
# 10. WARM-UP SCHEDULE
# ══════════════════════════════════════════════════════════════════════════════

section("10. WARM-UP SCHEDULE OTIMIZADO")

expected = {1: 20, 2: 36, 3: 65, 4: 117, 5: 210, 6: 378, 7: 500}

has_pattern(
    _path("routes", "aquecimento.py"),
    r"_WARMUP_SCHEDULE|WARMUP_SCHEDULE",
    "dicionario _WARMUP_SCHEDULE existe em aquecimento.py",
    "adicionar _WARMUP_SCHEDULE = {1:20, 2:36, 3:65, 4:117, 5:210, 6:378, 7:500}"
)

aq_src_check = _read(_path("routes", "aquecimento.py"))
all_days_ok = True
for day, msgs in expected.items():
    pat = rf"{day}\s*:\s*{msgs}"
    if not re.search(pat, aq_src_check):
        fail(f"Dia {day}: {msgs} msgs NAO encontrado no schedule")
        all_days_ok = False
if all_days_ok:
    ok("Progressao correta: " + " -> ".join(str(v) for v in expected.values()))

# Verificar que get_meta_dia usa o novo schedule
has_pattern(
    _path("routes", "aquecimento.py"),
    r"def get_meta_dia",
    "funcao get_meta_dia() existe",
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"_WARMUP_SCHEDULE\.get\(|WARMUP_SCHEDULE\.get\(",
    "get_meta_dia() usa _WARMUP_SCHEDULE",
    "atualizar get_meta_dia() para usar _WARMUP_SCHEDULE.get(dia, 500)"
)

# ══════════════════════════════════════════════════════════════════════════════
# 11. SIMULACAO HUMANA NO AQUECIMENTO
# ══════════════════════════════════════════════════════════════════════════════

section("11. SIMULACAO DE COMPORTAMENTO HUMANO (Aquecimento)")

has_pattern(
    _path("routes", "aquecimento.py"),
    r"def enviar_msg_aquecimento_humano",
    "funcao enviar_msg_aquecimento_humano() existe",
    "criar funcao com sendSeen + startTyping + delay + stopTyping + sendText"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"sendSeen",
    "sendSeen (marcar como lido) implementado",
    "adicionar POST /api/sendSeen antes de digitar"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"startTyping",
    "startTyping implementado",
    "adicionar POST /api/startTyping"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"stopTyping",
    "stopTyping implementado",
    "adicionar POST /api/stopTyping antes de enviar"
)
has_pattern(
    _path("routes", "aquecimento.py"),
    r"enviar_msg_aquecimento_humano",
    "enviar_msg_aquecimento_humano() sendo chamado para respostas virtuais",
    "substituir enviar_msg_aquecimento() por enviar_msg_aquecimento_humano() para o chip virtual responder"
)

# ══════════════════════════════════════════════════════════════════════════════
# SUMARIO FINAL
# ══════════════════════════════════════════════════════════════════════════════

total  = len(_results)
passed = sum(1 for _, ok_flag in _results if ok_flag)
failed = total - passed

print(f"\n{'=' * 60}")
print(f"  RESULTADO FINAL")
print(f"{'=' * 60}")
print(f"  Total de verificacoes : {total}")
print(f"  {OK}          : {passed}")
print(f"  {FAIL}    : {failed}")
print()

if failed == 0:
    print("  SISTEMA ANTI-BAN 100% IMPLEMENTADO")
else:
    pct = round(passed / total * 100)
    print(f"  Implementacao: {pct}% concluida")
    print()
    print("  Itens pendentes:")
    for label, ok_flag in _results:
        if not ok_flag:
            print(f"    - {label}")

print(f"{'=' * 60}\n")
sys.exit(0 if failed == 0 else 1)
