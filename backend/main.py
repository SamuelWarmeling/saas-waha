import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from database import engine, Base, get_db
import models  # noqa: F401 – importa para registrar os models

from routes import usuarios, sessoes, contatos, campanhas, pagamentos, grupos
from routes.listas import router as listas_router
from routes.auth_verificacao import router as auth_verificacao_router
from routes.stripe_webhook import router as stripe_webhook_router
from routes.chips import router as chips_router
from routes.webhook_waha import router as webhook_router
from routes.funnel import router as funnel_router, funnel_worker_task
from routes.aquecimento import router as aquecimento_router, aquecimento_worker_task, status_diario_worker_task
from routes.ia import router as ia_router
from routes.admin import router as admin_router
from routes.debug import router as debug_router
from routes.atividades import router as atividades_router
from routes.dashboard import router as dashboard_router
from workers.reconexao import reconexao_worker_task
from workers.rotacao import rotacao_worker_task
from workers.limpeza import limpeza_worker_task
from workers.reenvio import reenvio_worker_task
from workers.grupos_inativos import grupos_inativos_worker_task
from workers.backup import backup_worker_task
from config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Sentry — inicializa apenas se DSN configurado
if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            SqlalchemyIntegration(),
        ],
        traces_sample_rate=0.2,
        environment="development" if settings.DEBUG else "production",
        send_default_pii=False,
    )
    logger.info("[SENTRY] Monitoramento de erros ativado.")
else:
    logger.info("[SENTRY] SENTRY_DSN não configurado — monitoramento desativado.")


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


def migrate_contacts_unique():
    """
    Garante UniqueConstraint(user_id, phone) na tabela contacts.
    Como o upsert já evita duplicatas em runtime, é seguro criar a constraint.
    """
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.table_constraints "
                "WHERE table_name = 'contacts' AND constraint_name = 'uq_contacts_user_phone')"
            ))
            if result.scalar():
                return  # já existe
            logger.info("[MIGRATE] Criando unique constraint em contacts(user_id, phone)...")
            conn.execute(text(
                "ALTER TABLE contacts "
                "ADD CONSTRAINT uq_contacts_user_phone UNIQUE (user_id, phone)"
            ))
            conn.commit()
            logger.info("[MIGRATE] Constraint uq_contacts_user_phone criada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao criar constraint de contatos: {e}")


def migrate_campaign_contacts_session():
    """Adiciona coluna session_id em campaign_contacts (rastreia qual chip enviou)."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'campaign_contacts' AND column_name = 'session_id')"
            ))
            if result.scalar():
                return
            logger.info("[MIGRATE] Adicionando session_id em campaign_contacts...")
            conn.execute(text(
                "ALTER TABLE campaign_contacts "
                "ADD COLUMN session_id INTEGER REFERENCES whatsapp_sessions(id) ON DELETE SET NULL"
            ))
            conn.commit()
            logger.info("[MIGRATE] Coluna session_id adicionada em campaign_contacts.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar campaign_contacts: {e}")


def migrate_user_dispatch_settings():
    """Adiciona colunas de configuração de disparo na tabela users."""
    try:
        with engine.connect() as conn:
            for col, default in [
                ("dispatch_delay_min", 5),
                ("dispatch_delay_max", 15),
                ("dispatch_daily_limit", 200),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'users' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em users...")
                    conn.execute(text(
                        f"ALTER TABLE users ADD COLUMN {col} INTEGER NOT NULL DEFAULT {default}"
                    ))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em users.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar user dispatch settings: {e}")


def migrate_campaigns_new_columns():
    """Adiciona colunas novas na tabela campaigns que não existiam na versão original."""
    try:
        with engine.connect() as conn:
            # ordem_mensagens (adicionado para suporte a múltiplas mensagens)
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'campaigns' AND column_name = 'ordem_mensagens')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Adicionando ordem_mensagens em campaigns...")
                conn.execute(text(
                    "ALTER TABLE campaigns ADD COLUMN ordem_mensagens VARCHAR(20) NOT NULL DEFAULT 'aleatorio'"
                ))
                conn.commit()
                logger.info("[MIGRATE] Coluna ordem_mensagens adicionada em campaigns.")

            # delay_min / delay_max (caso não existam)
            for col, default in [("delay_min", 5), ("delay_max", 15)]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'campaigns' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em campaigns...")
                    conn.execute(text(
                        f"ALTER TABLE campaigns ADD COLUMN {col} INTEGER NOT NULL DEFAULT {default}"
                    ))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em campaigns.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar colunas de campaigns: {e}")


def migrate_groups_auto_update():
    """Adiciona coluna auto_update_interval na tabela groups."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'groups' AND column_name = 'auto_update_interval')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Adicionando auto_update_interval em groups...")
                conn.execute(text("ALTER TABLE groups ADD COLUMN auto_update_interval INTEGER"))
                conn.commit()
                logger.info("[MIGRATE] Coluna auto_update_interval adicionada em groups.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar groups auto_update_interval: {e}")


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


