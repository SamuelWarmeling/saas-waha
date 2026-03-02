# 🧪 Testes - Sistema de Extração de Grupos

## ✅ Testes Manuais (Passo a Passo)

### 1️⃣ Teste de Banco de Dados

**Objetivo**: Verificar se as tabelas foram criadas corretamente

```bash
# Conectar ao banco
psql "${DATABASE_URL}"

# Listar tabelas
\dt groups
\dt group_members

# Esperado:
# group_members  | table | postgres
# groups         | table | postgres

# Verificar estrutura da tabela groups
\d groups

# Esperado: Colunas
# id              | integer
# user_id         | integer
# session_id      | integer
# group_id_waha   | character varying
# name            | character varying
# subject         | character varying
# member_count    | integer
# is_active       | boolean
# created_at      | timestamp
# last_extracted_at | timestamp

# Verificar se há índices
SELECT * FROM pg_indexes WHERE tablename IN ('groups', 'group_members');

# Esperado: índices em user_id, session_id
```

---

### 2️⃣ Teste da API - Listar Grupos

**Objetivo**: Verificar se endpoint retorna grupos

```bash
# Obter token (fazer login primeiro)
TOKEN="seu_token_aqui"
SESSION_ID=1

# Fazer requisição
curl -X GET "http://localhost:8000/api/grupos?session_id=${SESSION_ID" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq .

# Esperado: JSON com estrutura
# {
#   "total": 0,
#   "page": 1,
#   "page_size": 20,
#   "items": []
# }

# Se houver grupos (após conectar sessão):
# {
#   "total": 5,
#   "page": 1,
#   "page_size": 20,
#   "items": [
#     {
#       "id": 1,
#       "name": "Meu Grupo",
#       "subject": "...",
#       "member_count": 10,
#       ...
#     }
#   ]
# }
```

---

### 3️⃣ Teste de Webhook - Simular Conexão

**Objetivo**: Disparar manual simular evento de conexão

```bash
# Simular webhook de conexão
curl -X POST "http://localhost:8000/api/webhook/waha" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "session.status",
    "session": "u1_01",
    "payload": {
      "status": "CONNECTED",
      "me": {
        "id": "5511999999999@c.us"
      }
    }
  }'

# Esperado: { "ok": true }

# Verificar logs
grep "session u1_01 conectou" backend.log

# Esperado:
# [WEBHOOK] Sessão u1_01 conectou! Iniciando extração de grupos...
# [GRUPOS] Iniciando extração para sessão...
```

---

### 4️⃣ Teste de Modelo - Verificar Models

**Objetivo**: Garantir que os modelos estão importáveis

```python
# No terminal Python
python
```

```python
from models import Group, GroupMember
from sqlalchemy import inspect

# Verificar colunas do modelo
mapper = inspect(Group)
for column in mapper.columns:
    print(f"{column.name}: {column.type}")

# Esperado: listagem de todas as colunas

# Verificar relacionamentos
print(Group.session)  # Deve ter relacionamento com WhatsAppSession
print(Group.members)  # Deve ter relacionamento com GroupMember
```

---

### 5️⃣ Teste de Função - Extração Simulada

**Objetivo**: Testar a função de extração sem WAHA real

```python
import asyncio
from grupo_extraction import normalize_phone, is_valid_phone

# Teste 1: normalize_phone
phone = normalize_phone("5511999999999@c.us")
assert phone == "5511999999999", f"Erro: {phone}"
print("✅ normalize_phone funciona")

# Teste 2: is_valid_phone
assert is_valid_phone("5511999999999") == True
assert is_valid_phone("123") == False  # muito curto
print("✅ is_valid_phone funciona")

# Teste 3: Verificar se função é assíncrona
from inspect import iscoroutinefunction
from grupo_extraction import extract_groups_for_session
assert iscoroutinefunction(extract_groups_for_session)
print("✅ extract_groups_for_session é assíncrona")
```

