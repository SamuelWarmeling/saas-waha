from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone
import mercadopago
import hashlib
import hmac

import models
import auth
from database import get_db
from config import settings, PLANS

router = APIRouter(prefix="/api/pagamentos", tags=["Pagamentos"])

sdk = mercadopago.SDK(settings.MP_ACCESS_TOKEN)


# ── Schemas ──────────────────────────────────────────────────────────────────
class CreatePreferenceRequest(BaseModel):
    plan_id: str  # starter | pro | business


class PaymentOut(BaseModel):
    id: int
    plan: str
    amount: float
    status: str
    mp_payment_id: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────
def verify_mp_signature(request_body: bytes, x_signature: str, x_request_id: str) -> bool:
    if not settings.MP_WEBHOOK_SECRET:
        return True  # sem secret configurado, aceita tudo (desenvolvimento)

    manifest = f"id:{x_request_id};request-id:{x_request_id};"
    expected = hmac.new(
        settings.MP_WEBHOOK_SECRET.encode(),
        manifest.encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, x_signature.split("=")[-1])


def activate_plan(user: models.User, plan_id: str, db: Session):
    user.plan = models.PlanType(plan_id)
    user.plan_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    db.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/planos")
def list_plans():
    return list(PLANS.values())


@router.post("/criar-preferencia")
def create_preference(
    data: CreatePreferenceRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    plan = PLANS.get(data.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Plano inválido")

    preference_data = {
        "items": [
            {
                "id": plan["id"],
                "title": f"WahaSaaS - Plano {plan['name']}",
                "description": plan["description"],
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": plan["price"],
            }
        ],
        "payer": {"email": current_user.email},
        "external_reference": f"{current_user.id}|{plan['id']}",
        "back_urls": {
            "success": f"{settings.FRONTEND_URL}/pagamento/sucesso",
            "failure": f"{settings.FRONTEND_URL}/pagamento/falha",
            "pending": f"{settings.FRONTEND_URL}/pagamento/pendente",
        },
        "auto_return": "approved",
        "notification_url": f"{settings.FRONTEND_URL.replace('localhost:5173', 'localhost:8000')}/api/pagamentos/webhook",
        "statement_descriptor": "WAHASAAS",
    }

    result = sdk.preference().create(preference_data)
    response = result["response"]

    if "id" not in response:
        raise HTTPException(status_code=502, detail="Erro ao criar preferência no Mercado Pago")

    # Salva registro de pagamento pendente
    payment = models.Payment(
        user_id=current_user.id,
        plan=models.PlanType(data.plan_id),
        amount=plan["price"],
        status=models.PaymentStatus.pending,
        mp_preference_id=response["id"],
    )
    db.add(payment)
    db.commit()

    return {
        "preference_id": response["id"],
        "init_point": response["init_point"],
        "sandbox_init_point": response.get("sandbox_init_point"),
    }


@router.post("/webhook")
async def mp_webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    x_signature = request.headers.get("x-signature", "")
    x_request_id = request.headers.get("x-request-id", "")

    data = await request.json()
    topic = data.get("type") or data.get("topic", "")
    resource_id = data.get("data", {}).get("id") or data.get("id")

    if topic not in ("payment", "merchant_order"):
        return {"status": "ignored"}

    if topic == "payment" and resource_id:
        mp_result = sdk.payment().get(resource_id)
        payment_data = mp_result["response"]

        mp_status = payment_data.get("status")
        external_ref = payment_data.get("external_reference", "")
        mp_payment_id = str(payment_data.get("id", ""))

        try:
            user_id, plan_id = external_ref.split("|")
            user_id = int(user_id)
        except (ValueError, AttributeError):
            return {"status": "invalid_reference"}

        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            return {"status": "user_not_found"}

        payment = db.query(models.Payment).filter(
            models.Payment.mp_preference_id.isnot(None),
            models.Payment.user_id == user_id,
            models.Payment.status == models.PaymentStatus.pending,
        ).order_by(models.Payment.created_at.desc()).first()

        if payment:
            payment.mp_payment_id = mp_payment_id

            if mp_status == "approved":
                payment.status = models.PaymentStatus.approved
                activate_plan(user, plan_id, db)
            elif mp_status in ("rejected", "cancelled"):
                payment.status = models.PaymentStatus.rejected
            elif mp_status == "refunded":
                payment.status = models.PaymentStatus.refunded

            db.commit()

    return {"status": "ok"}


@router.get("/historico", response_model=List[PaymentOut])
def payment_history(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    payments = (
        db.query(models.Payment)
        .filter(models.Payment.user_id == current_user.id)
        .order_by(models.Payment.created_at.desc())
        .limit(20)
        .all()
    )
    return payments


@router.post("/ativar-trial")
def activate_trial(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Ativa 7 dias de trial gratuito (uma vez por conta)."""
    already_paid = db.query(models.Payment).filter(
        models.Payment.user_id == current_user.id,
        models.Payment.status == models.PaymentStatus.approved,
    ).first()

    if already_paid:
        raise HTTPException(status_code=400, detail="Trial disponível apenas para novas contas sem pagamento")

    if current_user.plan_expires_at and current_user.plan_expires_at > datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Você já tem um plano ativo")

    current_user.plan = models.PlanType.starter
    current_user.plan_expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    db.commit()

    return {"message": "Trial de 7 dias ativado!", "expires_at": current_user.plan_expires_at}