def migrate_campaign_scheduled():
    """Adiciona 'scheduled' ao enum campaignstatus e coluna scheduled_at em campaigns."""
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TYPE campaignstatus ADD VALUE IF NOT EXISTS 'scheduled'"))
            conn.commit()
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'campaigns' AND column_name = 'scheduled_at')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Adicionando scheduled_at em campaigns...")
                conn.execute(text("ALTER TABLE campaigns ADD COLUMN scheduled_at TIMESTAMP WITH TIME ZONE"))
                conn.commit()
                logger.info("[MIGRATE] Coluna scheduled_at adicionada em campaigns.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar campaign scheduled: {e}")


def migrate_campaign_contact_ack():
    """Adiciona delivered_at, read_at e waha_message_id em campaign_contacts."""
    try:
        with engine.connect() as conn:
            for col, dtype in [
                ("delivered_at", "TIMESTAMP WITH TIME ZONE"),
                ("read_at", "TIMESTAMP WITH TIME ZONE"),
                ("waha_message_id", "VARCHAR(100)"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'campaign_contacts' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em campaign_contacts...")
                    conn.execute(text(f"ALTER TABLE campaign_contacts ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em campaign_contacts.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar campaign_contacts ack: {e}")


def migrate_ia_user_columns():
    """Adiciona colunas de IA no modelo User e usar_ia em aquecimento_configs."""
    try:
        with engine.connect() as conn:
            for table, col, dtype, default in [
                ("users", "gemini_api_key", "VARCHAR(200)", "NULL"),
                ("users", "gemini_habilitado", "BOOLEAN NOT NULL", "DEFAULT TRUE"),
                ("aquecimento_configs", "usar_ia", "BOOLEAN NOT NULL", "DEFAULT TRUE"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    default_clause = f"{default}" if default != "NULL" else ""
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype} {default_clause}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em {table}.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar colunas de IA: {e}")


def migrate_pos_aquecimento():
    """Adiciona is_aquecido, manutencao_ativa e enum manutencao."""
    try:
        with engine.connect() as conn:
            # Adiciona valor 'manutencao' ao enum
            conn.execute(text("ALTER TYPE aquecimentostatus ADD VALUE IF NOT EXISTS 'manutencao'"))
            conn.commit()
            # Adiciona colunas
            for table, col, dtype, default in [
                ("whatsapp_sessions", "is_aquecido", "BOOLEAN NOT NULL", "DEFAULT FALSE"),
                ("aquecimento_configs", "manutencao_ativa", "BOOLEAN NOT NULL", "DEFAULT TRUE"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype} {default}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_pos_aquecimento: {e}")


def migrate_chip_health_logs():
    """Cria tabela chip_health_logs para detecção precoce de ban por sinais ACK."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'chip_health_logs')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela chip_health_logs...")
                conn.execute(text("""
                    CREATE TABLE chip_health_logs (
                        id SERIAL PRIMARY KEY,
                        session_id INTEGER NOT NULL
                            REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
                        ack INTEGER NOT NULL,
                        criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.execute(text(
                    "CREATE INDEX ix_chip_health_logs_session_id ON chip_health_logs (session_id)"
                ))
                conn.execute(text(
                    "CREATE INDEX ix_chip_health_logs_criado_em ON chip_health_logs (criado_em)"
                ))
                conn.commit()
                logger.info("[MIGRATE] Tabela chip_health_logs criada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_chip_health_logs: {e}")


def migrate_stripe_columns():
    """Adiciona colunas do Stripe e trial na tabela users."""
    try:
        with engine.connect() as conn:
            for col, dtype, default in [
                ("stripe_customer_id", "VARCHAR(100)", "NULL"),
                ("stripe_subscription_id", "VARCHAR(100)", "NULL"),
                ("trial_ativo", "BOOLEAN NOT NULL", "DEFAULT FALSE"),
                ("trial_expira_em", "TIMESTAMP WITH TIME ZONE", "NULL"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'users' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em users...")
                    default_clause = f"DEFAULT {default.replace('DEFAULT ', '')}" if default != "NULL" else ""
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {dtype} {default_clause}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em users.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_stripe_columns: {e}")


def migrate_anti_abuso():
    """Cria tabelas e colunas do sistema anti-abuso de trial."""
    try:
        with engine.connect() as conn:
            # Coluna cpf em users
            for col, dtype, default in [
                ("cpf", "VARCHAR(11)", "NULL"),
                ("email_verificado", "BOOLEAN NOT NULL", "DEFAULT FALSE"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'users' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em users...")
                    default_clause = f"DEFAULT {default.replace('DEFAULT ', '')}" if default != "NULL" else ""
                    conn.execute(text(f"ALTER TABLE users ADD COLUMN {col} {dtype} {default_clause}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em users.")

            # Unique index em cpf (nullable, então UNIQUE parcial ou apenas unique constraint)
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'users' AND indexname = 'ix_users_cpf')"
            ))
            if not result.scalar():
                conn.execute(text(
                    "CREATE UNIQUE INDEX ix_users_cpf ON users (cpf) WHERE cpf IS NOT NULL"
                ))
                conn.commit()
                logger.info("[MIGRATE] Índice único ix_users_cpf criado.")

            # Tabela email_verificacoes
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_verificacoes')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela email_verificacoes...")
                conn.execute(text("""
                    CREATE TABLE email_verificacoes (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        codigo VARCHAR(6) NOT NULL,
                        expira_em TIMESTAMP WITH TIME ZONE NOT NULL,
                        tentativas INTEGER NOT NULL DEFAULT 0,
                        criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.execute(text(
                    "CREATE INDEX ix_email_verificacoes_user_id ON email_verificacoes (user_id)"
                ))
                conn.commit()
                logger.info("[MIGRATE] Tabela email_verificacoes criada.")

            # Tabela cadastro_ips
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cadastro_ips')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela cadastro_ips...")
                conn.execute(text("""
                    CREATE TABLE cadastro_ips (
                        id SERIAL PRIMARY KEY,
                        ip VARCHAR(45) NOT NULL,
                        data VARCHAR(10) NOT NULL,
                        contagem INTEGER NOT NULL DEFAULT 1,
                        CONSTRAINT uq_cadastro_ip_data UNIQUE (ip, data)
                    )
                """))
                conn.execute(text("CREATE INDEX ix_cadastro_ips_ip ON cadastro_ips (ip)"))
                conn.commit()
                logger.info("[MIGRATE] Tabela cadastro_ips criada.")

            # Tabela ips_banidos
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ips_banidos')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela ips_banidos...")
                conn.execute(text("""
                    CREATE TABLE ips_banidos (
                        id SERIAL PRIMARY KEY,
                        ip VARCHAR(45) NOT NULL UNIQUE,
                        motivo VARCHAR(255),
                        banido_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                        banido_por INTEGER REFERENCES users(id) ON DELETE SET NULL
                    )
                """))
                conn.execute(text("CREATE INDEX ix_ips_banidos_ip ON ips_banidos (ip)"))
                conn.commit()
                logger.info("[MIGRATE] Tabela ips_banidos criada.")

            # Tabela tentativas_suspeitas
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tentativas_suspeitas')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela tentativas_suspeitas...")
                conn.execute(text("""
                    CREATE TABLE tentativas_suspeitas (
                        id SERIAL PRIMARY KEY,
                        ip VARCHAR(45),
                        tipo VARCHAR(30) NOT NULL,
                        detalhe VARCHAR(500),
                        criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.execute(text("CREATE INDEX ix_tentativas_suspeitas_ip ON tentativas_suspeitas (ip)"))
                conn.execute(text("CREATE INDEX ix_tentativas_suspeitas_criado_em ON tentativas_suspeitas (criado_em)"))
                conn.commit()
                logger.info("[MIGRATE] Tabela tentativas_suspeitas criada.")

    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_anti_abuso: {e}")


def migrate_listas():
    """Cria tabelas listas e contato_listas para o sistema de listas de contatos."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'listas')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela listas...")
                conn.execute(text("""
                    CREATE TABLE listas (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        nome VARCHAR(100) NOT NULL,
                        cor VARCHAR(20) NOT NULL DEFAULT '#7c3aed',
                        criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.execute(text("CREATE INDEX ix_listas_user_id ON listas (user_id)"))
                conn.commit()
                logger.info("[MIGRATE] Tabela listas criada.")

            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'contato_listas')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela contato_listas...")
                conn.execute(text("""
                    CREATE TABLE contato_listas (
                        id SERIAL PRIMARY KEY,
                        contato_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
                        lista_id INTEGER NOT NULL REFERENCES listas(id) ON DELETE CASCADE,
                        adicionado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                        CONSTRAINT uq_contato_lista UNIQUE (contato_id, lista_id)
                    )
                """))
                conn.execute(text("CREATE INDEX ix_contato_listas_lista_id ON contato_listas (lista_id)"))
                conn.execute(text("CREATE INDEX ix_contato_listas_contato_id ON contato_listas (contato_id)"))
                conn.commit()
                logger.info("[MIGRATE] Tabela contato_listas criada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_listas: {e}")


def migrate_dispatch_slots():
    """Adiciona chips_disparo_simultaneo em users e 'queued' ao enum campaignstatus."""
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TYPE campaignstatus ADD VALUE IF NOT EXISTS 'queued'"))
            conn.commit()
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'users' AND column_name = 'chips_disparo_simultaneo')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Adicionando chips_disparo_simultaneo em users...")
                conn.execute(text(
                    "ALTER TABLE users ADD COLUMN chips_disparo_simultaneo INTEGER NOT NULL DEFAULT 3"
                ))
                conn.commit()
                logger.info("[MIGRATE] Coluna chips_disparo_simultaneo adicionada em users.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_dispatch_slots: {e}")


def migrate_contact_scoring():
    """Adiciona colunas de scoring via grupos em comum na tabela contacts."""
    cols = [
        ("whatsapp_common_groups", "INTEGER"),
        ("group_score", "INTEGER"),
        ("score_calculado_em", "TIMESTAMP WITH TIME ZONE"),
    ]
    try:
        with engine.connect() as conn:
            for col, dtype in cols:
                r = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'contacts' AND column_name = '{col}')"
                ))
                if not r.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em contacts...")
                    conn.execute(text(f"ALTER TABLE contacts ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em contacts.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_contact_scoring: {e}")


def migrate_whatsapp_session_antiban():
    """Adiciona pausado_manualmente e ultima_atividade em whatsapp_sessions."""
    try:
        with engine.connect() as conn:
            for col, dtype, notnull_default in [
                ("pausado_manualmente", "BOOLEAN", "NOT NULL DEFAULT false"),
                ("ultima_atividade",    "TIMESTAMP WITH TIME ZONE", ""),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'whatsapp_sessions' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em whatsapp_sessions...")
                    conn.execute(text(
                        f"ALTER TABLE whatsapp_sessions ADD COLUMN {col} {dtype} {notnull_default}"
                    ))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em whatsapp_sessions.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_whatsapp_session_antiban: {e}")


def migrate_ban_learning():
    """Cria tabelas ban_records e fuzzy_configs para aprendizado coletivo de bans."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'ban_records')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela ban_records...")
                conn.execute(text("""
                    CREATE TABLE ban_records (
                        id SERIAL PRIMARY KEY,
                        session_id INTEGER REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
                        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        tipo_chip VARCHAR(10),
                        liquidez_momento FLOAT,
                        valor_esperado_momento FLOAT,
                        risco_momento FLOAT,
                        score_momento FLOAT,
                        action_momento VARCHAR(10),
                        msgs_enviadas_hoje INTEGER,
                        dias_de_vida INTEGER,
                        criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.execute(text(
                    "CREATE INDEX ix_ban_records_user_id ON ban_records (user_id)"
                ))
                conn.commit()
                logger.info("[MIGRATE] Tabela ban_records criada.")

            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'fuzzy_configs')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Criando tabela fuzzy_configs...")
                conn.execute(text("""
                    CREATE TABLE fuzzy_configs (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                        high_threshold FLOAT NOT NULL DEFAULT 70.0,
                        med_threshold FLOAT NOT NULL DEFAULT 40.0,
                        peso_risco FLOAT NOT NULL DEFAULT 0.0,
                        total_bans_calibracao INTEGER NOT NULL DEFAULT 0,
                        atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
                conn.commit()
                logger.info("[MIGRATE] Tabela fuzzy_configs criada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_ban_learning: {e}")


def migrate_adaptacao():
    """Adiciona is_veterano, em_adaptacao em whatsapp_sessions e origem_chip em aquecimento_configs."""
    try:
        with engine.connect() as conn:
            for table, col, dtype, default in [
                ("whatsapp_sessions", "is_veterano", "BOOLEAN NOT NULL", "DEFAULT FALSE"),
                ("whatsapp_sessions", "em_adaptacao", "BOOLEAN NOT NULL", "DEFAULT FALSE"),
                ("aquecimento_configs", "origem_chip", "VARCHAR(20) NOT NULL", "DEFAULT 'novo'"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype} {default}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_adaptacao: {e}")


def migrate_chip_virtual():
    """Adiciona tipo_chip em whatsapp_sessions e contadores de resposta em aquecimento_configs."""
    try:
        with engine.connect() as conn:
            for table, col, dtype, default in [
                ("whatsapp_sessions", "tipo_chip", "VARCHAR(10) NOT NULL", "DEFAULT 'fisico'"),
                ("aquecimento_configs", "msgs_recebidas", "INTEGER NOT NULL", "DEFAULT 0"),
                ("aquecimento_configs", "respostas_enviadas", "INTEGER NOT NULL", "DEFAULT 0"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype} {default}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em {table}.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar chip virtual: {e}")


def migrate_automacoes():
    """Adiciona colunas para as 6 automações em background."""
    cols = [
        # WhatsAppSession
        ("whatsapp_sessions", "reconexao_tentativas", "INTEGER NOT NULL DEFAULT 0"),
        ("whatsapp_sessions", "reconexao_ultima_em", "TIMESTAMP WITH TIME ZONE"),
        # CampaignContact
        ("campaign_contacts", "retry_count", "INTEGER NOT NULL DEFAULT 0"),
        ("campaign_contacts", "retry_at", "TIMESTAMP WITH TIME ZONE"),
        # Contact
        ("contacts", "is_invalid", "BOOLEAN NOT NULL DEFAULT FALSE"),
        # Group
        ("groups", "arquivado", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ]
    try:
        with engine.connect() as conn:
            for table, col, dtype in cols:
                r = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not r.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em {table}.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_automacoes: {e}")


def migrate_email_verificacao_tipo():
    """Adiciona coluna tipo em email_verificacoes para diferenciar verificação de cadastro e reset de senha."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'email_verificacoes' AND column_name = 'tipo')"
            ))
            if not result.scalar():
                logger.info("[MIGRATE] Adicionando tipo em email_verificacoes...")
                conn.execute(text(
                    "ALTER TABLE email_verificacoes ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'verificacao'"
                ))
                conn.commit()
                logger.info("[MIGRATE] Coluna tipo adicionada em email_verificacoes.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_email_verificacao_tipo: {e}")


def migrate_status_diario():
    """Adiciona colunas de status diário ao aquecimento_configs."""
    cols = [
        ("aquecimento_configs", "ultimo_status_texto", "VARCHAR(200)"),
        ("aquecimento_configs", "ultimo_status_em", "TIMESTAMP WITH TIME ZONE"),
    ]
    try:
        with engine.connect() as conn:
            for table, col, dtype in cols:
                r = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = '{table}' AND column_name = '{col}')"
                ))
                if not r.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em {table}...")
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em {table}.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_status_diario: {e}")


def migrate_alertas():
    """Cria tabela alertas para o sistema de notificações em tempo real (usa IF NOT EXISTS)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS alertas (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    tipo VARCHAR(50) NOT NULL,
                    mensagem VARCHAR(500) NOT NULL,
                    lido BOOLEAN NOT NULL DEFAULT FALSE,
                    criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_alertas_user_id ON alertas (user_id)"
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_alertas_lido ON alertas (lido)"
            ))
            conn.commit()
            logger.info("[MIGRATE] Tabela alertas verificada/criada.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_alertas: {e}")


def migrate_system_chips():
    """Adiciona colunas de chips do sistema em whatsapp_sessions e usar_chips_sistema em campaigns.
    Usa ADD COLUMN IF NOT EXISTS (atômico no PostgreSQL ≥9.6) para evitar falhas por race condition."""
    cols = [
        ("whatsapp_sessions", "is_system", "BOOLEAN NOT NULL DEFAULT FALSE"),
        ("whatsapp_sessions", "system_disponivel", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ("whatsapp_sessions", "system_max_msgs_dia", "INTEGER NOT NULL DEFAULT 200"),
        ("whatsapp_sessions", "system_msgs_hoje", "INTEGER NOT NULL DEFAULT 0"),
        ("campaigns", "usar_chips_sistema", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ]
    try:
        with engine.connect() as conn:
            for table, col, dtype in cols:
                try:
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {dtype}"
                    ))
                    conn.commit()
                except Exception as col_err:
                    conn.rollback()
                    logger.warning(f"[MIGRATE] Aviso ao adicionar {col} em {table}: {col_err}")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_system_chips: {e}")


def migrate_campaign_sessions_table():
    """Garante que a tabela campaign_sessions existe (caso create_all tenha falhado)."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS campaign_sessions (
                    id SERIAL PRIMARY KEY,
                    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
                    session_id INTEGER NOT NULL REFERENCES whatsapp_sessions(id) ON DELETE CASCADE
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_campaign_sessions_campaign_id ON campaign_sessions (campaign_id)"
            ))
            conn.commit()
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_campaign_sessions_table: {e}")


def migrate_group_incremental():
    """Adiciona colunas para extração incremental de grupos."""
    try:
        with engine.connect() as conn:
            # GroupMember.status
            r = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'group_members' AND column_name = 'status')"
            ))
            if not r.scalar():
                logger.info("[MIGRATE] Adicionando status em group_members...")
                conn.execute(text(
                    "ALTER TABLE group_members ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'ativo'"
                ))
                conn.commit()
                logger.info("[MIGRATE] Coluna status adicionada em group_members.")

            # Group.last_extraction_result
            r = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'groups' AND column_name = 'last_extraction_result')"
            ))
            if not r.scalar():
                logger.info("[MIGRATE] Adicionando last_extraction_result em groups...")
                conn.execute(text("ALTER TABLE groups ADD COLUMN last_extraction_result TEXT"))
                conn.commit()
                logger.info("[MIGRATE] Coluna last_extraction_result adicionada em groups.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro em migrate_group_incremental: {e}")


