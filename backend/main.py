import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from database import engine, Base, get_db
import models  # noqa: F401 – importa para registrar os models

from routes import usuarios, sessoes, contatos, campanhas, pagamentos, grupos
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


def migrate_groups_table():
    """
    Corrige o schema da tabela groups:
    - Remove a constraint unique global em group_id_waha (se existir)
    - Garante a constraint composta (user_id, group_id_waha)
    A tabela é nova e deve estar vazia, portanto é seguro recriar.
    """
    try:
        with engine.connect() as conn:
            # Verifica se a tabela existe
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'groups')"
            ))
            if not result.scalar():
                return  # Tabela não existe ainda, create_all vai criá-la corretamente

            # Verifica se a constraint composta já existe
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints "
                "WHERE table_name = 'groups' AND constraint_name = 'uq_groups_user_group')"
            ))
            if result.scalar():
                logger.info("[MIGRATE] Constraint uq_groups_user_group já existe, OK.")
                return

            logger.info("[MIGRATE] Migrando tabela groups: recriando com schema correto...")
            # A tabela é nova e deve estar vazia — recria com schema correto
            conn.execute(text("DROP TABLE IF EXISTS group_members CASCADE"))
            conn.execute(text("DROP TABLE IF EXISTS groups CASCADE"))
            conn.commit()
            logger.info("[MIGRATE] Tabelas groups/group_members removidas para recriação.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar tabela groups: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[STARTUP] Iniciando aplicação...")
    db_ok = wait_for_db(retries=5, delay=3)
    if db_ok:
        try:
            migrate_groups_table()
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
app.include_router(grupos.router)
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
