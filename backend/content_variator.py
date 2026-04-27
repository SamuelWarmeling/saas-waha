"""
Content Variator — torna cada mensagem única para evitar fingerprint de spam.

Técnicas:
- Substituição de sinônimos (30% de chance por palavra-chave)
- Variação de pontuação final (20% de chance)
- Inserção de zero-width characters invisíveis (1-2 por mensagem)
"""
import random

SINONIMOS: dict[str, list[str]] = {
    'olá': ['oi', 'hey', 'opa', 'eae', 'salve'],
    'bom dia': ['bom diaa', 'bom dia!', 'boa manhã'],
    'boa tarde': ['boa tarde!', 'boa tardee'],
    'boa noite': ['boa noite!', 'boa noitee'],
    'obrigado': ['obg', 'valeu', 'grato', 'obrigadão'],
    'obrigada': ['obg', 'valeu', 'grata', 'obrigadão'],
    'tudo bem': ['tudo certo', 'tudo bom', 'tudo ok'],
    'você': ['vc', 'cê'],
    'também': ['tbm', 'tb'],
    'ótimo': ['excelente', 'perfeito', 'show', 'top'],
}

# Caracteres invisíveis que tornam cada mensagem única no hash
_ZERO_WIDTH = ['\u200b', '\u200c', '\u200d', '\u2060']


def _insert_zero_width(text: str) -> str:
    """Insere 1-2 zero-width chars em posições aleatórias do meio do texto."""
    if len(text) < 10:
        return text
    n = random.randint(1, 2)
    positions = sorted(random.sample(range(1, len(text)), min(n, len(text) - 1)))
    chars = list(text)
    for offset, pos in enumerate(positions):
        chars.insert(pos + offset, random.choice(_ZERO_WIDTH))
    return ''.join(chars)


def _vary_synonyms(text: str) -> str:
    """Substitui palavras-chave por sinônimos com 30% de probabilidade."""
    text_lower = text.lower()
    result = text
    for original, synonyms in SINONIMOS.items():
        if original in text_lower and random.random() < 0.30:
            idx = text_lower.find(original)
            replacement = random.choice(synonyms)
            result = result[:idx] + replacement + result[idx + len(original):]
            text_lower = result.lower()
    return result


def _vary_punctuation(text: str) -> str:
    """Varia levemente a pontuação final com 20% de probabilidade."""
    if random.random() > 0.20:
        return text
    if text.endswith('!'):
        return text + '!'
    if text.endswith('.') and not text.endswith('...'):
        return text[:-1]
    return text


def vary_message(text: str) -> str:
    """
    Aplica todas as técnicas de variação para tornar cada mensagem única.
    Deve ser chamado imediatamente antes de cada envio.
    """
    if not text or len(text) < 3:
        return text
    text = _vary_synonyms(text)
    text = _vary_punctuation(text)
    text = _insert_zero_width(text)
    return text
