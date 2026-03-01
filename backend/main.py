import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from database import engine, Base, get_db
import models  # noqa: F401 – importa para registrar os models

from routes import usuarios, sessoes, contatos, campanhas, pagamentos
from routes.webhook_waha import router as webhook_router
from routes.admin import router as admin_router
from routes.debug import router as debug_router
from routes.atividades import router as atividades_router
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def wait_for_db(retries: int = 5, delay: int = 3) -> bool:
    """Tenta conectar ao banco com retry. Retorna True se conseguiu, False caso contrário."""
    for attempt in range(1, retries + 1):
        try:
            logger.info(f"[DB] Tentativa {attempt}/{retries} de conexão com o banco...")
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("[DB] Conexão com o banco estabelecida com sucesso.")
            return True
        except Exception as e:
            logger.error(f"[DB] Tentativa {attempt}/{retries} falhou: {e}")
            if attempt < retries:
                logger.info(f"[DB] Aguardando {delay}s antes da próxima tentativa...")
                time.sleep(delay)
    logger.warning("[DB] Não foi possível conectar ao banco após todas as tentativas. O servidor continuará, mas pode estar instável.")
    return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[STARTUP] Iniciando aplicação...")
    db_ok = wait_for_db(retries=5, delay=3)
    if db_ok:
        try:
            logger.info("[STARTUP] Criando tabelas no banco se não existirem...")
            Base.metadata.create_all(bind=engine)
            logger.info("[STARTUP] Tabelas verificadas/criadas com sucesso.")
        except Exception as e:
            logger.error(f"[STARTUP] Erro ao criar tabelas: {e}")
    else:
        logger.warning("[STARTUP] Pulando create_all — banco indisponível no momento do startup.")
    logger.info("[STARTUP] Aplicação pronta para receber requisições.")
    yield
    logger.info("[SHUTDOWN] Encerrando aplicação.")


app = FastAPI(
    title=settings.APP_NAME,
    description="API SaaS para disparo de WhatsApp em massa",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(usuarios.router)
app.include_router(sessoes.router)
app.include_router(contatos.router)
app.include_router(campanhas.router)
app.include_router(pagamentos.router)
app.include_router(webhook_router, prefix="/api/webhook")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(debug_router)
app.include_router(atividades_router)


@app.get("/")
def root():
    return {"message": f"{settings.APP_NAME} API está online", "docs": "/docs"}


@app.get("/health")
def health():
    try:
        db = next(get_db())
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception as e:
        db_status = f"error: {e}"
    return {"status": "ok", "database": db_status}
