"""
Script: popular phone_number de todas as sessões connected.

Usa psycopg2 direto (sem SQLAlchemy) para evitar erros de colunas novas.
Busca phones via GET /api/sessions do WAHA (retorna me.id em uma chamada só).

Execução no servidor:
  cd backend
  python scripts/popular_phones.py

  # Ou com DATABASE_URL customizada:
  DATABASE_URL=postgresql://user:pass@host/db python scripts/popular_phones.py
"""
import asyncio
import os
import sys
import httpx
import psycopg2
from urllib.parse import urlparse

# ── Config via env (ou .env) ──────────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    try:
        from config import settings
        DATABASE_URL = settings.DATABASE_URL
    except Exception:
        DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/saas_waha"

WAHA_API_URL = os.getenv("WAHA_API_URL", "https://waha-waha.xeramr.easypanel.host")
WAHA_API_KEY = os.getenv("WAHA_API_KEY", "wARM31Ngadmin")


def normalize_phone(raw: str) -> str:
    phone = raw.split("@")[0].strip()
    return "".join(c for c in phone if c.isdigit())


def connect_db():
    """Conecta ao banco usando psycopg2 direto (sem SQLAlchemy)."""
    p = urlparse(DATABASE_URL)
    return psycopg2.connect(
        host=p.hostname,
        port=p.port or 5432,
        dbname=p.path.lstrip("/"),
        user=p.username,
        password=p.password,
    )


async def get_waha_sessions() -> dict[str, str]:
    """Retorna {session_name: phone_number} para todas as sessões WAHA."""
    headers = {"X-Api-Key": WAHA_API_KEY} if WAHA_API_KEY else {}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{WAHA_API_URL}/api/sessions", headers=headers)
        r.raise_for_status()
        sessions = r.json()

    result = {}
    for s in sessions:
        name = s.get("name", "")
        me = s.get("me") or {}
        raw = me.get("id", "") or me.get("phoneNumber", "")
        if name and raw:
            phone = normalize_phone(raw)
            if phone:
                result[name] = phone
    return result


async def main():
    print(f"\n🔍 Buscando sessões no WAHA: {WAHA_API_URL}")
    waha_phones = await get_waha_sessions()
    print(f"   WAHA retornou {len(waha_phones)} sessões com phone:")
    for name, phone in waha_phones.items():
        print(f"   • {name:30s} → {phone}")

    print(f"\n🗄️  Conectando ao banco: {DATABASE_URL}")
    conn = connect_db()
    cur = conn.cursor()

    # Busca todas as sessões do banco (apenas id, session_id, phone_number, status)
    cur.execute(
        "SELECT id, session_id, phone_number, status FROM whatsapp_sessions"
    )
    rows = cur.fetchall()
    print(f"\n📋 Total de sessões no banco: {len(rows)}")
    print(f"{'─'*65}")

    atualizadas = 0
    sem_phone_banco = 0

    for (sess_id, session_id, phone_number, status) in rows:
        if phone_number:
            print(f"  ✅ {session_id:30s} já tem phone: {phone_number}")
            continue

        sem_phone_banco += 1
        waha_phone = waha_phones.get(session_id)

        if waha_phone:
            cur.execute(
                "UPDATE whatsapp_sessions SET phone_number = %s WHERE id = %s",
                (waha_phone, sess_id),
            )
            conn.commit()
            atualizadas += 1
            print(f"  🔥 {session_id:30s} → phone salvo: {waha_phone}  (status={status})")
        else:
            print(f"  ❌ {session_id:30s} não encontrado no WAHA  (status={status})")

    cur.close()
    conn.close()

    print(f"{'─'*65}")
    print(f"\n✅ Resumo:")
    print(f"   Sessões sem phone (antes): {sem_phone_banco}")
    print(f"   Atualizadas agora:         {atualizadas}")
    print(f"   Ainda sem phone:           {sem_phone_banco - atualizadas}")


if __name__ == "__main__":
    asyncio.run(main())
