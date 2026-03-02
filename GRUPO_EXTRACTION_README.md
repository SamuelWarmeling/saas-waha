# 📖 Sistema de Extração de Grupos - README

## 🎯 O que foi implementado?

Um **sistema completo e automático de extração de grupos WhatsApp** que:

- ✅ Extrai grupos automaticamente quando a sessão conecta
- ✅ Extrai membros de cada grupo
- ✅ Cria contatos para os membros automaticamente
- ✅ Funciona em background sem bloquear a API
- ✅ Interface web para visualizar e gerenciar grupos
- ✅ Integração com campanhas (adicionar membros facilmente)

---

## 🚀 Quick Start

### 1. Backend - Preparar

```bash
cd backend

# Instalar dependências (se necessário)
pip install -r requirements.txt

# Iniciar servidor
uvicorn main:app --reload
```

Logs esperados:
```
[STARTUP] Tabelas verificadas/criadas com sucesso.
```

### 2. Frontend - Preparar

```bash
cd frontend

# Instalar dependências (se necessário)
npm install

# Iniciar desenvolvimento
npm run dev
```

Acesse: **http://localhost:5173**

### 3. Testar

**Na interface:**
1. Acesse `/sessoes`
2. Crie uma nova sessão e escaneia o QR code
3. Aguarde conexão (leva alguns segundos)
4. Vá para `/grupos` → verá os grupos extraídos

---

## 📁 Arquivos Principais

| Arquivo | Descrição |
|---------|-----------|
| `backend/models.py` | Modelos `Group` e `GroupMember` |
| `backend/grupo_extraction.py` | Lógica de extração (async) |
| `backend/routes/grupos.py` | API endpoints |
| `backend/routes/webhook_waha.py` | Disparador automático |
| `frontend/src/pages/Grupos.jsx` | Interface de grupos |

---

## 🔗 Endpoints da API

```
GET    /api/grupos                              Listar grupos
GET    /api/grupos/{group_id}                   Detalhes de um grupo
GET    /api/grupos/{group_id}/members           Listar membros
POST   /api/grupos/session/{session_id}/extract-all    Forçar extração
POST   /api/grupos/{group_id}/re-extract        Re-extrair grupo
POST   /api/grupos/{group_id}/add-to-campaign   Adicionar a campanha
DELETE /api/grupos/{group_id}                   Deletar grupo
```

---

## 📊 Fluxo de Funcionamento

```
1. Usuário conecta sessão WhatsApp
   ↓
2. Webhook recebe evento de conexão
   ↓
3. Sistema dispara extração em background (async)
   ↓
4. API WAHA lista grupos
   ↓
5. Para cada grupo, extrai membros
   ↓
6. Cria contatos automaticamente
   ↓
7. Salva tudo no banco
   ↓
8. Frontend atualiza página → usuário vê grupos
```

---

## 📚 Documentação

Para mais detalhes, consulte:

| Arquivo | Conteúdo |
|---------|----------|
| `GRUPO_EXTRACTION_IMPLEMENTATION.md` | 📋 Detalhes técnicos de implementação |
| `GRUPO_API_EXAMPLES.md` | 📚 Exemplos de uso da API com cURL |
| `SETUP_DEPLOYMENT.md` | 🚀 Instruções de setup e deploy |
| `TESTES_VALIDACAO.md` | 🧪 Testes automatizados |

---

## 🔍 Exemplos Rápidos

### Listar grupos via API

```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:8000/api/grupos?session_id=1" | jq
```

### Forçar extração manualmente

```bash
curl -X POST -H "Authorization: Bearer TOKEN" \
  "http://localhost:8000/api/grupos/session/1/extract-all" | jq
```

### Ver membros de um grupo

```bash
curl -H "Authorization: Bearer TOKEN" \
  "http://localhost:8000/api/grupos/1/members" | jq
```

---

## 🎨 Interface Web

Acesse a nova página `/grupos` para:

- 📊 **Visualizar grupos** extraídos
- 👥 **Ver membros** com detalhes (nome, telefone, admin/não-admin)
- 🔄 **Forçar re-extração** de grupos
- ➕ **Adicionar membros** a campanhas
- ❌ **Deletar grupos**

---

## ⚙️ Configuração

Nenhuma configuração adicional necessária!

Todas as variáveis de ambiente já existem em `.env`:
- `WAHA_API_URL` ✅
- `WAHA_API_KEY` ✅
- `DATABASE_URL` ✅

---

## 📊 Banco de Dados

Novas tabelas criadas automaticamente:

**`groups`** - Armazena grupos WhatsApp
```
id, user_id, session_id, group_id_waha, name, subject, 
member_count, is_active, created_at, last_extracted_at
```

**`group_members`** - Armazena membros de grupos
```
id, group_id, contact_id, phone, name, is_admin, added_at
```

---

## 🐛 Troubleshooting

### Grupos não aparecem?
1. Verifique se sessão está realmente conectada
2. Verifique logs: `grep "GRUPOS" backend.log`
3. Aguarde 5-10 segundos (extração é assíncrona)

### Erro de permissão?
1. Verifique token JWT válido
2. Verifique `Authorization: Bearer TOKEN`

### Banco de dados não criou tabelas?
```bash
python -c "from backend.database import engine, Base; Base.metadata.create_all(bind=engine)"
```

---

## ✅ Checklist

Antes de usar em produção:

- [ ] Backend iniciado com sucesso
- [ ] Frontend carregando normalmente
- [ ] Sessão conectada no WhatsApp
- [ ] Grupos aparecem em `/grupos`
- [ ] Membros listam corretamente
- [ ] Logs não mostram erros

---

## 🎯 Próximas Implementações

Para melhorias futuras:
- [ ] Sincronização periódica de grupos
- [ ] Notificações em tempo real
- [ ] Relatórios detalhados
- [ ] Busca avançada
- [ ] Exportação de dados

---

## 📞 Suporte

Se encontrar problemas:

1. **Verificar logs:**
   ```bash
   docker-compose logs -f backend
   grep "ERROR" backend.log
   ```

2. **Consultar documentação:**
   - `GRUPO_EXTRACTION_IMPLEMENTATION.md` - Detalhes técnicos
   - `SETUP_DEPLOYMENT.md` - Troubleshooting

3. **Rodar testes:**
   ```bash
   python test_grupos.py
   ```

---

## 📋 Summary

| Aspecto | Status |
|--------|--------|
| **Backend** | ✅ Implementado |
| **Frontend** | ✅ Implementado |
| **API** | ✅ Implementado |
| **Banco de Dados** | ✅ Migrado automaticamente |
| **Documentação** | ✅ Completa |
| **Testes** | ✅ Inclusos |

---

**Versão**: 1.0.0  
**Status**: ✅ Production Ready  
**Data**: Março 2025

---

## 🎉 Você Está Pronto!

O sistema de extração de grupos está completamente implementado e testado.

**Próximo passo:** Conecte uma sessão e veja a "mágica" acontecer! 🚀
