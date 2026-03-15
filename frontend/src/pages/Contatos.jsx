import { useEffect, useState, useCallback, useRef } from 'react'
import {
  MdAdd, MdUpload, MdDownload, MdDelete, MdBlock, MdSearch, MdClose,
  MdFilterList, MdCheckBox, MdCheckBoxOutlineBlank, MdIndeterminateCheckBox,
  MdLabel, MdPhone, MdPerson, MdCampaign, MdContentCopy, MdMoreVert,
  MdPlayArrow, MdChevronRight, MdChevronLeft, MdFolder, MdFolderOpen,
  MdOutlineChecklist, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

const DDD_STATE = {
  '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP',
  '21':'RJ','22':'RJ','24':'RJ','27':'ES','28':'ES',
  '31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG',
  '41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR',
  '47':'SC','48':'SC','49':'SC','51':'RS','53':'RS','54':'RS','55':'RS',
  '61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO',
  '71':'BA','73':'BA','74':'BA','75':'BA','77':'BA','79':'SE',
  '81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI',
  '91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA',
}

const LISTA_CORES = ['#06B6D4','#2563eb','#059669','#d97706','#dc2626','#db2777','#0891b2','#65a30d']

function formatPhone(phone) {
  if (!phone) return ''
  const d = phone.replace(/\D/g,'')
  if (d.length === 13) return `(${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`
  if (d.length === 12) return `(${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`
  return phone
}

function getDDD(phone) {
  const d = (phone||'').replace(/\D/g,'')
  if (d.startsWith('55') && d.length >= 4) return d.slice(2,4)
  return ''
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  if (hours < 24) return `${hours}h atrás`
  if (days < 30) return `${days}d atrás`
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function getInitials(name, phone) {
  if (name) return name.trim()[0].toUpperCase()
  const ddd = getDDD(phone)
  return ddd ? ddd[0] : '?'
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function StatCard({ value, label, sub, color = 'text-primary-400' }) {
  return (
    <div className="glass-card p-4 flex items-center gap-4">
      <div>
        <p className={`text-2xl font-black ${color}`}>{value?.toLocaleString('pt-BR') ?? '—'}</p>
        <p className="text-xs font-semibold text-surface-300 mt-0.5">{label}</p>
        {sub != null && <p className="text-[10px] text-surface-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function Avatar({ name, phone, size = 'sm' }) {
  const ddd = getDDD(phone)
  const colorIdx = (ddd.charCodeAt(0) || 0) % LISTA_CORES.length
  const bg = LISTA_CORES[colorIdx] + '33'
  const color = LISTA_CORES[colorIdx]
  const sz = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold flex-shrink-0`} style={{ background: bg, color }}>
      {getInitials(name, phone)}
    </div>
  )
}

// ── Modal: Adicionar Contato ──────────────────────────────────────────────────

function AddContactModal({ onClose, onSave }) {
  const [form, setForm] = useState({ phone: '', name: '' })
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/contatos', form)
      toast.success('Contato adicionado!')
      onSave()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao adicionar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-md p-0 overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <MdAdd size={18} className="text-primary-400" /> Novo Contato
          </h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white"><MdClose size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Telefone</label>
            <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
              placeholder="5511999999999" required className="input" />
            <p className="text-[11px] text-surface-500 mt-1">Formato: 55 + DDD + número</p>
          </div>
          <div>
            <label className="label">Nome <span className="text-surface-500 font-normal">(opcional)</span></label>
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
              placeholder="Ex: João Silva" className="input" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"/>Salvando...</span> : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Criar Lista ────────────────────────────────────────────────────────

function CreateListaModal({ onClose, onSave }) {
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState('#06B6D4')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!nome.trim()) return
    setLoading(true)
    try {
      const { data } = await api.post('/listas', { nome, cor })
      toast.success(`Lista "${data.nome}" criada!`)
      onSave(data)
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-sm p-0 overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <MdLabel size={18} className="text-primary-400" /> Nova Lista
          </h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white"><MdClose size={20}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="label">Nome da lista</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              placeholder="Ex: Leads Quentes" required className="input" autoFocus />
          </div>
          <div>
            <label className="label">Cor</label>
            <div className="flex gap-2 flex-wrap mt-1">
              {LISTA_CORES.map(c => (
                <button key={c} type="button" onClick={() => setCor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${cor === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Criando...' : 'Criar Lista'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Adicionar Selecionados à Lista ─────────────────────────────────────

function AddToListaModal({ selectedIds, listas, onClose, onDone }) {
  const [listaId, setListaId] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!listaId) return
    setLoading(true)
    try {
      const { data } = await api.post(`/listas/${listaId}/contatos`, { contato_ids: [...selectedIds] })
      toast.success(`${data.added} contatos adicionados à lista!`)
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-sm p-0 overflow-hidden shadow-xl">
        <div className="px-5 py-4 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Adicionar {selectedIds.size} contatos à lista</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white"><MdClose size={20}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="label">Selecione a lista</label>
            <select value={listaId} onChange={e => setListaId(e.target.value)} className="input" required>
              <option value="">Escolha uma lista...</option>
              {listas.map(l => (
                <option key={l.id} value={l.id}>{l.nome} ({l.total_contatos} contatos)</option>
              ))}
            </select>
          </div>
          {listas.length === 0 && (
            <p className="text-sm text-surface-400 text-center py-2">Nenhuma lista criada ainda</p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={loading || !listaId} className="btn-primary flex-1">
              {loading ? 'Adicionando...' : 'Adicionar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: Importar CSV ───────────────────────────────────────────────────────

function ImportCSVModal({ listas, onClose, onDone }) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [headers, setHeaders] = useState([])
  const [preview, setPreview] = useState([])
  const [colPhone, setColPhone] = useState('')
  const [colName, setColName] = useState('')
  const [listaId, setListaId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const fileRef = useRef()

  async function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const { data } = await api.post('/contatos/importar-csv/preview', fd)
      setHeaders(data.headers)
      setPreview(data.preview)
      // Auto-detect columns
      const phCol = data.headers.find(h => /phone|telefone|tel|numero|número/i.test(h)) || ''
      const nmCol = data.headers.find(h => /nome|name/i.test(h)) || ''
      setColPhone(phCol)
      setColName(nmCol)
      setStep(2)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao ler arquivo')
      setFile(null)
      e.target.value = ''
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!colPhone) { toast.error('Selecione a coluna de telefone'); return }
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const params = new URLSearchParams({ col_phone: colPhone })
      if (colName) params.append('col_name', colName)
      if (listaId) params.append('lista_id', listaId)
      const { data } = await api.post(`/contatos/importar-csv?${params}`, fd)
      setResult(data)
      setStep(3)
      onDone()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao importar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-2xl p-0 overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
              <MdUpload size={18}/>
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Importar CSV</h2>
              <p className="text-[11px] text-surface-400">
                {step === 1 ? 'Selecione o arquivo' : step === 2 ? 'Mapeie as colunas' : 'Importação concluída'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-white"><MdClose size={20}/></button>
        </div>

        {/* Steps indicator */}
        <div className="flex px-6 pt-4 gap-2">
          {['Arquivo', 'Mapeamento', 'Resultado'].map((s, i) => (
            <div key={i} className={`flex items-center gap-1.5 text-xs font-semibold ${step > i + 1 ? 'text-green-400' : step === i + 1 ? 'text-primary-400' : 'text-surface-600'}`}>
              <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-bold ${step > i + 1 ? 'bg-green-500/20 border-green-500/50' : step === i + 1 ? 'bg-primary-500/20 border-primary-500/50' : 'border-surface-700'}`}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              {s}
              {i < 2 && <span className="text-surface-700 ml-1">›</span>}
            </div>
          ))}
        </div>

        <div className="p-6">
          {/* Step 1: Upload */}
          {step === 1 && (
            <div>
              <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileChange} className="hidden" />
              <button onClick={() => fileRef.current?.click()} disabled={loading}
                className="w-full py-12 rounded-xl border-2 border-dashed border-surface-700 hover:border-primary-500/50 hover:bg-primary-900/10 transition-all text-center">
                {loading ? (
                  <div className="flex flex-col items-center gap-2 text-primary-400">
                    <div className="w-8 h-8 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin"/>
                    <span className="text-sm font-medium">Lendo arquivo...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 text-surface-400 hover:text-surface-200">
                    <MdUpload size={40}/>
                    <div>
                      <p className="font-semibold text-surface-300">Clique para selecionar um arquivo CSV</p>
                      <p className="text-xs text-surface-500 mt-1">Formatos: .csv, .txt — UTF-8 ou Latin-1</p>
                    </div>
                  </div>
                )}
              </button>
            </div>
          )}

          {/* Step 2: Column mapping */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Coluna de Telefone <span className="text-red-400">*</span></label>
                  <select value={colPhone} onChange={e => setColPhone(e.target.value)} className="input" required>
                    <option value="">Selecione...</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Coluna de Nome <span className="text-surface-500 font-normal">(opcional)</span></label>
                  <select value={colName} onChange={e => setColName(e.target.value)} className="input">
                    <option value="">Nenhuma</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              {listas.length > 0 && (
                <div>
                  <label className="label">Adicionar à lista <span className="text-surface-500 font-normal">(opcional)</span></label>
                  <select value={listaId} onChange={e => setListaId(e.target.value)} className="input">
                    <option value="">Não adicionar à lista</option>
                    {listas.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
                  </select>
                </div>
              )}

              {/* Preview table */}
              {preview.length > 0 && (
                <div>
                  <p className="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-2">Preview (primeiras {preview.length} linhas)</p>
                  <div className="rounded-xl overflow-hidden border border-surface-700/50">
                    <table className="w-full text-xs">
                      <thead className="bg-surface-900/50">
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i} className={`px-3 py-2 text-left font-semibold ${h === colPhone ? 'text-primary-400' : h === colName ? 'text-green-400' : 'text-surface-500'}`}>
                              {h} {h === colPhone ? '📞' : h === colName ? '👤' : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-800/50">
                        {preview.map((row, ri) => (
                          <tr key={ri} className="hover:bg-surface-800/20">
                            {headers.map((h, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-surface-300 truncate max-w-[150px]">
                                {row[ci] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => { setStep(1); setFile(null); setHeaders([]); setPreview([]) }}
                  className="btn-secondary flex-1">Voltar</button>
                <button onClick={handleImport} disabled={loading || !colPhone} className="btn-primary flex-1">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"/>Importando...</span>
                  ) : 'Importar Contatos'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Result */}
          {step === 3 && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-green-500/20 bg-green-900/10 p-4 text-center">
                  <p className="text-2xl font-black text-green-400">{result.imported}</p>
                  <p className="text-xs text-green-300 mt-1">Importados</p>
                </div>
                <div className="rounded-xl border border-yellow-500/20 bg-yellow-900/10 p-4 text-center">
                  <p className="text-2xl font-black text-yellow-400">{result.skipped}</p>
                  <p className="text-xs text-yellow-300 mt-1">Ignorados</p>
                </div>
                <div className="rounded-xl border border-red-500/20 bg-red-900/10 p-4 text-center">
                  <p className="text-2xl font-black text-red-400">{result.invalid}</p>
                  <p className="text-xs text-red-300 mt-1">Inválidos</p>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="bg-surface-900/40 border border-surface-700/50 rounded-xl p-3 max-h-32 overflow-y-auto">
                  <p className="text-xs text-surface-400 font-semibold mb-1.5">Erros (primeiros {result.errors.length}):</p>
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-[11px] text-red-300">{e}</p>
                  ))}
                </div>
              )}
              <button onClick={onClose} className="btn-primary w-full">Fechar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal: Detalhe do Contato ─────────────────────────────────────────────────

function ContactDetailModal({ contactId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/contatos/${contactId}`)
      .then(r => setData(r.data))
      .catch(() => toast.error('Erro ao carregar contato'))
      .finally(() => setLoading(false))
  }, [contactId])

  const ddd = data ? getDDD(data.phone) : ''

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card w-full max-w-md p-0 overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Detalhes do Contato</h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white"><MdClose size={20}/></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin"/>
          </div>
        ) : data ? (
          <div className="p-6 space-y-5">
            {/* Avatar + name */}
            <div className="flex items-center gap-4">
              <Avatar name={data.name} phone={data.phone} size="lg" />
              <div>
                <p className="text-lg font-bold text-surface-100">
                  {data.name || <span className="text-surface-500 italic font-normal">Sem nome</span>}
                </p>
                <p className="text-sm text-surface-400 font-mono">{formatPhone(data.phone)}</p>
                {ddd && (
                  <p className="text-xs text-surface-500 mt-0.5">
                    DDD {ddd} · {DDD_STATE[ddd] || '—'} &nbsp;·&nbsp; {timeAgo(data.created_at)}
                  </p>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2">
              {data.is_blacklisted
                ? <span className="badge-red">Na Blacklist</span>
                : <span className="badge-green">Ativo</span>}
              {data.created_at && (
                <span className="text-[11px] text-surface-500">Adicionado {new Date(data.created_at).toLocaleDateString('pt-BR')}</span>
              )}
            </div>

            {/* Listas */}
            {data.listas?.length > 0 && (
              <div>
                <p className="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-2">Listas</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.listas.map(l => (
                    <span key={l.id} className="text-xs px-2.5 py-1 rounded-full font-medium"
                      style={{ background: l.cor + '22', color: l.cor, border: `1px solid ${l.cor}44` }}>
                      {l.nome}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Campanhas recentes */}
            {data.campanhas_recentes?.length > 0 && (
              <div>
                <p className="text-xs text-surface-400 font-semibold uppercase tracking-wider mb-2">Campanhas Recentes</p>
                <div className="space-y-1.5">
                  {data.campanhas_recentes.map((c, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-surface-900/40 rounded-lg px-3 py-2">
                      <span className="text-surface-300 truncate flex-1">{c.nome}</span>
                      <span className={`text-[11px] ml-2 ${c.status === 'sent' ? 'text-green-400' : c.status === 'failed' ? 'text-red-400' : 'text-surface-500'}`}>
                        {c.status === 'sent' ? '✓ Enviado' : c.status === 'failed' ? '✗ Falhou' : c.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Copy phone */}
            <button
              onClick={() => { navigator.clipboard.writeText(data.phone); toast.success('Telefone copiado!') }}
              className="btn-secondary w-full flex items-center justify-center gap-2 text-sm">
              <MdContentCopy size={16}/> Copiar Telefone
            </button>
          </div>
        ) : (
          <p className="p-6 text-center text-surface-500">Contato não encontrado</p>
        )}
      </div>
    </div>
  )
}

// ── Componente Principal ──────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function Contatos() {
  // Data
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState({ total: 0, com_nome: 0, sem_nome: 0, hoje: 0, blacklist: 0 })
  const [listas, setListas] = useState([])

  // Filters
  const [search, setSearch] = useState('')
  const [selectedLista, setSelectedLista] = useState(null) // null=todos, 'sem_lista'=sem lista, number=lista id
  const [filterDDD, setFilterDDD] = useState('')
  const [filterStatus, setFilterStatus] = useState('') // '' | 'active' | 'blacklist'
  const [filterDataInicio, setFilterDataInicio] = useState('')
  const [filterDataFim, setFilterDataFim] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Selection
  const [selected, setSelected] = useState(new Set())

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showListaModal, setShowListaModal] = useState(false)
  const [showAddToListaModal, setShowAddToListaModal] = useState(false)
  const [detailContactId, setDetailContactId] = useState(null)
  const [backupInfo, setBackupInfo] = useState(null)

  // ── Load ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    api.get('/contatos/backup/info').then(r => setBackupInfo(r.data)).catch(() => {})
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/contatos/stats')
      setStats(data)
    } catch {}
  }, [])

  const loadListas = useCallback(async () => {
    try {
      const { data } = await api.get('/listas')
      setListas(Array.isArray(data) ? data : (data?.items ?? []))
    } catch {}
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, page_size: PAGE_SIZE })
      if (search) params.set('search', search)
      if (filterStatus === 'active') params.set('blacklisted', 'false')
      if (filterStatus === 'blacklist') params.set('blacklisted', 'true')
      if (filterDDD) params.set('ddd', filterDDD)
      if (typeof selectedLista === 'number') params.set('lista_id', selectedLista)
      if (selectedLista === 'sem_lista') params.set('sem_lista', 'true')
      if (filterDataInicio) params.set('data_inicio', filterDataInicio + 'T00:00:00')
      if (filterDataFim) params.set('data_fim', filterDataFim + 'T23:59:59')

      const { data } = await api.get(`/contatos?${params}`)
      setContacts(data.items ?? [])
      setTotal(data.total)
    } catch {
      toast.error('Erro ao carregar contatos')
    } finally {
      setLoading(false)
    }
  }, [page, search, filterStatus, filterDDD, selectedLista, filterDataInicio, filterDataFim])

  useEffect(() => { load(); loadStats(); loadListas() }, [])
  useEffect(() => { load() }, [load])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const activeFiltersCount = [search, filterDDD, filterStatus, filterDataInicio, filterDataFim]
    .filter(Boolean).length

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function resetFilters() {
    setSearch(''); setFilterDDD(''); setFilterStatus('')
    setFilterDataInicio(''); setFilterDataFim(''); setPage(1)
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    if (selected.size === contacts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(contacts.map(c => c.id)))
    }
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async function bulkBlacklist(blacklist) {
    try {
      const { data } = await api.post('/contatos/blacklist/bulk', {
        contact_ids: [...selected], blacklist
      })
      toast.success(`${data.updated} contatos ${blacklist ? 'bloqueados' : 'desbloqueados'}`)
      setSelected(new Set())
      load(); loadStats()
    } catch { toast.error('Erro') }
  }

  async function bulkDelete() {
    if (!confirm(`Deletar ${selected.size} contatos? Esta ação não pode ser desfeita.`)) return
    try {
      const { data } = await api.delete('/contatos/bulk', { data: { contact_ids: [...selected] } })
      toast.success(`${data.deleted} contatos deletados`)
      setSelected(new Set())
      load(); loadStats()
    } catch { toast.error('Erro ao deletar') }
  }

  async function exportSelected() {
    const ids = [...selected].join(',')
    try {
      const resp = await api.get('/contatos/exportar/xlsx', { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a'); a.href = url; a.download = 'contatos_selecionados.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao exportar') }
  }

  async function handleExport() {
    try {
      const params = new URLSearchParams()
      if (typeof selectedLista === 'number') params.set('lista_id', selectedLista)
      const resp = await api.get(`/contatos/exportar/xlsx?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a'); a.href = url; a.download = 'contatos.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Erro ao exportar') }
  }

  async function toggleBlacklist(id) {
    try {
      const { data } = await api.post(`/contatos/${id}/blacklist`)
      toast.success(data.is_blacklisted ? 'Bloqueado' : 'Desbloqueado')
      load(); loadStats()
    } catch { toast.error('Erro') }
  }

  async function deleteContact(id) {
    if (!confirm('Deletar contato?')) return
    try {
      await api.delete(`/contatos/${id}`)
      toast.success('Contato deletado')
      load(); loadStats()
    } catch { toast.error('Erro ao deletar') }
  }

  async function deleteLista(id) {
    if (!confirm('Deletar lista? Os contatos não serão removidos.')) return
    try {
      await api.delete(`/listas/${id}`)
      toast.success('Lista deletada')
      if (selectedLista === id) setSelectedLista(null)
      loadListas()
    } catch { toast.error('Erro ao deletar lista') }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const selAll = selected.size > 0 && selected.size === contacts.length
  const selSome = selected.size > 0 && selected.size < contacts.length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Contatos</h1>
          <p className="text-sm text-surface-400 mt-1">{total.toLocaleString('pt-BR')} contatos encontrados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowImportModal(true)} className="btn-secondary flex items-center gap-2 text-sm px-3 md:px-4">
            <MdUpload size={16}/> <span className="hidden sm:inline">Importar CSV</span>
          </button>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm px-3 md:px-4">
            <MdDownload size={16}/> <span className="hidden sm:inline">Exportar</span>
          </button>
          {backupInfo?.available && (
            <a
              href="/api/contatos/backup/download"
              download={backupInfo.filename}
              className="btn-secondary flex items-center gap-2 text-sm px-3 md:px-4"
              title={`Backup de ${backupInfo.contact_count?.toLocaleString('pt-BR')} contatos`}
            >
              <MdDownload size={16}/> <span className="hidden sm:inline">📥 Backup</span>
            </a>
          )}
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-2 text-sm px-3 md:px-4">
            <MdAdd size={18}/> <span className="hidden sm:inline">Novo Contato</span>
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard value={stats.total} label="Total" color="text-primary-400" />
        <StatCard value={stats.com_nome} label="Com nome" sub={`${stats.sem_nome} sem nome`} color="text-green-400" />
        <StatCard value={stats.hoje} label="Hoje" color="text-yellow-400" />
        <StatCard value={stats.blacklist} label="Blacklist" color="text-red-400" />
      </div>

      {/* Layout: sidebar + main */}
      <div className="flex gap-5 items-start">
        {/* Sidebar: Listas */}
        <div className="hidden lg:flex flex-col gap-1 w-52 flex-shrink-0">
          <div className="flex items-center justify-between mb-1 px-1">
            <span className="text-[11px] font-bold text-surface-400 uppercase tracking-wider">Listas</span>
            <button onClick={() => setShowListaModal(true)}
              className="text-xs text-primary-400 hover:text-primary-300 font-semibold flex items-center gap-0.5">
              <MdAdd size={14}/> Nova
            </button>
          </div>

          {/* All contacts */}
          {[
            { key: null, label: 'Todos os contatos', count: stats.total, icon: '📋' },
            { key: 'sem_lista', label: 'Sem lista', count: null, icon: '📂' },
          ].map(item => (
            <button key={String(item.key)} onClick={() => { setSelectedLista(item.key); setPage(1) }}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all text-left w-full ${selectedLista === item.key ? 'bg-primary-900/30 text-primary-300 border border-primary-500/30' : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/50'}`}>
              <span className="text-base">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.count != null && (
                <span className="text-[10px] text-surface-500 font-semibold">{item.count}</span>
              )}
            </button>
          ))}

          {listas.length > 0 && <div className="border-t border-surface-800/50 my-1"/>}

          {listas.map(lst => (
            <div key={lst.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl transition-all group ${selectedLista === lst.id ? 'bg-primary-900/30 border border-primary-500/30' : 'hover:bg-surface-800/50'}`}>
              <button onClick={() => { setSelectedLista(lst.id); setPage(1) }}
                className="flex items-center gap-2 flex-1 min-w-0 text-left">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: lst.cor }}/>
                <span className={`text-sm truncate flex-1 font-medium ${selectedLista === lst.id ? 'text-primary-300' : 'text-surface-400 group-hover:text-surface-200'}`}>
                  {lst.nome}
                </span>
                <span className="text-[10px] text-surface-500">{lst.total_contatos}</span>
              </button>
              <button onClick={() => deleteLista(lst.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-surface-600 hover:text-red-400 transition-all">
                <MdClose size={13}/>
              </button>
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Filter bar */}
          <div className="glass-card p-3 space-y-3">
            <div className="flex gap-2 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" size={16}/>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Buscar por nome ou telefone..."
                  className="input pl-9 text-sm py-2 w-full" />
              </div>
              {/* DDD filter */}
              <select value={filterDDD} onChange={e => { setFilterDDD(e.target.value); setPage(1) }}
                className="input w-32 text-sm py-2">
                <option value="">Todos DDDs</option>
                {Object.entries(DDD_STATE).sort().map(([ddd, uf]) => (
                  <option key={ddd} value={ddd}>{ddd} · {uf}</option>
                ))}
              </select>
              {/* Status filter */}
              <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
                className="input w-36 text-sm py-2">
                <option value="">Todos status</option>
                <option value="active">Ativos</option>
                <option value="blacklist">Blacklist</option>
              </select>
              {/* Advanced toggle */}
              <button onClick={() => setShowFilters(f => !f)}
                className={`btn-secondary flex items-center gap-1.5 text-sm px-3 py-2 relative ${showFilters ? 'border-primary-500/50 text-primary-400' : ''}`}>
                <MdFilterList size={16}/>
                <span className="hidden sm:inline">Filtros</span>
                {activeFiltersCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary-500 text-white text-[10px] flex items-center justify-center font-bold">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
              {/* Clear */}
              {activeFiltersCount > 0 && (
                <button onClick={resetFilters} className="text-xs text-surface-400 hover:text-red-400 flex items-center gap-1 px-2">
                  <MdClose size={14}/> Limpar
                </button>
              )}
              {/* Refresh */}
              <button onClick={() => { load(); loadStats(); loadListas() }}
                className="btn-secondary p-2">
                <MdRefresh size={16}/>
              </button>
            </div>

            {/* Advanced filters (date) */}
            {showFilters && (
              <div className="flex flex-wrap gap-3 pt-1 border-t border-surface-800/50">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-surface-400 font-medium whitespace-nowrap">De:</label>
                  <input type="date" value={filterDataInicio} onChange={e => { setFilterDataInicio(e.target.value); setPage(1) }}
                    className="input text-sm py-1.5 w-40" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-surface-400 font-medium whitespace-nowrap">Até:</label>
                  <input type="date" value={filterDataFim} onChange={e => { setFilterDataFim(e.target.value); setPage(1) }}
                    className="input text-sm py-1.5 w-40" />
                </div>
              </div>
            )}
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary-500/30 bg-primary-900/20 flex-wrap">
              <span className="text-sm font-bold text-primary-300">{selected.size} selecionados</span>
              <div className="flex items-center gap-2 flex-wrap ml-2">
                <button onClick={() => setShowAddToListaModal(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/50 transition-colors">
                  <MdLabel size={14}/> Adicionar à lista
                </button>
                <button onClick={() => bulkBlacklist(true)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-amber-900/20 hover:bg-amber-900/40 text-amber-300 border border-amber-500/20 transition-colors">
                  <MdBlock size={14}/> Blacklist
                </button>
                <button onClick={() => bulkBlacklist(false)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-900/20 hover:bg-green-900/40 text-green-300 border border-green-500/20 transition-colors">
                  <MdBlock size={14}/> Desbloquear
                </button>
                <button onClick={exportSelected}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700/50 transition-colors">
                  <MdDownload size={14}/> Exportar
                </button>
                <button onClick={bulkDelete}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-900/20 hover:bg-red-900/40 text-red-300 border border-red-500/20 transition-colors">
                  <MdDelete size={14}/> Deletar
                </button>
              </div>
              <button onClick={() => setSelected(new Set())}
                className="ml-auto text-surface-400 hover:text-white p-1">
                <MdClose size={16}/>
              </button>
            </div>
          )}

          {/* Table */}
          <div className="glass-card overflow-hidden p-0">
            {loading && contacts.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin"/>
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-sm" style={{ minWidth: 560 }}>
                  <thead className="bg-surface-900/50">
                    <tr className="text-left text-surface-400 border-b border-surface-700/50">
                      <th className="px-4 py-3 w-10">
                        <button onClick={selectAll} className="text-surface-400 hover:text-primary-400">
                          {selAll ? <MdCheckBox size={18} className="text-primary-400"/>
                            : selSome ? <MdIndeterminateCheckBox size={18} className="text-primary-400"/>
                            : <MdCheckBoxOutlineBlank size={18}/>}
                        </button>
                      </th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs">Contato</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs hidden md:table-cell">DDD</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs hidden lg:table-cell">Lista</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs hidden sm:table-cell">Status</th>
                      <th className="px-3 py-3 font-semibold uppercase tracking-wider text-xs hidden xl:table-cell">Adicionado</th>
                      <th className="px-3 py-3 font-semibold text-xs text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/50">
                    {contacts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-16 text-center">
                          <div className="flex flex-col items-center justify-center text-surface-500">
                            <MdSearch size={40} className="mb-3 text-surface-700"/>
                            <p className="font-medium text-surface-400">Nenhum contato encontrado</p>
                            <p className="text-xs mt-1">Tente ajustar os filtros ou importar contatos</p>
                          </div>
                        </td>
                      </tr>
                    ) : contacts.map(c => {
                      const ddd = getDDD(c.phone)
                      const isSelected = selected.has(c.id)
                      return (
                        <tr key={c.id}
                          className={`hover:bg-surface-800/30 transition-colors group ${isSelected ? 'bg-primary-900/10' : ''}`}>
                          {/* Checkbox */}
                          <td className="px-4 py-3">
                            <button onClick={() => toggleSelect(c.id)} className="text-surface-400 hover:text-primary-400">
                              {isSelected
                                ? <MdCheckBox size={18} className="text-primary-400"/>
                                : <MdCheckBoxOutlineBlank size={18}/>}
                            </button>
                          </td>

                          {/* Contact (avatar + name + phone) */}
                          <td className="px-3 py-3">
                            <button onClick={() => setDetailContactId(c.id)} className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity w-full">
                              <Avatar name={c.name} phone={c.phone}/>
                              <div className="min-w-0">
                                <p className="font-semibold text-surface-200 truncate group-hover:text-primary-300 transition-colors">
                                  {c.name || <span className="text-surface-500 italic font-normal text-xs">Sem nome</span>}
                                </p>
                                <p className="text-[11px] text-surface-500 font-mono truncate">{formatPhone(c.phone)}</p>
                              </div>
                            </button>
                          </td>

                          {/* DDD */}
                          <td className="px-3 py-3 hidden md:table-cell">
                            {ddd ? (
                              <span className="text-xs font-semibold text-surface-400">
                                {ddd} <span className="text-surface-600">·</span> <span className="text-surface-500">{DDD_STATE[ddd] || '??'}</span>
                              </span>
                            ) : <span className="text-surface-700">—</span>}
                          </td>

                          {/* Lista */}
                          <td className="px-3 py-3 hidden lg:table-cell">
                            {/* We'll show tags if available */}
                            {c.tags ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-800 text-surface-400 border border-surface-700/50">
                                {c.tags}
                              </span>
                            ) : <span className="text-surface-700 text-xs">—</span>}
                          </td>

                          {/* Status */}
                          <td className="px-3 py-3 hidden sm:table-cell">
                            {c.is_blacklisted
                              ? <span className="badge-red text-[11px]">Blacklist</span>
                              : <span className="badge-green text-[11px]">Ativo</span>}
                          </td>

                          {/* Date */}
                          <td className="px-3 py-3 hidden xl:table-cell text-xs text-surface-500">
                            {timeAgo(c.created_at)}
                          </td>

                          {/* Actions */}
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { navigator.clipboard.writeText(c.phone); toast.success('Copiado!') }}
                                className="p-1.5 rounded-lg text-surface-600 hover:text-surface-300 hover:bg-surface-800 transition-all opacity-0 group-hover:opacity-100"
                                title="Copiar telefone">
                                <MdContentCopy size={15}/>
                              </button>
                              <button
                                onClick={() => toggleBlacklist(c.id)}
                                className={`p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${c.is_blacklisted ? 'text-primary-400 hover:bg-primary-900/30' : 'text-amber-400 hover:bg-amber-900/30'}`}
                                title={c.is_blacklisted ? 'Remover da blacklist' : 'Blacklist'}>
                                <MdBlock size={15}/>
                              </button>
                              <button
                                onClick={() => deleteContact(c.id)}
                                className="p-1.5 rounded-lg text-surface-600 hover:text-red-400 hover:bg-red-900/20 transition-all opacity-0 group-hover:opacity-100"
                                title="Deletar">
                                <MdDelete size={15}/>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-surface-700/50 bg-surface-900/30">
                <span className="text-xs text-surface-500 font-medium">
                  Mostrando {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} de {total.toLocaleString('pt-BR')}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="p-1.5 rounded-lg border border-surface-700/50 text-surface-400 hover:text-white hover:border-surface-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    <MdChevronLeft size={18}/>
                  </button>
                  <span className="px-3 py-1.5 text-xs text-surface-300 font-medium">{page} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="p-1.5 rounded-lg border border-surface-700/50 text-surface-400 hover:text-white hover:border-surface-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                    <MdChevronRight size={18}/>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddModal && (
        <AddContactModal onClose={() => setShowAddModal(false)} onSave={() => { load(); loadStats() }} />
      )}
      {showImportModal && (
        <ImportCSVModal listas={listas} onClose={() => setShowImportModal(false)}
          onDone={() => { load(); loadStats(); loadListas() }} />
      )}
      {showListaModal && (
        <CreateListaModal onClose={() => setShowListaModal(false)} onSave={() => loadListas()} />
      )}
      {showAddToListaModal && (
        <AddToListaModal selectedIds={selected} listas={listas}
          onClose={() => setShowAddToListaModal(false)}
          onDone={() => { load(); loadListas() }} />
      )}
      {detailContactId && (
        <ContactDetailModal contactId={detailContactId} onClose={() => setDetailContactId(null)} />
      )}
    </div>
  )
}