def migrate_aquecimento_tables():
    """Cria o enum aquecimentostatus e tabelas de aquecimento se não existirem."""
    try:
        with engine.connect() as conn:
            exists = conn.execute(text(
                "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aquecimentostatus')"
            )).scalar()
            if not exists:
                conn.execute(text(
                    "CREATE TYPE aquecimentostatus AS ENUM ('ativo', 'pausado', 'concluido', 'cancelado')"
                ))
                conn.commit()
                logger.info("[MIGRATE] Enum aquecimentostatus criado.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao criar enum aquecimentostatus: {e}")


def migrate_funnel_tables():
    """Cria tabelas do funil de leads se não existirem (via SQL direto para evitar conflito de enums)."""
    try:
        with engine.connect() as conn:
            # Cria enums se não existirem
            for enum_name, values in [
                ("funnelsequenciastatus", ("ativo", "pausado")),
                ("funnelcontatostatus", ("ativo", "respondeu", "concluido", "cancelado")),
                ("funneltemperatura", ("frio", "morno", "quente", "convertido")),
                ("funnelmensagemtipo", ("texto", "imagem", "audio")),
            ]:
                exists = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{enum_name}')"
                )).scalar()
                if not exists:
                    vals = ", ".join(f"'{v}'" for v in values)
                    conn.execute(text(f"CREATE TYPE {enum_name} AS ENUM ({vals})"))
                    conn.commit()
                    logger.info(f"[MIGRATE] Enum {enum_name} criado.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao criar enums do funil: {e}")


