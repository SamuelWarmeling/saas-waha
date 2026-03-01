from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import io
import csv
import openpyxl
from openpyxl import Workbook

import models
import auth
from database import get_db

router = APIRouter(prefix="/api/contatos", tags=["Contatos"])


# ── Schemas ──────────────────────────────────────────────────────────────────
class ContactCreate(BaseModel):
    phone: str
    name: Optional[str] = None
    tags: Optional[str] = None


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    tags: Optional[str] = None
    is_blacklisted: Optional[bool] = None


class ContactOut(BaseModel):
    id: int
    phone: str
    name: Optional[str]
    is_blacklisted: bool
    tags: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ContactListOut(BaseModel):
    total: int
    page: int
    page_size: int
    items: List[ContactOut]


def normalize_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("0"):
        digits = digits[1:]
    if not digits.startswith("55") and len(digits) <= 11:
        digits = "55" + digits
    return digits


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("", response_model=ContactListOut)
def list_contacts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    blacklisted: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.Contact).filter(models.Contact.user_id == current_user.id)

    if search:
        query = query.filter(
            (models.Contact.phone.ilike(f"%{search}%")) |
            (models.Contact.name.ilike(f"%{search}%"))
        )
    if blacklisted is not None:
        query = query.filter(models.Contact.is_blacklisted == blacklisted)

    total = query.count()
    items = query.offset((page - 1) * page_size).limit(page_size).all()

    return ContactListOut(total=total, page=page, page_size=page_size, items=items)


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    data: ContactCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    phone = normalize_phone(data.phone)
    existing = db.query(models.Contact).filter(
        models.Contact.user_id == current_user.id,
        models.Contact.phone == phone,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Contato já cadastrado")

    contact = models.Contact(
        user_id=current_user.id,
        phone=phone,
        name=data.name,
        tags=data.tags,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.get("/{contact_id}", response_model=ContactOut)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contact = db.query(models.Contact).filter(
        models.Contact.id == contact_id,
        models.Contact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")
    return contact


@router.put("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    data: ContactUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contact = db.query(models.Contact).filter(
        models.Contact.id == contact_id,
        models.Contact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")

    if data.name is not None:
        contact.name = data.name
    if data.tags is not None:
        contact.tags = data.tags
    if data.is_blacklisted is not None:
        contact.is_blacklisted = data.is_blacklisted

    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contact = db.query(models.Contact).filter(
        models.Contact.id == contact_id,
        models.Contact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")
    db.delete(contact)
    db.commit()


@router.post("/upload")
async def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Importa contatos via CSV com colunas: nome,telefone (ou telefone,nome)."""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # suporta BOM
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    # Normaliza nomes de colunas: lowercase + strip
    fieldnames = [f.strip().lower() for f in (reader.fieldnames or [])]

    # Aceita "nome,telefone" ou "telefone,nome" ou "name,phone"
    col_phone = next((f for f in fieldnames if f in ("telefone", "phone", "numero", "número")), None)
    col_name  = next((f for f in fieldnames if f in ("nome", "name")), None)

    if col_phone is None:
        raise HTTPException(
            status_code=400,
            detail=f"CSV deve ter coluna 'telefone' ou 'phone'. Colunas encontradas: {fieldnames}"
        )

    imported = skipped = 0
    errors = []

    for row_idx, raw_row in enumerate(reader, start=2):
        # Remap com nomes normalizados
        row = {k.strip().lower(): v for k, v in raw_row.items()}
        phone_raw = (row.get(col_phone) or "").strip()
        name = (row.get(col_name) or "").strip() or None

        if not phone_raw:
            skipped += 1
            continue

        try:
            phone = normalize_phone(phone_raw)
            if len(phone) < 10:
                errors.append(f"Linha {row_idx}: número inválido ({phone_raw})")
                skipped += 1
                continue

            existing = db.query(models.Contact).filter(
                models.Contact.user_id == current_user.id,
                models.Contact.phone == phone,
            ).first()

            if existing:
                skipped += 1
                continue

            db.add(models.Contact(user_id=current_user.id, phone=phone, name=name))
            imported += 1
        except Exception as e:
            errors.append(f"Linha {row_idx}: {e}")
            skipped += 1

    db.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors[:20]}


@router.post("/importar")
async def import_contacts(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Arquivo deve ser .xlsx ou .xls")

    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    imported = 0
    skipped = 0
    errors = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row or not row[0]:
            continue

        phone_raw = str(row[0]).strip()
        name = str(row[1]).strip() if len(row) > 1 and row[1] else None

        try:
            phone = normalize_phone(phone_raw)
            if len(phone) < 10:
                errors.append(f"Linha {row_idx}: número inválido ({phone_raw})")
                skipped += 1
                continue

            existing = db.query(models.Contact).filter(
                models.Contact.user_id == current_user.id,
                models.Contact.phone == phone,
            ).first()

            if existing:
                skipped += 1
                continue

            contact = models.Contact(user_id=current_user.id, phone=phone, name=name)
            db.add(contact)
            imported += 1
        except Exception as e:
            errors.append(f"Linha {row_idx}: {str(e)}")
            skipped += 1

    db.commit()

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors[:20],  # limita erros retornados
    }


@router.get("/exportar/xlsx")
def export_contacts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contacts = db.query(models.Contact).filter(
        models.Contact.user_id == current_user.id
    ).all()

    wb = Workbook()
    ws = wb.active
    ws.title = "Contatos"
    ws.append(["Telefone", "Nome", "Blacklist", "Tags"])

    for c in contacts:
        ws.append([c.phone, c.name or "", "Sim" if c.is_blacklisted else "Não", c.tags or ""])

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=contatos.xlsx"},
    )


@router.post("/{contact_id}/blacklist")
def toggle_blacklist(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    contact = db.query(models.Contact).filter(
        models.Contact.id == contact_id,
        models.Contact.user_id == current_user.id,
    ).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contato não encontrado")

    contact.is_blacklisted = not contact.is_blacklisted
    db.commit()
    return {"phone": contact.phone, "is_blacklisted": contact.is_blacklisted}
