# 📚 Guia de Uso - API de Grupos

## Exemplos de Requisições

### 1️⃣ Listar todos os grupos de uma sessão

```bash
curl -X GET "http://localhost:8000/api/grupos?session_id=1&page=1&page_size=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "total": 5,
  "page": 1,
  "page_size": 20,
  "items": [
    {
      "id": 1,
      "name": "Donos de Negócio",
      "subject": "Compartilhamento de ideias e networking",
      "member_count": 42,
      "is_active": true,
      "created_at": "2025-03-01T10:30:00Z",
      "last_extracted_at": "2025-03-01T15:45:30Z"
    },
    {
      "id": 2,
      "name": "Dev Notes",
      "subject": null,
      "member_count": 28,
      "is_active": true,
      "created_at": "2025-03-01T10:31:00Z",
      "last_extracted_at": "2025-03-01T15:46:00Z"
    }
  ]
}
```

---

### 2️⃣ Obter detalhes de um grupo com todos os membros

```bash
curl -X GET "http://localhost:8000/api/grupos/1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "id": 1,
  "name": "Donos de Negócio",
  "subject": "Compartilhamento de ideias e networking",
  "member_count": 42,
  "is_active": true,
  "created_at": "2025-03-01T10:30:00Z",
  "last_extracted_at": "2025-03-01T15:45:30Z",
  "members": [
    {
      "id": 101,
      "phone": "5511999999999",
      "name": "João Silva",
      "is_admin": true,
      "added_at": "2025-03-01T10:30:00Z"
    },
    {
      "id": 102,
      "phone": "5521999999998",
      "name": "Maria Santos",
      "is_admin": false,
      "added_at": "2025-03-01T10:30:15Z"
    }
  ]
}
```

---

### 3️⃣ Listar membros de um grupo com paginação

```bash
curl -X GET "http://localhost:8000/api/grupos/1/members?page=1&page_size=50&search=João" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "group_id": 1,
  "group_name": "Donos de Negócio",
  "total": 42,
  "page": 1,
  "page_size": 50,
  "items": [
    {
      "id": 101,
      "phone": "5511999999999",
      "name": "João Silva",
      "is_admin": true,
      "added_at": "2025-03-01T10:30:00Z"
    },
    {
      "id": 103,
      "phone": "5511999999997",
      "name": "João Pereira",
      "is_admin": false,
      "added_at": "2025-03-01T10:31:00Z"
    }
  ]
}
```

---

### 4️⃣ Forçar extração de todos os grupos de uma sessão

```bash
curl -X POST "http://localhost:8000/api/grupos/session/1/extract-all" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "status": "extraindo",
  "message": "Extração de grupos da sessão MySession iniciada em background"
}
```

---

### 5️⃣ Forçar re-extração de um grupo específico

```bash
curl -X POST "http://localhost:8000/api/grupos/1/re-extract" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "status": "extraindo",
  "message": "Extração iniciada em background"
}
```

---

### 6️⃣ Adicionar todos os membros de um grupo a uma campanha

```bash
curl -X POST "http://localhost:8000/api/grupos/1/add-to-campaign" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"campaign_id": 5}'
```

**Response:**
```json
{
  "campaign_id": 5,
  "group_id": 1,
  "added_count": 42,
  "message": "42 membros adicionados à campanha"
}
```

---

### 7️⃣ Deletar um grupo

```bash
curl -X DELETE "http://localhost:8000/api/grupos/1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "status": "deleted",
  "group_id": 1
}
```

---

## 🎯 Casos de Uso Comuns

### Caso 1: Extrair grupos de uma nova sessão

```python
import requests
import time

# 1. Conectar sessão (usuário escaneia QR)
session_response = requests.post(
    "http://localhost:8000/api/sessoes",
    headers={"Authorization": f"Bearer {token}"},
    json={"name": "Minha Sessão", "delay_min": 5, "delay_max": 15}
)
session_id = session_response.json()["id"]

# 2. Aguardar conexão (webhook dispara automaticamente a extração)
time.sleep(5)

# 3. Verificar grupos extraídos
grupos = requests.get(
    f"http://localhost:8000/api/grupos?session_id={session_id}",
    headers={"Authorization": f"Bearer {token}"}
).json()

print(f"Encontrados {grupos['total']} grupos!")
```

