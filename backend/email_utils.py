import smtplib
import logging
import secrets
import html as _html
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from config import settings

logger = logging.getLogger(__name__)


def gerar_codigo_verificacao() -> str:
    """Gera código numérico de 6 dígitos usando gerador criptograficamente seguro."""
    return ''.join(secrets.choice('0123456789') for _ in range(6))


def _enviar_via_resend(to_email: str, subject: str, html: str) -> bool:
    """Envia email usando a API Resend."""
    try:
        import resend
        resend.api_key = settings.RESEND_API_KEY
        resend.Emails.send({
            "from": settings.SMTP_FROM,
            "to": [to_email],
            "subject": subject,
            "html": html,
        })
        return True
    except Exception as e:
        logger.error(f"[RESEND] Erro ao enviar para {to_email}: {e}")
        return False


def _enviar_via_smtp(to_email: str, subject: str, html: str) -> bool:
    """Envia email usando SMTP (fallback)."""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to_email
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASS)
            server.sendmail(settings.SMTP_FROM, [to_email], msg.as_string())

        return True
    except Exception as e:
        logger.error(f"[SMTP] Erro ao enviar para {to_email}: {e}")
        return False


def _enviar_email(to_email: str, subject: str, html: str) -> bool:
    """
    Envia email preferindo Resend, com fallback para SMTP.
    Se nenhum estiver configurado, loga e retorna True (modo dev).
    """
    if settings.RESEND_API_KEY:
        logger.info(f"[EMAIL] Enviando via Resend para {to_email}")
        return _enviar_via_resend(to_email, subject, html)

    if settings.SMTP_USER and settings.SMTP_PASS:
        logger.info(f"[EMAIL] Enviando via SMTP para {to_email}")
        return _enviar_via_smtp(to_email, subject, html)

    logger.warning(f"[EMAIL] Resend e SMTP não configurados — email para {to_email} não enviado (dev mode).")
    return True


def enviar_email_verificacao(email: str, nome: str, codigo: str) -> bool:
    """Envia email com código de verificação."""
    if not settings.RESEND_API_KEY and not settings.SMTP_USER:
        logger.warning(f"[EMAIL] SMTP/Resend não configurados — código para {email}: {codigo}")
        return True

    nome_safe = _html.escape(nome)
    subject = f"{codigo} — seu código de verificação WahaSaaS"
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#111827;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#1f2937;border-radius:12px;overflow:hidden;border:1px solid #374151;">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:bold;">WahaSaaS</h1>
    </div>
    <div style="padding:32px;">
      <p style="color:#d1d5db;margin:0 0 6px;font-size:15px;">Olá, {nome_safe}!</p>
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

    ok = _enviar_email(email, subject, html)
    if ok:
        logger.info(f"[EMAIL] Código de verificação enviado para {email}")
    return ok


def enviar_email_boas_vindas(email: str, nome: str, trial_expira: str) -> bool:
    """Envia email de boas-vindas após ativação do trial via Stripe."""
    if not settings.RESEND_API_KEY and not settings.SMTP_USER:
        logger.info(f"[EMAIL] Boas-vindas (sem provedor configurado) para {email}")
        return True

    nome_safe = _html.escape(nome)
    subject = "🎉 Seu trial de 7 dias foi ativado — WahaSaaS"
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#111827;font-family:Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#1f2937;border-radius:12px;overflow:hidden;border:1px solid #374151;">
    <div style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:24px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:bold;">WahaSaaS</h1>
    </div>
    <div style="padding:32px;">
      <p style="color:#d1d5db;margin:0 0 6px;font-size:18px;font-weight:bold;">🎉 Bem-vindo, {nome_safe}!</p>
      <p style="color:#9ca3af;margin:12px 0;font-size:14px;">Seu trial gratuito de 7 dias foi ativado com sucesso.</p>
      <div style="background:#111827;border-radius:12px;padding:20px;margin:20px 0;border:1px solid #374151;">
        <p style="color:#a78bfa;font-size:14px;margin:0 0 8px;font-weight:bold;">✅ Você tem acesso completo até:</p>
        <p style="color:white;font-size:20px;margin:0;font-weight:bold;">{trial_expira}</p>
      </div>
      <p style="color:#9ca3af;font-size:13px;margin:0 0 6px;">💳 Após o trial, seu cartão será cobrado automaticamente.</p>
      <p style="color:#6b7280;font-size:13px;margin:0;">Cancele quando quiser, sem burocracia.</p>
    </div>
  </div>
</body>
</html>"""

    ok = _enviar_email(email, subject, html)
    if ok:
        logger.info(f"[EMAIL] Boas-vindas enviado para {email}")
    return ok
