import smtplib
import logging
import random
import string
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import settings

logger = logging.getLogger(__name__)


def gerar_codigo_verificacao() -> str:
    """Gera código numérico de 6 dígitos."""
    return ''.join(random.choices(string.digits, k=6))


def enviar_email_verificacao(email: str, nome: str, codigo: str) -> bool:
    """
    Envia email com código de verificação.
    Se SMTP não configurado, apenas loga o código (modo desenvolvimento).
    Retorna True se enviou com sucesso.
    """
    if not settings.SMTP_USER or not settings.SMTP_PASS:
        logger.warning(f"[EMAIL] SMTP não configurado — código para {email}: {codigo}")
        return True  # Em dev, considera enviado

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"{codigo} — seu código de verificação WahaSaaS"
        msg["From"] = settings.SMTP_FROM
        msg["To"] = email

        html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#111827;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#1f2937;border-radius:12px;overflow:hidden;border:1px solid #374151;">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:bold;">WahaSaaS</h1>
    </div>
    <div style="padding:32px;">
      <p style="color:#d1d5db;margin:0 0 6px;font-size:15px;">Olá, {nome}!</p>
      <p style="color:#9ca3af;margin:0 0 24px;font-size:14px;">Digite o código abaixo para confirmar seu e-mail:</p>
      <div style="background:#111827;border-radius:12px;padding:28px;text-align:center;margin-bottom:24px;">
        <span style="color:#a78bfa;font-size:44px;font-weight:bold;font-family:monospace;letter-spacing:12px;">{codigo}</span>
      </div>
      <p style="color:#6b7280;font-size:13px;margin:0 0 6px;">⏰ Este código expira em <strong style="color:#9ca3af;">30 minutos</strong>.</p>
      <p style="color:#6b7280;font-size:13px;margin:0;">Se você não criou uma conta no WahaSaaS, ignore este email.</p>
    </div>
  </div>
</body>
</html>"""

        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(settings.SMTP_FROM, [email], msg.as_string())

        logger.info(f"[EMAIL] Código de verificação enviado para {email}")
        return True

    except Exception as e:
        logger.error(f"[EMAIL] Erro ao enviar para {email}: {e}")
        return False
