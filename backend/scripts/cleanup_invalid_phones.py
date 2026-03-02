"""
Limpeza de contatos com telefone inválido.

Critérios de validade (mesmo da função is_valid_phone no webhook):
  - Começa com '55'
  - Comprimento exato de 12 ou 13 dígitos

Uso:
  python backend/scripts/cleanup_invalid_phones.py
  # ou apontando para outra DB:
  DATABASE_URL=postgresql://... python backend/scripts/cleanup_invalid_phones.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/saas_waha",
)

engine = create_engine(DATABASE_URL)

VALID_CONDITION = "phone LIKE '55%' AND length(phone) IN (12, 13)"

with engine.connect() as conn:
    # Auditoria antes
    total = conn.execute(text("SELECT count(*) FROM contacts")).scalar()
    invalid = conn.execute(
        text(f"SELECT count(*) FROM contacts WHERE NOT ({VALID_CONDITION})")
    ).scalar()

    print(f"Total de contatos : {total}")
    print(f"Inválidos         : {invalid}")

    if invalid == 0:
        print("Nenhum registro inválido. Nada a fazer.")
        sys.exit(0)

    # Amostra dos que serão removidos
    print("\nAmostra (até 20):")
    rows = conn.execute(
        text(
            f"SELECT id, phone, name FROM contacts "
            f"WHERE NOT ({VALID_CONDITION}) LIMIT 20"
        )
    ).fetchall()
    for r in rows:
        print(f"  id={r[0]:>6}  phone={r[1]!r:<20}  name={r[2]!r}")

    confirm = input(f"\nDeletar {invalid} contato(s) inválido(s)? [s/N] ").strip().lower()
    if confirm != "s":
        print("Cancelado.")
        sys.exit(0)

    result = conn.execute(
        text(f"DELETE FROM contacts WHERE NOT ({VALID_CONDITION})")
    )
    conn.commit()
    print(f"Deletados: {result.rowcount} registro(s).")
