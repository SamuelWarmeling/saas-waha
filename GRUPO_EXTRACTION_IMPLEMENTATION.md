# 🎯 Sistema de Extração de Grupos - Implementação Completa

## 📋 Resumo das Mudanças

Implementei um **sistema automático de extração de grupos** que funciona assim:

### ✅ O que foi alterado:

#### 1. **Backend - Modelos** (`backend/models.py`)
Adicionados 2 novos modelos:

- **`Group`**: Armazena informações dos grupos WhatsApp
  - `group_id_waha`: ID único do grupo no WAHA (com @g.us)
  - `name` e `subject`: Nome do grupo
  - `member_count`: Contagem de membros
  - `last_extracted_at`: Timestamp da última extração
  - Relacionamento com `WhatsAppSession` e `User`

- **`GroupMember`**: Armazena membros de grupos
  - Relaciona grupos com contatos
  - Campos: `phone`, `name`, `is_admin`
  - Relacionamento direto com `Contact`

#### 2. **Backend - Novo arquivo** (`backend/grupo_extraction.py`)
Módulo para extrair grupos via WAHA API:

```python
async def extract_groups_for_session(session_id_db, session_id_waha, user_id, db)
```

**Fluxo:**
1. Chama `GET /api/{session}/chats?filter=group` para listar grupos
2. Para cada grupo, chama `GET /api/{session}/chats/{id}/members` para extrair membros
3. Cria contatos automaticamente para membros
4. Registra log de atividade

#### 3. **Backend - Webhook modificado** (`backend/routes/webhook_waha.py`)
Quando a sessão conecta (`session.status` → `CONNECTED`):
- Dispara automaticamente `extract_groups_task()` em background
- **Não bloqueia** a resposta do webhook

```python
if new_status == models.SessionStatus.connected:
    asyncio.create_task(extract_groups_task(...))
```

#### 4. **Backend - Nova rota** (`backend/routes/grupos.py`)
Novos endpoints:

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/grupos` | Listar grupos com paginação |
| GET | `/api/grupos/{group_id}` | Detalhes de um grupo |
| GET | `/api/grupos/{group_id}/members` | Listar membros de um grupo |
| POST | `/api/grupos/session/{session_id}/extract-all` | Forçar re-extração |
| POST | `/api/grupos/{group_id}/re-extract` | Re-extrair um grupo específico |
| POST | `/api/grupos/{group_id}/add-to-campaign` | Adicionar membros a uma campanha |
| DELETE | `/api/grupos/{group_id}` | Deletar grupo |

#### 5. **Backend - Main.py** (`backend/main.py`)
- Adicionado `import` da rota de grupos
- Registrado `app.include_router(grupos.router)`

#### 6. **Frontend - Nova página** (`frontend/src/pages/Grupos.jsx`)
Interface completa com:
- Seleção de sessão
- Botão para forçar extração
- Tabela de grupos com contadores
- Visualização de membros de cada grupo
- Ações: ver membros, deletar grupo
- Paginação

#### 7. **Frontend - Atualização** (`frontend/src/App.jsx`)
- Adicionada rota `/grupos` que renderiza `<Grupos />`

#### 8. **Frontend - Sidebar** (`frontend/src/components/Sidebar.jsx`)
- Adicionado link para "Grupos" com ícone `MdGroup`

---

## 🚀 Como Funciona

### Fluxo Automático:
```
1. Usuário conecta sessão WhatsApp
   ↓
2. Webhook recebe evento "session.status" → "CONNECTED"
   ↓
3. Servidor dispara `extract_groups_task()` em background
   ↓
4. Sistema chama API WAHA para listar grupos
   ↓
5. Para cada grupo, extrai membros via API
   ↓
6. Cria contatos automaticamente
   ↓
7. Salva no banco de dados
   ↓
8. Registra atividade
```

### Acesso Manual:
- Usuário acessa `/grupos`
- Seleciona uma sessão
- Clica "Forçar Extração de Grupos"
- Sistema processa em background
- Resultados aparecem automaticamente

---

## 🔧 Banco de Dados - Novas Tabelas

### `groups`
```sql
CREATE TABLE groups (
    id INT PRIMARY KEY,
    user_id INT (FK),
    session_id INT (FK),
    group_id_waha VARCHAR(100) UNIQUE,
    name VARCHAR(255),
    subject VARCHAR(500),
    member_count INT,
    is_active BOOLEAN,
    created_at TIMESTAMP,
    last_extracted_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### `group_members`
```sql
CREATE TABLE group_members (
    id INT PRIMARY KEY,
    group_id INT (FK),
    contact_id INT (FK),
    phone VARCHAR(20),
    name VARCHAR(255),
    is_admin BOOLEAN,
    added_at TIMESTAMP
);
```

---

## 📊 API Response Examples

### Listar Grupos
```bash
GET /api/grupos?session_id=1&page=1&page_size=20
```

Response:
```json
{
  "total": 5,
  "page": 1,
  "page_size": 20,
  "items": [
    {
      "id": 1,
      "name": "Donos de Negócio",
      "subject": "Grupo de desenvolvimento",
      "member_count": 42,
      "is_active": true,
      "created_at": "2025-03-01T10:30:00Z",
      "last_extracted_at": "2025-03-01T15:45:30Z"
    }
  ]
}
```

### Listar Membros de um Grupo
```bash
GET /api/grupos/1/members?page=1&page_size=50
```

Response:
```json
{
  "group_id": 1,
  "group_name": "Donos de Negócio",
  "total": 42,
  "page": 1,
  "page_size": 50,
  "items": [
    {
      "id": 1,
      "phone": "5511999999999",
      "name": "João Silva",
      "is_admin": true,
      "added_at": "2025-03-01T10:30:00Z"
    }
  ]
}
```

### Forçar Extração
```bash
POST /api/grupos/session/1/extract-all
```

Response:
```json
{
  "status": "extraindo",
  "message": "Extração de grupos da sessão MySession iniciada em background"
}
```

---

## ⚡ Logs de Atividade

Quando grupos são extraídos, registra-se:
```python
tipo = "grupos_extraidos"
descricao = "Extração automática: 5 grupos, 42 membros extraídos via sessão u1_01"
```

---

## 📝 Arquivos Modificados

| Arquivo | Mudança |
|---------|---------|
| `backend/models.py` | ✅ Adicionados `Group` e `GroupMember` |
| `backend/grupo_extraction.py` | ✅ Novo arquivo |
| `backend/routes/webhook_waha.py` | ✅ Adicionado disparo de extração |
| `backend/routes/grupos.py` | ✅ Novo arquivo com endpoints |
| `backend/main.py` | ✅ Registrado router de grupos |
| `frontend/src/pages/Grupos.jsx` | ✅ Novo arquivo |
| `frontend/src/App.jsx` | ✅ Adicionada rota `/grupos` |
| `frontend/src/components/Sidebar.jsx` | ✅ Adicionado link no menu |

---

## 🧪 Próximos Passos

1. **Executar migrations** do banco de dados para criar as tabelas
2. **Tester a conexão** de uma sessão para validar a extração
3. **Verificar logs** para monitorar o processo
4. **Acessar** `/grupos` na interface para visualizar os grupos

---

## 🎯 Benefícios

✅ **Automático**: Grupos são extraídos quando a sessão conecta  
✅ **Escalável**: Sistema em background não bloqueia resposta do webhook  
✅ **Completo**: Extrai membros, identifica admins, cria contatos  
✅ **Integrável**: Membros podem ser adicionados diretamente a campanhas  
✅ **Rastreável**: Auditoria completa em `atividade_logs`  

---

**Status**: ✅ Pronto para Deploy
