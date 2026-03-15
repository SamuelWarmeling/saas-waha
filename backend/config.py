from pydantic_settings import BaseSettings
from pydantic import validator
from functools import lru_cache
import os


class Settings(BaseSettings):
    # App
    APP_NAME: str = "WahaSaaS"
    DEBUG: bool = False
    SECRET_KEY: str = "troque-esta-chave-secreta-em-producao"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/saas_waha"

    # Waha API
    WAHA_API_URL: str = "https://waha-waha.xeramr.easypanel.host"
    WAHA_API_KEY: str = ""
    WAHA_WEBHOOK_URL: str = "https://api-saas.xeramr.easypanel.host/api/webhook/waha"

    # Mercado Pago
    MP_ACCESS_TOKEN: str = ""
    MP_PUBLIC_KEY: str = ""
    MP_WEBHOOK_SECRET: str = ""

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PRICE_ID: str = ""  # Price ID do plano Pro no Stripe (ex: price_xxx)

    # Planos
    PLAN_STARTER_ID: str = "starter"
    PLAN_PRO_ID: str = "pro"
    PLAN_BUSINESS_ID: str = "business"

    # Frontend URL (para webhooks/redirects)
    FRONTEND_URL: str = "https://app-saas.xeramr.easypanel.host"

    # Números de aquecimento fixos (fallback, separados por vírgula, ex: "5511999990001,5511999990002")
    AQUECIMENTO_NUMBERS: str = ""

    # Google Gemini IA
    GEMINI_API_KEY: str = ""
    GEMINI_ENABLED: bool = True

    # URL pública do backend (usada pelo WAHA para buscar arquivos de mídia)
    BACKEND_URL: str = "https://api-saas.xeramr.easypanel.host"

    # SMTP (email de verificação — fallback)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASS: str = ""
    SMTP_FROM: str = "noreply@wahasaas.com"

    # Resend (email transacional — preferido sobre SMTP)
    RESEND_API_KEY: str = ""

    # Sentry (monitoramento de erros)
    SENTRY_DSN: str = ""

    @validator('SECRET_KEY')
    def secret_key_must_not_be_default(cls, v):
        if v == 'troque-esta-chave-secreta-em-producao':
            import os
            if os.getenv('APP_ENV', 'development') == 'production':
                raise ValueError('SECRET_KEY deve ser alterada no .env antes de usar em produção')
        return v

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

# Definição dos planos
PLANS = {
    "starter": {
        "id": "starter",
        "name": "Starter",
        "price": 197.00,
        "max_sessions": 2,
        "max_daily_messages": 200,
        "description": "Ideal para começar",
    },
    "pro": {
        "id": "pro",
        "name": "Pro",
        "price": 397.00,
        "max_sessions": 5,
        "max_daily_messages": 500,
        "description": "Para negócios em crescimento",
    },
    "business": {
        "id": "business",
        "name": "Business",
        "price": 797.00,
        "max_sessions": 10,
        "max_daily_messages": 1000,
        "description": "Escala máxima",
    },
}
