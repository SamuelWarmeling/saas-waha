# 🚀 Setup e Deploy - Sistema de Extração de Grupos

## ✅ Checklist Pre-Deploy

- [ ] Confirmar que os novos arquivos foram criados
- [ ] Executar migrations do banco de dados
- [ ] Testar a API com uma sessão
- [ ] Verificar os logs
- [ ] Acessar interface web para validar frontend

---

## 1️⃣ Instalação das Dependências

As dependências necessárias já estão no `requirements.txt`:
- `httpx` ✅ (para requisições async à WAHA API)
- `sqlalchemy` ✅
- `fastapi` ✅

Nenhuma nova dependência foi adicionada!

```bash
# Caso necessite reinstalar
pip install -r backend/requirements.txt
```

---

## 2️⃣ Criar Tabelas no Banco de Dados

### Opção A: Usando Alembic (Recomendado em Produção)

```bash
# Gerar migration automática
cd backend
alembic revision --autogenerate -m "Add grupos and group_members tables"

# Aplicar migration
alembic upgrade head
```

### Opção B: Deixar SQLAlchemy criar automaticamente (Desenvolvimento)

Ao iniciar o servidor, o código em `main.py` já executa:
```python
Base.metadata.create_all(bind=engine)
```

Isso criará as tabelas automaticamente:
- `groups`
- `group_members`

---

## 3️⃣ Arquivos Adicionados/Modificados

```
backend/
├── models.py                      ✏️ Modificado (+ Group, GroupMember)
├── grupo_extraction.py             ✨ Novo
├── routes/
│   ├── webhook_waha.py            ✏️ Modificado (+ disparo de extração)
│   ├── grupos.py                  ✨ Novo
│   └── __init__.py                (sem mudanças)
└── main.py                        ✏️ Modificado (+ import grupos)

frontend/
├── src/
│   ├── App.jsx                    ✏️ Modificado (+ rota /grupos)
│   ├── pages/
│   │   └── Grupos.jsx             ✨ Novo
│   └── components/
│       └── Sidebar.jsx            ✏️ Modificado (+ link Grupos)
└── package.json                   (sem mudanças)
```

---

## 4️⃣ Configuração (Se Necessário)

### Variáveis de Ambiente

Todas já existem em `.env`, sem mudanças necessárias:

```env
# Existentes
WAHA_API_URL=https://waha-waha.xeramr.easypanel.host
WAHA_API_KEY=wARM31Ngadmin
WAHA_WEBHOOK_URL=https://api-saas.xeramr.easypanel.host/api/webhook/waha

# Banco de dados
DATABASE_URL=postgresql://...
```

### Confira se estão corretos:
```bash
grep WAHA .env
```

---

## 5️⃣ Iniciar o Servidor

### Backend
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Logs esperados:**
```
[STARTUP] Iniciando aplicação...
[DB] Tentativa 1/5 de conexão com o banco...
[DB] Conexão com o banco estabelecida com sucesso.
[STARTUP] Criando tabelas no banco se não existirem...
[STARTUP] Tabelas verificadas/criadas com sucesso.
[STARTUP] Aplicação pronta para receber requisições.
```

### Frontend
```bash
cd frontend
npm run dev
```

Acesse: **http://localhost:5173**

---

## 6️⃣ Testar a Funcionalidade

### Teste 1: Verificar se tabelas foram criadas

```bash
# Conectar ao banco
psql postgresql://postgres:postgres@localhost:5432/saas_waha

# Verificar tabelas
\dt groups
\dt group_members
```

Esperado:
```
           List of relations
 Schema |      Name      | Type  | Owner
--------+----------------+-------+----------
 public | group_members  | table | postgres
 public | groups         | table | postgres
```

### Teste 2: Conectar uma sessão

1. Acesse `http://localhost:5173`
2. Vá para `/sessoes`
3. Crie uma nova sessão
4. Escaneie o QR code

**Logs esperados:**
```
[WEBHOOK] Sessão u1_01 conectou! Iniciando extração de grupos...
[GRUPOS] Iniciando extração para sessão u1_01 (user=1)
[GRUPOS] Buscando lista de grupos...
[GRUPOS] Encontrados 5 grupos
```

### Teste 3: Verificar grupos na UI

1. Acesse `/grupos`
2. Selecione a sessão conectada
3. Aguarde 5-10 segundos
4. Grupos devem aparecer na tabela

