from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from database import engine, Base, get_db
import models  # noqa: F401 – importa para registrar os models

from routes import usuarios, sessoes, contatos, campanhas, pagamentos
from routes.webhook_waha import router as webhook_router
from routes.admin import router as admin_router
from routes.debug import router as debug_router
from config import settings

# Cria tabelas no banco
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    description="API SaaS para disparo de WhatsApp em massa",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
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
