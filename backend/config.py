from pydantic_settings import BaseSettings
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
    WAHA_API_KEY: str = "wARM31Ngadmin"
    WAHA_WEBHOOK_URL: str = "https://api-saas.xeramr.easypanel.host/api/webhook/waha"

    # Mercado Pago
    MP_ACCESS_TOKEN: str = ""
    MP_PUBLIC_KEY: str = ""
    MP_WEBHOOK_SECRET: str = ""

    # Planos
    PLAN_STARTER_ID: str = "starter"
    PLAN_PRO_ID: str = "pro"
    PLAN_BUSINESS_ID: str = "business"

    # Frontend URL (para webhooks/redirects)
    FRONTEND_URL: str = "https://app-saas.xeramr.easypanel.host"

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