### Teste 4: Ver membros de um grupo

1. Na página `/grupos`, clique em "Ver Membros"
2. Lista de membros deve aparecer
3. Identifique quem é admin

---

## 7️⃣ Monitorar Execução

### Logs em Tempo Real

```bash
# Backend
tail -f backend/*.log

# Ou busque por "GRUPOS" em stdout
docker logs -f container_saas_waha_backend
```

### Verificar Atividades Registradas

```bash
# SQL Query
SELECT tipo, descricao, criado_em 
FROM atividade_logs 
WHERE tipo = 'grupos_extraidos' 
ORDER BY criado_em DESC 
LIMIT 10;
```

### Dashboard de Grupos

```bash
# Contar grupos por usuário
SELECT u.email, COUNT(g.id) as grupos_count
FROM users u
LEFT JOIN groups g ON u.id = g.user_id
GROUP BY u.id, u.email;
```

---

## 8️⃣ Verificar API com cURL

### Listar grupos
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/grupos?session_id=1"
```

### Forçar extração
```bash
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/grupos/session/1/extract-all"
```

### Ver membros
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8000/api/grupos/1/members"
```

---

## 🐳 Deploy com Docker

### Rebuild da imagem (Backend)

```bash
cd backend
docker build -t saas-waha-backend:latest .
```

### Down e Up
```bash
docker-compose down
docker-compose up -d
```

### Verificar logs
```bash
docker-compose logs -f backend
```

---

## 🐛 Troubleshooting

### ❌ Erro: "grupos table not found"

**Solução:**
```bash
# Manualmente criar tabelas
cd backend
python -c "from database import engine, Base; Base.metadata.create_all(bind=engine)"
```

---

### ❌ Webhook não dispara extração

**Verificar:**
1. Sessão está realmente conectada?
   ```sql
   SELECT status FROM whatsapp_sessions WHERE id = 1;
   ```
   
2. Webhook URL está correta?
   ```bash
   curl http://localhost:8000/api/sessoes/webhook-url
   ```

3. Logs mostram o webhook sendo chamado?
   ```bash
   grep "WEBHOOK" backend.log
   ```

---

### ❌ Extração muito lenta

**Possíveis causas:**
- WAHA API lenta (verificar status do WAHA)
- Muitos grupos/membros (normal: ~2-5 seg por 100 membros)
- Database lenta (verificar performance)

**Solução:**
```python
# Aumentar timeout no grupo_extraction.py se necessário
async with httpx.AsyncClient(timeout=60.0) as client:  # 60 segundos
```

---

### ❌ Contatos não aparecem na campanha

**Verificar:**
1. Membros foram criados como contatos?
   ```sql
   SELECT COUNT(*) FROM contacts WHERE user_id = 1;
   ```

2. Adicionar à campanha funcionou?
   ```sql
   SELECT COUNT(*) FROM campaign_contacts WHERE campaign_id = 1;
   ```

---

## 📊 Performance

### Índices criados (automáticamente)
```sql
-- groups
CREATE INDEX ix_groups_user_id ON groups(user_id);
CREATE INDEX ix_groups_session_id ON groups(session_id);

-- group_members
CREATE INDEX ix_group_members_group_id ON group_members(group_id);
CREATE INDEX ix_group_members_contact_id ON group_members(contact_id);
```

### Esperado
- Listar grupos (1000+): < 100ms
- Listar membros (1000+): < 200ms
- Extrair um grupo (100 membros): ~2-3 segundos

---

## 🔄 Atualizações Futuras

### Possíveis melhorias:
1. ✨ Webhooks para notificar quando extraçãoCompleta
2. ✨ Sincronização periódica de grupos (a cada 1h)
3. ✨ Cache de grupos (Redis)
4. ✨ Bulk operations para adicionar a campanhas
5. ✨ Relatórios de grupo (análise de membros)

---

## 📞 Suporte

Se encontrar problemas:
1. Verificar logs: `docker-compose logs -f`
2. Verificar database: `psql ... \dt`
3. Verificar webhook: `grep "WEBHOOK" logs`
4. Revisar arquivo `GRUPO_EXTRACTION_IMPLEMENTATION.md`

---

**Status**: ✅ Ready to Deploy  
**Versão**: 1.0.0  
**Data**: Março 2025