def migrate_campaign_message_media():
    """Adiciona tipo, media_url, media_filename, botoes em campaign_messages."""
    try:
        with engine.connect() as conn:
            for col, dtype, default in [
                ("tipo", "VARCHAR(20)", "'text'"),
                ("media_url", "VARCHAR(1000)", "NULL"),
                ("media_filename", "VARCHAR(255)", "NULL"),
                ("botoes", "TEXT", "NULL"),
            ]:
                result = conn.execute(text(
                    f"SELECT EXISTS (SELECT 1 FROM information_schema.columns "
                    f"WHERE table_name = 'campaign_messages' AND column_name = '{col}')"
                ))
                if not result.scalar():
                    logger.info(f"[MIGRATE] Adicionando {col} em campaign_messages...")
                    default_clause = f"DEFAULT {default}" if default != "NULL" else ""
                    conn.execute(text(
                        f"ALTER TABLE campaign_messages ADD COLUMN {col} {dtype} {default_clause}"
                    ))
                    conn.commit()
                    logger.info(f"[MIGRATE] Coluna {col} adicionada em campaign_messages.")
    except Exception as e:
        logger.error(f"[MIGRATE] Erro ao migrar campaign_messages media: {e}")


async def _run_scheduled_campaigns():
    """Verifica campanhas agendadas cujo scheduled_at já passou e as inicia."""
    from routes.campanhas import send_campaign
    db_gen = get_db()
    db = next(db_gen)
    try:
        now = datetime.now(timezone.utc)
        scheduled = db.query(models.Campaign).filter(
            models.Campaign.status == models.CampaignStatus.scheduled,
            models.Campaign.scheduled_at <= now,
        ).all()
        for campaign in scheduled:
            try:
                logger.info(f"[AGENDAMENTO] Iniciando campanha agendada #{campaign.id} '{campaign.name}'")
                asyncio.create_task(send_campaign(campaign.id, campaign.user_id))
            except Exception as e:
                logger.error(f"[AGENDAMENTO] Erro ao iniciar campanha #{campaign.id}: {e}")
    except Exception as e:
        logger.error(f"[AGENDAMENTO] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def scheduled_campaigns_task():
    """Background task que verifica campanhas agendadas a cada 60 segundos."""
    logger.info("[AGENDAMENTO] Background task iniciada.")
    while True:
        try:
            await asyncio.sleep(60)
            await _run_scheduled_campaigns()
        except asyncio.CancelledError:
            logger.info("[AGENDAMENTO] Background task cancelada.")
            break
        except Exception as e:
            logger.error(f"[AGENDAMENTO] Erro inesperado: {e}")


async def _run_auto_updates():
    """Verifica grupos com auto_update ativo e re-extrai se o intervalo passou."""
    from grupo_extraction import extract_selected_groups
    db_gen = get_db()
    db = next(db_gen)
    try:
        now = datetime.now(timezone.utc)
        groups = db.query(models.Group).filter(
            models.Group.auto_update_interval.isnot(None),
            models.Group.auto_update_interval > 0,
        ).all()

        for group in groups:
            try:
                last = group.last_extracted_at
                if last is not None and last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                interval = timedelta(hours=group.auto_update_interval)
                if last is None or (now - last) >= interval:
                    session = db.query(models.WhatsAppSession).filter(
                        models.WhatsAppSession.id == group.session_id
                    ).first()
                    if not session:
                        continue
                    result = await extract_selected_groups(
                        group.session_id,
                        session.session_id,
                        group.user_id,
                        [group.group_id_waha],
                        db,
                    )
                    db.add(models.AtividadeLog(
                        user_id=group.user_id,
                        tipo="grupo_auto_atualizado",
                        descricao=(
                            f"Auto-atualização do grupo '{group.name}': "
                            f"{result['extracted_members']} novos membros encontrados"
                        ),
                    ))
                    db.commit()
                    logger.info(
                        f"[AUTO-UPDATE] Grupo '{group.name}' atualizado: "
                        f"{result['extracted_members']} membros"
                    )
            except Exception as e:
                logger.error(f"[AUTO-UPDATE] Erro ao atualizar grupo {group.id}: {e}")
    except Exception as e:
        logger.error(f"[AUTO-UPDATE] Erro geral: {e}")
    finally:
        try:
            db_gen.close()
        except Exception:
            pass


async def auto_update_groups_task():
    """Background task que roda a cada hora verificando grupos com auto_update ativo."""
    logger.info("[AUTO-UPDATE] Background task iniciada.")
    while True:
        try:
            await asyncio.sleep(3600)  # 1 hora
            logger.info("[AUTO-UPDATE] Rodando verificação de grupos...")
            await _run_auto_updates()
        except asyncio.CancelledError:
            logger.info("[AUTO-UPDATE] Background task cancelada.")
            break
        except Exception as e:
            logger.error(f"[AUTO-UPDATE] Erro inesperado: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[STARTUP] Iniciando aplicação...")
    db_ok = wait_for_db(retries=5, delay=3)
    # Criar pasta de uploads
    uploads_dir = Path("uploads")
    uploads_dir.mkdir(exist_ok=True)

    if db_ok:
        try:
            migrate_contacts_unique()
            migrate_campaign_contacts_session()
            migrate_campaigns_new_columns()
            migrate_user_dispatch_settings()
            migrate_groups_table()
            migrate_groups_auto_update()
            migrate_campaign_scheduled()
            migrate_campaign_contact_ack()
            migrate_campaign_message_media()
            migrate_ia_user_columns()
            migrate_aquecimento_tables()
            migrate_funnel_tables()
            migrate_chip_virtual()
            migrate_pos_aquecimento()
            migrate_adaptacao()
            migrate_chip_health_logs()
            migrate_ban_learning()
            migrate_dispatch_slots()
            migrate_listas()
            migrate_anti_abuso()
            migrate_stripe_columns()
            migrate_automacoes()
            migrate_group_incremental()
            migrate_email_verificacao_tipo()
            migrate_status_diario()
            migrate_system_chips()
            migrate_campaign_sessions_table()
            migrate_alertas()
            migrate_whatsapp_session_antiban()
            migrate_contact_scoring()
            logger.info("[STARTUP] Criando tabelas no banco se não existirem...")
            Base.metadata.create_all(bind=engine)
            logger.info("[STARTUP] Tabelas verificadas/criadas com sucesso.")
            # Carrega thresholds fuzzy salvos no banco para o cache em memória
            try:
                from fuzzy_chip import carregar_config_fuzzy
                db_gen = get_db()
                _db = next(db_gen)
                try:
                    carregar_config_fuzzy(_db)
                finally:
                    try:
                        db_gen.close()
                    except Exception:
                        pass
            except Exception as _e:
                logger.warning(f"[STARTUP] Erro ao carregar config fuzzy: {_e}")
        except Exception as e:
            logger.error(f"[STARTUP] Erro ao criar tabelas: {e}")
    else:
        logger.warning("[STARTUP] Pulando create_all — banco indisponível no momento do startup.")
    logger.info("[STARTUP] Aplicação pronta para receber requisições.")
    task_auto = asyncio.create_task(auto_update_groups_task())
    task_sched = asyncio.create_task(scheduled_campaigns_task())
    task_funnel = asyncio.create_task(funnel_worker_task())
    task_aquec = asyncio.create_task(aquecimento_worker_task())
    task_status = asyncio.create_task(status_diario_worker_task())
    task_reconexao = asyncio.create_task(reconexao_worker_task())
    task_rotacao = asyncio.create_task(rotacao_worker_task())
    task_limpeza = asyncio.create_task(limpeza_worker_task())
    task_reenvio = asyncio.create_task(reenvio_worker_task())
    task_grupos_inativos = asyncio.create_task(grupos_inativos_worker_task())
    task_backup = asyncio.create_task(backup_worker_task())
    yield
    for t in (
        task_auto, task_sched, task_funnel, task_aquec, task_status,
        task_reconexao, task_rotacao, task_limpeza,
        task_reenvio, task_grupos_inativos, task_backup,
    ):
        t.cancel()
    for t in (
        task_auto, task_sched, task_funnel, task_aquec, task_status,
        task_reconexao, task_rotacao, task_limpeza,
        task_reenvio, task_grupos_inativos, task_backup,
    ):
        try:
            await t
        except asyncio.CancelledError:
            pass
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
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
app.include_router(webhook_router, prefix="/api/webhook")
app.include_router(admin_router, prefix="/api/admin")
app.include_router(debug_router)
app.include_router(atividades_router)
app.include_router(dashboard_router)
app.include_router(funnel_router)
app.include_router(aquecimento_router)
app.include_router(ia_router)
app.include_router(chips_router)
app.include_router(listas_router)
app.include_router(auth_verificacao_router)
app.include_router(stripe_webhook_router)
from routes.antiban import router as antiban_router
app.include_router(antiban_router)
from routes.alertas import router as alertas_router
app.include_router(alertas_router)


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
