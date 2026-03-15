import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

import models
from database import get_db
from config import settings
from email_utils import enviar_email_boas_vindas

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stripe", tags=["Stripe"])


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Recebe eventos do Stripe:
    - checkout.session.completed → ativa usuário + trial
    - invoice.payment_succeeded  → renova plano após trial
    - invoice.payment_failed     → desativa usuário
    """
    if not settings.STRIPE_SECRET_KEY:
        logger.error("[STRIPE] STRIPE_SECRET_KEY não configurada!")
        raise HTTPException(status_code=503, detail="Stripe não configurado")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        import stripe
        stripe.api_key = settings.STRIPE_SECRET_KEY

        if not settings.STRIPE_WEBHOOK_SECRET:
            logger.error("[STRIPE] STRIPE_WEBHOOK_SECRET não configurado!")
            raise HTTPException(status_code=400, detail="Webhook secret não configurado")

        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )

    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"[STRIPE] Payload inválido: {e}")
        raise HTTPException(status_code=400, detail="Payload inválido")
    except Exception as e:
        logger.error(f"[STRIPE] Erro ao verificar assinatura: {e}")
        raise HTTPException(status_code=400, detail="Assinatura inválida")

    event_type = event.get("type", "")
    event_id = event.get("id", "")
    data_obj = event.get("data", {}).get("object", {})

    logger.info(f"[STRIPE] Evento recebido: {event_type} (id={event_id})")

    # ── checkout.session.completed ─────────────────────────────────────────────
    if event_type == "checkout.session.completed":
        user_id_str = data_obj.get("metadata", {}).get("user_id")
        subscription_id = data_obj.get("subscription")

        if not user_id_str:
            logger.warning("[STRIPE] checkout.session.completed sem user_id no metadata")
            return {"status": "ignored"}

        user = db.query(models.User).filter(models.User.id == int(user_id_str)).first()
        if not user:
            logger.warning(f"[STRIPE] Usuário {user_id_str} não encontrado")
            return {"status": "user_not_found"}

        # Idempotência: já ativado por evento anterior
        if user.trial_ativo:
            logger.info(f"[STRIPE] checkout.session.completed já processado para usuário {user.id} — ignorando")
            return {"status": "ok"}

        now = datetime.now(timezone.utc)
        trial_expira = now + timedelta(days=7)

        user.is_active = True
        user.trial_ativo = True
        user.trial_expira_em = trial_expira
        if subscription_id:
            user.stripe_subscription_id = subscription_id
        # Plano ativo até o fim do trial (será atualizado por invoice.payment_succeeded)
        user.plan_expires_at = trial_expira
        db.commit()

        logger.info(f"[STRIPE] Usuário {user.id} ({user.email}) ativado com trial até {trial_expira}")

        # Email de boas-vindas
        try:
            expira_fmt = trial_expira.strftime("%d/%m/%Y")
            enviar_email_boas_vindas(user.email, user.name, expira_fmt)
        except Exception as e:
            logger.error(f"[STRIPE] Erro ao enviar email boas-vindas: {e}")

    # ── invoice.payment_succeeded ──────────────────────────────────────────────
    elif event_type == "invoice.payment_succeeded":
        subscription_id = data_obj.get("subscription")
        billing_reason = data_obj.get("billing_reason", "")

        # Ignora a invoice gerada durante o trial (ciclo zero)
        if billing_reason == "subscription_create":
            logger.info("[STRIPE] invoice.payment_succeeded ignorado (subscription_create — trial)")
            return {"status": "ok"}

        if not subscription_id:
            return {"status": "ignored"}

        user = db.query(models.User).filter(
            models.User.stripe_subscription_id == subscription_id
        ).first()
        if not user:
            logger.warning(f"[STRIPE] Usuário não encontrado para subscription {subscription_id}")
            return {"status": "user_not_found"}

        now = datetime.now(timezone.utc)

        # Idempotência: plano já está ativo e não expirou
        if user.plan_expires_at and user.plan_expires_at.replace(tzinfo=timezone.utc) > now:
            logger.info(f"[STRIPE] invoice.payment_succeeded já processado para usuário {user.id} — ignorando")
            return {"status": "ok"}

        user.is_active = True
        user.trial_ativo = False
        user.plan_expires_at = now + timedelta(days=30)
        db.commit()

        logger.info(f"[STRIPE] Plano renovado para usuário {user.id} ({user.email})")

    # ── invoice.payment_failed ─────────────────────────────────────────────────
    elif event_type == "invoice.payment_failed":
        subscription_id = data_obj.get("subscription")
        if not subscription_id:
            return {"status": "ignored"}

        user = db.query(models.User).filter(
            models.User.stripe_subscription_id == subscription_id
        ).first()
        if not user:
            return {"status": "user_not_found"}

        user.is_active = False
        db.commit()

        logger.warning(f"[STRIPE] Pagamento falhou — usuário {user.id} ({user.email}) desativado")

    # ── customer.subscription.updated ─────────────────────────────────────────
    elif event_type == "customer.subscription.deleted":
        subscription_id = data_obj.get("id")
        if subscription_id:
            user = db.query(models.User).filter(
                models.User.stripe_subscription_id == subscription_id
            ).first()
            if user:
                user.is_active = False
                user.trial_ativo = False
                db.commit()
                logger.info(f"[STRIPE] Assinatura cancelada — usuário {user.id} desativado")

    return {"status": "ok"}