---

### 6️⃣ Teste Frontend - Interface

**Objetivo**: Verificar se página de grupos carrega

**Passos:**
1. Acesse `http://localhost:5173/grupos`
2. Você deveria ver:
   - [ ] Título "Grupos do WhatsApp"
   - [ ] Dropdown para selecionar sessão
   - [ ] Botão "Forçar Extração de Grupos"
   - [ ] Tabela vazia (antes de conectar)

3. Selecione uma sessão conectada
4. Você deveria ver:
   - [ ] Lista de grupos com nomes
   - [ ] Contadores de membros
   - [ ] Data de última extração
   - [ ] Botões de ação (Ver Membros, Deletar)

---

## 🤖 Testes Automatizados (Python)

### Script de Teste Completo

Crie arquivo `test_grupos.py`:

```python
"""
Testes automatizados para sistema de grupos
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

import asyncio
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import models
from database import Base, engine, SessionLocal
from grupo_extraction import normalize_phone, is_valid_phone

def test_database():
    """Teste 1: Verificar se tabelas existem"""
    print("\n🔍 Teste: Database...")
    
    db = SessionLocal()
    try:
        # Verificar se Group table existe
        db.execute(text("SELECT 1 FROM groups LIMIT 1"))
        print("  ✅ Tabela 'groups' existe")
    except Exception as e:
        print(f"  ❌ Erro ao acessar 'groups': {e}")
    finally:
        db.close()

def test_models():
    """Teste 2: Verificar modelos"""
    print("\n🔍 Teste: Modelos...")
    
    try:
        from models import Group, GroupMember
        
        # Verificar atributos esperados
        assert hasattr(Group, 'id')
        assert hasattr(Group, 'user_id')
        assert hasattr(Group, 'group_id_waha')
        print("  ✅ Modelo Group válido")
        
        assert hasattr(GroupMember, 'group_id')
        assert hasattr(GroupMember, 'contact_id')
        assert hasattr(GroupMember, 'is_admin')
        print("  ✅ Modelo GroupMember válido")
        
    except Exception as e:
        print(f"  ❌ Erro: {e}")

def test_functions():
    """Teste 3: Verificar funções"""
    print("\n🔍 Teste: Funções...")
    
    # normalize_phone
    test_cases = [
        ("5511999999999@c.us", "5511999999999"),
        ("11999999999@g.us", "11999999999"),
        ("5511999999999", "5511999999999"),
    ]
    
    for input_val, expected in test_cases:
        result = normalize_phone(input_val)
        if result == expected:
            print(f"  ✅ normalize_phone('{input_val}') = '{result}'")
        else:
            print(f"  ❌ normalize_phone('{input_val}') = '{result}' (esperado '{expected}')")
    
    # is_valid_phone
    valid_numbers = [
        ("5511999999999", True),
        ("11999999999", True),
        ("123", False),
        ("", False),
    ]
    
    for phone, expected in valid_numbers:
        result = is_valid_phone(phone)
        if result == expected:
            print(f"  ✅ is_valid_phone('{phone}') = {result}")
        else:
            print(f"  ❌ is_valid_phone('{phone}') = {result} (esperado {expected})")

def test_routes():
    """Teste 4: Verificar se rotas estão registradas"""
    print("\n🔍 Teste: Rotas...")
    
    try:
        from routes import grupos
        assert hasattr(grupos, 'router')
        print("  ✅ Rota 'grupos' importável")
        
        # Verificar endpoints
        routes = grupos.router.routes
        endpoints = [r.path for r in routes]
        
        expected = ["/api/grupos", "/api/grupos/{group_id}", "/api/grupos/{group_id}/members"]
        for endpoint in expected:
            if any(endpoint in ep for ep in endpoints):
                print(f"  ✅ Endpoint {endpoint} registrado")
            else:
                print(f"  ❌ Endpoint {endpoint} não encontrado")
                
    except Exception as e:
        print(f"  ❌ Erro: {e}")

def test_webhook_import():
    """Teste 5: Verificar se webhook foi atualizado"""
    print("\n🔍 Teste: Webhook...")
    
    try:
        with open('backend/routes/webhook_waha.py', 'r') as f:
            content = f.read()
        
        if 'extract_groups_task' in content:
            print("  ✅ Webhook importa extract_groups_task")
        else:
            print("  ❌ Webhook não importa extract_groups_task")
            
        if 'asyncio.create_task' in content:
            print("  ✅ Webhook dispara task assíncrona")
        else:
            print("  ❌ Webhook não dispara task assíncrona")
            
    except Exception as e:
        print(f"  ❌ Erro: {e}")

def run_all_tests():
    """Executar todos os testes"""
    print("=" * 50)
    print("🧪 TESTES AUTOMATIZADOS - SISTEMA DE GRUPOS")
    print("=" * 50)
    
    test_database()
    test_models()
    test_functions()
    test_routes()
    test_webhook_import()
    
    print("\n" + "=" * 50)
    print("✅ Testes concluídos!")
    print("=" * 50)

if __name__ == "__main__":
    run_all_tests()
```

