"""
Script: popular phone_number de todas as sessões connected que têm phone NULL.

Execução:
  cd backend
  python populate_phones.py
"""
import asyncio
import httpx
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
from config import settings
import models


def normalize_phone(raw: str) -> str:
    phone = raw.split("@")[0].strip()
    return "".join(c for c in phone if c.isdigit())


async def fetch_phone(session_waha_id: str) -> str | None:
    headers = {}
    if settings.WAHA_API_KEY:
        headers["X-Api-Key"] = settings.WAHA_API_KEY
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"{settings.WAHA_API_URL}/api/{session_waha_id}/me",
                headers=headers,
            )
        if r.status_code == 200:
            data = r.json()
            raw = data.get("id", "") or data.get("phoneNumber", "")
            if raw:
                return normalize_phone(raw) or None
        else:
            print(f"  ⚠️  HTTP {r.status_code} para {session_waha_id}: {r.text[:100]}")
    except Exception as e:
        print(f"  ❌ Erro ao buscar /me para {session_waha_id}: {e}")
    return None


async def main():
    db = SessionLocal()
    try:
        sessoes = (
            db.query(models.WhatsAppSession)
            .filter(models.WhatsAppSession.status == models.SessionStatus.connected)
            .all()
        )

        print(f"\n📋 Total de sessões connected: {len(sessoes)}")
        print(f"{'─'*60}")

        atualizadas = 0
        sem_phone = 0

        for sess in sessoes:
            if sess.phone_number:
                print(f"  ✅ {sess.session_id:30s} já tem phone: {sess.phone_number}")
                continue

            sem_phone += 1
            print(f"  🔍 {sess.session_id:30s} phone=NULL — buscando...")
            phone = await fetch_phone(sess.session_id)

            if phone:
                sess.phone_number = phone
                db.commit()
                atualizadas += 1
                print(f"  🔥 Phone encontrado: {phone} para {sess.session_id}")
            else:
                print(f"  ❌ Não obteve phone para {sess.session_id} (sessão pode estar offline no WAHA)")

        print(f"{'─'*60}")
        print(f"\n✅ Resumo:")
        print(f"   Sessões sem phone (antes): {sem_phone}")
        print(f"   Atualizadas agora:         {atualizadas}")
        print(f"   Ainda sem phone:           {sem_phone - atualizadas}")

    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