---

### Caso 2: Criar campanha com membros de um grupo

```python
import requests

# 1. Listar grupos
grupos = requests.get(
    "http://localhost:8000/api/grupos",
    headers={"Authorization": f"Bearer {token}"}
).json()

group_id = grupos["items"][0]["id"]

# 2. Criar campanha
campanha = requests.post(
    "http://localhost:8000/api/campanhas",
    headers={"Authorization": f"Bearer {token}"},
    json={
        "name": "Promoção para grupo VIP",
        "message": "Olá! Temos uma oferta especial para você 🎉",
        "session_id": 1,
        "contact_ids": []  # Será preenchido no passo 3
    }
).json()

campaign_id = campanha["id"]

# 3. Adicionar membros do grupo à campanha
result = requests.post(
    f"http://localhost:8000/api/grupos/{group_id}/add-to-campaign",
    headers={"Authorization": f"Bearer {token}"},
    json={"campaign_id": campaign_id}
).json()

print(f"Campanha criada com {result['added_count']} contatos do grupo!")
```

---

### Caso 3: Extrair e filtrar membros administratores

```python
import requests

# 1. Obter grupo com membros
grupo = requests.get(
    "http://localhost:8000/api/grupos/1",
    headers={"Authorization": f"Bearer {token}"}
).json()

# 2. Filtrar apenas administradores
admins = [m for m in grupo["members"] if m["is_admin"]]

print(f"Administradores do grupo: {len(admins)}")
for admin in admins:
    print(f"  - {admin['name']} ({admin['phone']})")
```

---

### Caso 4: Re-extrair e verificar mudanças

```python
import requests
import time

# 1. Re-extrair grupo
requests.post(
    "http://localhost:8000/api/grupos/1/re-extract",
    headers={"Authorization": f"Bearer {token}"}
)

# 2. Aguardar processamento
time.sleep(3)

# 3. Obter dados atualizados
grupo = requests.get(
    "http://localhost:8000/api/grupos/1",
    headers={"Authorization": f"Bearer {token}"}
).json()

print(f"Grupo: {grupo['name']}")
print(f"Membros: {grupo['member_count']}")
print(f"Última extração: {grupo['last_extracted_at']}")
```

---

## 🔍 Monitoramento via Logs

Para verificar se a extração foi bem-sucedida, consulte `atividade_logs`:

```bash
curl -X GET "http://localhost:8000/api/atividades" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Procure por registros com:
- `tipo`: "grupos_extraidos"
- `descricao`: "Extração automática: X grupos, Y membros..."

---

## ⚠️ Observações Importantes

### Tempo de Processamento
- Extração é **assíncrona** (background task)
- Não bloqueia resposta da API
- Tempo varia conforme quantidade de grupos e membros
- Tipicamente **2-10 segundos** por sessão

### Limites
- Máximo de grupos suportados: **Ilimitado** (depende do WhatsApp)
- Máximo de membros por grupo: **Na prática, ~512** (limite do WhatsApp)
- Taxa de requisições WAHA: Respeitada automaticamente

### Tratamento de Erros
- Números inválidos são ignorados silenciosamente
- Membros sem ID são pulados
- Erros de conexão são registrados em logs
- Processamento continua mesmo com falhas parciais

### Performance
- Índices criados em:
  - `groups.user_id`
  - `groups.session_id`
  - `group_members.group_id`
  - `group_members.contact_id`

---

## 📱 Frontend - Exemplos

### Usar a página de Grupos

1. **Acesse**: `/grupos`
2. **Selecione uma sessão** no dropdown
3. **Grupos aparecem automaticamente** (aguarde alguns segundos se foi recém-conectado)
4. **Clique em "Ver Membros"** para expandir
5. **Clique em "Forçar Extração"** para re-extrair

### Integração em Campanhas

Ao criar uma campanha:
1. Vá para `/campanhas`
2. Selecione um grupo já extraído
3. Os membros serão adicionados automaticamente como contatos

---

**Status**: ✅ Totalmente Funcional
**Versão**: 1.0.0
**Data**: Março 2025