**Executar:**
```bash
cd backend
python ../test_grupos.py
```

**Esperado:**
```
==================================================
🧪 TESTES AUTOMATIZADOS - SISTEMA DE GRUPOS
==================================================

🔍 Teste: Database...
  ✅ Tabela 'groups' existe

🔍 Teste: Modelos...
  ✅ Modelo Group válido
  ✅ Modelo GroupMember válido

🔍 Teste: Funções...
  ✅ normalize_phone('5511999999999@c.us') = '5511999999999'
  ✅ is_valid_phone('5511999999999') = True

🔍 Teste: Rotas...
  ✅ Endpoint /api/grupos registrado
  ✅ Endpoint /api/grupos/{group_id} registrado

🔍 Teste: Webhook...
  ✅ Webhook importa extract_groups_task
  ✅ Webhook dispara task assíncrona

==================================================
✅ Testes concluídos!
==================================================
```

---

## 📊 Teste de Carga (Performance)

```python
"""
Teste de performance para simular extração
"""
import time
import asyncio
from datetime import datetime, timezone

async def test_performance():
    from grupo_extraction import normalize_phone, is_valid_phone
    
    # Simular 1000 números
    print("\n📊 TESTE DE PERFORMANCE")
    print("-" * 50)
    
    numbers = [f"55119{i:07d}" for i in range(1000)]
    
    # Teste 1: normalize_phone
    start = time.time()
    results = [normalize_phone(f"{n}@c.us") for n in numbers]
    duration = time.time() - start
    
    print(f"normalize_phone (1000x): {duration:.3f}s ({1000/duration:.0f} ops/sec)")
    
    # Teste 2: is_valid_phone
    start = time.time()
    results = [is_valid_phone(n) for n in numbers]
    duration = time.time() - start
    
    print(f"is_valid_phone (1000x): {duration:.3f}s ({1000/duration:.0f} ops/sec)")
    
    # Esperado: Ambos devem ser muito rápidos (> 10000 ops/sec)

asyncio.run(test_performance())
```

---

## ✅ Checklist de Testes

Antes de deploy em produção:

- [ ] Database tests passam
- [ ] Modelos validam corretamente
- [ ] Funções de normalização funcionam
- [ ] Rotas estão registradas
- [ ] Webhook dispara extração
- [ ] Frontend carrega página de grupos
- [ ] API retorna grupos corretamente
- [ ] Membros aparecem na tabela
- [ ] Performance aceitável (< 100ms por query)
- [ ] Logs estão sendo registrados
- [ ] Sem erros 500 na API
- [ ] Sem erros de console no frontend

---

**Status**: ✅ Pronto para Testes  
**Última Atualização**: Março 2025
