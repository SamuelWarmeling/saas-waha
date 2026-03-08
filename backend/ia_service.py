"""
Serviço de Inteligência Artificial — Google Gemini
Gera mensagens naturais para aquecimento de chips WhatsApp.
"""
import asyncio
import logging
import random
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
except ImportError:
    genai = None  # type: ignore
    GEMINI_AVAILABLE = False
    logger.warning("[IA] google-generativeai não instalado. Apenas fallback disponível.")

MODELO = "gemini-1.5-flash"

# Pool de fallback — importado dinamicamente para evitar circular import
_POOL_FALLBACK = [
    "Bom dia! ☀️ Tudo bem por aí?",
    "Boa tarde! Como está sendo seu dia? 😊",
    "Boa noite! Como foi o dia? 🌙",
    "Eaí! Tudo bem? 😄",
    "Oi! Você tá bem? 😊",
    "Que calor hoje hein 😅",
    "Feliz segunda! Vamos nessa 💪",
    "Tomou água hoje? 💧",
    "Café, foco e fé! Bora 🚀",
    "Acredita em você! 🌟",
    "Tudo certo na sua semana? 😊",
    "Oi! Passando pra dar um oi 👋",
]


def _resolve_api_key(user_key: Optional[str] = None) -> Optional[str]:
    from config import settings
    return (user_key and user_key.strip()) or (settings.GEMINI_API_KEY and settings.GEMINI_API_KEY.strip()) or None


def _gerar_sync(prompt: str, api_key: str) -> str:
    """Chamada síncrona ao Gemini — será executada em thread."""
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(MODELO)
    response = model.generate_content(prompt)
    return (response.text or "").strip().strip('"').strip("'")


def _fallback(historico: Optional[list] = None) -> str:
    """Mensagem do pool fixo evitando o histórico recente."""
    pool = _POOL_FALLBACK
    try:
        from routes.aquecimento import MENSAGENS_AQUECIMENTO
        pool = MENSAGENS_AQUECIMENTO
    except ImportError:
        pass
    historico = historico or []
    opcoes = [m for m in pool if m not in historico[-5:]]
    return random.choice(opcoes if opcoes else pool)


async def gerar_mensagem_aquecimento(
    historico: Optional[list] = None,
    user_key: Optional[str] = None,
    gemini_habilitado: bool = True,
) -> tuple[str, bool]:
    """
    Gera mensagem de aquecimento via Gemini ou pool fixo.
    Retorna (mensagem, is_ia).
    """
    historico = historico or []
    api_key = _resolve_api_key(user_key)

    if not GEMINI_AVAILABLE or not api_key or not gemini_habilitado:
        return _fallback(historico), False

    try:
        hist_str = ", ".join(f'"{m}"' for m in historico[-5:]) if historico else "nenhum"
        prompt = (
            "Você é uma pessoa brasileira comum trocando mensagens no WhatsApp.\n"
            "Gere UMA mensagem curta, casual e natural em português brasileiro.\n"
            "Regras:\n"
            "- Máximo 15 palavras\n"
            "- Use linguagem informal e descontraída\n"
            "- Pode usar 1-2 emojis no máximo\n"
            "- Varie entre: saudações, comentários do dia, perguntas casuais\n"
            "- NUNCA mencione vendas, produtos ou negócios\n"
            f"- NUNCA repita mensagens do histórico: {hist_str}\n"
            "Responda APENAS com a mensagem, sem aspas, sem explicações."
        )
        msg = await asyncio.to_thread(_gerar_sync, prompt, api_key)

        # Validações básicas
        if not msg or len(msg) > 200 or len(msg.split()) > 25:
            logger.warning(f"[IA] Resposta inválida do Gemini, usando fallback: {msg!r}")
            return _fallback(historico), False

        logger.info(f"[IA] Mensagem gerada pelo Gemini: {msg!r}")
        return msg, True

    except Exception as e:
        logger.warning(f"[IA] Gemini falhou ({type(e).__name__}: {e}), usando fallback")
        return _fallback(historico), False


async def gerar_resposta_natural(
    mensagem_recebida: str,
    user_key: Optional[str] = None,
) -> str:
    """Gera resposta contextual curta para auto-resposta."""
    api_key = _resolve_api_key(user_key)
    if not GEMINI_AVAILABLE or not api_key:
        return random.choice(["Ok! 👍", "Entendi 😊", "Certo!", "Tá bom!", "👍"])

    try:
        prompt = (
            f'Você é uma pessoa brasileira no WhatsApp.\n'
            f'Responda de forma curta e casual à mensagem: "{mensagem_recebida}"\n'
            "- Máximo 10 palavras\n"
            "- Linguagem informal\n"
            "- 1 emoji opcional\n"
            "Responda APENAS com a mensagem."
        )
        msg = await asyncio.to_thread(_gerar_sync, prompt, api_key)
        return msg or "Ok! 👍"
    except Exception:
        return random.choice(["Ok! 👍", "Entendi 😊", "Certo!"])


async def testar_conexao(user_key: Optional[str] = None) -> dict:
    """Testa a conexão com a API Gemini e retorna status."""
    if not GEMINI_AVAILABLE:
        return {
            "ok": False,
            "erro": "Biblioteca google-generativeai não instalada no servidor",
        }

    api_key = _resolve_api_key(user_key)
    if not api_key:
        return {
            "ok": False,
            "erro": "Nenhuma API key configurada. Adicione sua chave em Configurações > Inteligência Artificial.",
        }

    try:
        msg = await asyncio.to_thread(_gerar_sync, "Responda apenas 'ok'.", api_key)
        return {"ok": True, "resposta": msg, "modelo": MODELO}
    except Exception as e:
        erro = str(e)
        if "API_KEY_INVALID" in erro or "invalid" in erro.lower():
            return {"ok": False, "erro": "Chave de API inválida. Verifique em aistudio.google.com"}
        if "quota" in erro.lower() or "429" in erro:
            return {"ok": False, "erro": "Cota excedida. Aguarde alguns minutos e tente novamente."}
        if "PERMISSION_DENIED" in erro:
            return {"ok": False, "erro": "Permissão negada. Verifique se a API está ativada no seu projeto Google."}
        return {"ok": False, "erro": f"Erro: {erro[:150]}"}
