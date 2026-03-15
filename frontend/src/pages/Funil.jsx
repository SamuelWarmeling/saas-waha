import { useState, useEffect, useCallback } from 'react'
import {
  MdAdd, MdDelete, MdEdit, MdVisibility, MdPlayArrow, MdPause,
  MdPeople, MdClose, MdCheck, MdLocalFireDepartment, MdStar,
  MdMessage, MdThermostat, MdOutlineCircle, MdExpandMore,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPhone(phone) {
  if (!phone) return ''
  const raw = phone.replace(/\D/g, '')
  if (raw.startsWith('55') && raw.length >= 12) {
    const local = raw.slice(2)
    const ddd = local.slice(0, 2)
    const num = local.slice(2)
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`
    return `(${ddd}) ${num}`
  }
  return phone
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

const TEMP_CONFIG = {
  frio:      { label: 'Frio',      emoji: '🧊', color: '#64748b', bg: 'rgba(100,116,139,0.15)', border: 'rgba(100,116,139,0.3)' },
  morno:     { label: 'Morno',     emoji: '🌡️', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
  quente:    { label: 'Quente',    emoji: '🔥', color: '#f97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)' },
  convertido:{ label: 'Convertido',emoji: '⭐', color: '#eab308', bg: 'rgba(234,179,8,0.15)',  border: 'rgba(234,179,8,0.3)' },
}

const STATUS_CONFIG = {
  ativo:      { label: 'Ativo',     emoji: '🔵', cls: 'badge-primary' },
  respondeu:  { label: 'Respondeu', emoji: '💬', cls: 'badge-green' },
  concluido:  { label: 'Concluído', emoji: '✅', cls: 'badge-gray' },
  cancelado:  { label: 'Cancelado', emoji: '❌', cls: 'badge-red' },
}

const HORAS_OPCOES = [0, 1, 2, 4, 6, 8, 12, 24, 48, 72, 96, 120, 168]

const ETAPAS_PADRAO = [
  { ordem: 1, mensagem: 'Olá {nome}! Vimos que você se interessou pelo nosso produto. Podemos ajudar?', aguardar_horas: 0 },
  { ordem: 2, mensagem: 'Oi, tudo bem? Só passando para saber se ficou alguma dúvida sobre o que conversamos 😊', aguardar_horas: 24 },
  { ordem: 3, mensagem: 'Olá! Não quero perder o contato com você. Temos uma condição especial válida por hoje. Posso te mostrar?', aguardar_horas: 72 },
  { ordem: 4, mensagem: 'Última tentativa de contato 🙏 Se tiver interesse, estou aqui! Caso contrário, sem problemas — sucesso pra você!', aguardar_horas: 168 },
]

// ── Funil visual (gráfico) ────────────────────────────────────────────────────

function FunnelChart({ total, ativos, responderam, convertidos }) {
  const niveis = [
    { label: 'Total', count: total, pct: 100, color: '#22D3EE' },
    { label: 'Ativos', count: ativos, pct: total > 0 ? Math.round(ativos / total * 100) : 0, color: '#06B6D4' },
    { label: 'Responderam', count: responderam, pct: total > 0 ? Math.round(responderam / total * 100) : 0, color: '#10b981' },
    { label: 'Convertidos', count: convertidos, pct: total > 0 ? Math.round(convertidos / total * 100) : 0, color: '#eab308' },
  ]
  return (
    <div className="space-y-2 py-2">
      {niveis.map((n, i) => (
        <div key={n.label} className="flex items-center gap-3">
          <div className="w-20 text-right text-xs font-medium text-surface-400 flex-shrink-0">{n.label}</div>
          <div
            className="h-7 rounded-lg flex items-center justify-end pr-2 transition-all duration-700"
            style={{
              width: `${Math.max(n.pct, 4)}%`,
              background: `${n.color}22`,
              border: `1px solid ${n.color}44`,
            }}
          >
            <span className="text-xs font-bold" style={{ color: n.color }}>{n.count}</span>
          </div>
          <div className="text-xs text-surface-500 flex-shrink-0">{n.pct}%</div>
        </div>
      ))}
    </div>
  )
}

// ── Modal Nova/Editar Sequência ───────────────────────────────────────────────

function ModalSequencia({ seq, sessoes, onSave, onClose }) {
  const editando = !!seq
  const [nome, setNome] = useState(seq?.nome ?? '')
  const [etapas, setEtapas] = useState(
    seq?.mensagens?.length
      ? seq.mensagens.map(m => ({ ordem: m.ordem, mensagem: m.mensagem, aguardar_horas: m.aguardar_horas }))
      : ETAPAS_PADRAO
  )
  const [sessionId, setSessionId] = useState(sessoes[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  function addEtapa() {
    setEtapas(prev => [
      ...prev,
      { ordem: prev.length + 1, mensagem: '', aguardar_horas: 24 },
    ])
  }

  function removeEtapa(idx) {
    setEtapas(prev => prev.filter((_, i) => i !== idx).map((e, i) => ({ ...e, ordem: i + 1 })))
  }

  function updateEtapa(idx, field, value) {
    setEtapas(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e))
  }

  async function salvar() {
    if (!nome.trim()) { toast.error('Informe o nome da sequência'); return }
    if (etapas.some(e => !e.mensagem.trim())) { toast.error('Preencha todas as mensagens'); return }
    setSaving(true)
    try {
      const payload = {
        nome: nome.trim(),
        mensagens: etapas.map(e => ({
          ordem: e.ordem,
          mensagem: e.mensagem,
          tipo: 'texto',
          aguardar_horas: Number(e.aguardar_horas),
        })),
      }
      if (editando) {
        await api.put(`/funnel/sequencias/${seq.id}`, payload)
        toast.success('Sequência atualizada!')
      } else {
        await api.post('/funnel/sequencias', payload)
        toast.success('Sequência criada!')
      }
      onSave()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl my-8 rounded-2xl border border-surface-700/50 shadow-2xl" style={{ background: '#120e1e' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/40">
          <div>
            <h2 className="text-lg font-bold text-surface-50">{editando ? 'Editar Sequência' : 'Nova Sequência'}</h2>
            <p className="text-xs text-surface-500 mt-0.5">Configure as mensagens de follow-up automático</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors">
            <MdClose size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Nome */}
          <div>
            <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider block mb-1.5">Nome da Sequência</label>
            <input
              className="input w-full"
              placeholder="Ex: Follow-up Produto X"
              value={nome}
              onChange={e => setNome(e.target.value)}
            />
          </div>

          {/* Sessão (só na criação) */}
          {!editando && (
            <div>
              <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider block mb-1.5">Chip WhatsApp para envios</label>
              <select className="input w-full" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                {sessoes.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.phone_number ? ` (${s.phone_number})` : ''}</option>
                ))}
              </select>
            </div>
          )}

          {/* Etapas */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Mensagens da sequência</label>
              <button
                onClick={addEtapa}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-300 border border-primary-500/30 hover:bg-primary-500/10 transition-colors"
              >
                <MdAdd size={16} /> Adicionar etapa
              </button>
            </div>

            <div className="space-y-3">
              {etapas.map((e, idx) => (
                <div key={idx} className="rounded-xl border border-surface-700/40 p-4 space-y-3" style={{ background: '#1a1425' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-primary-500/20 border border-primary-500/30 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-primary-300">{e.ordem}</span>
                      </div>
                      <span className="text-xs font-semibold text-surface-300">
                        {idx === 0 ? 'Mensagem inicial' : `Follow-up ${idx}`}
                      </span>
                    </div>
                    {etapas.length > 1 && (
                      <button onClick={() => removeEtapa(idx)} className="p-1 rounded hover:bg-red-900/30 text-surface-500 hover:text-red-400 transition-colors">
                        <MdDelete size={15} />
                      </button>
                    )}
                  </div>
                  <textarea
                    className="input w-full text-sm resize-none"
                    rows={3}
                    placeholder={`Mensagem da etapa ${e.ordem}...`}
                    value={e.mensagem}
                    onChange={ev => updateEtapa(idx, 'mensagem', ev.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-surface-500">Enviar</span>
                    <select
                      className="input text-xs py-1 px-2"
                      value={e.aguardar_horas}
                      onChange={ev => updateEtapa(idx, 'aguardar_horas', ev.target.value)}
                    >
                      {HORAS_OPCOES.map(h => (
                        <option key={h} value={h}>
                          {h === 0 ? 'imediatamente' : h < 24 ? `após ${h}h` : h === 24 ? 'após 1 dia' : h === 48 ? 'após 2 dias' : h === 72 ? 'após 3 dias' : h === 168 ? 'após 7 dias' : `após ${h}h`}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-surface-500">da mensagem anterior</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-surface-700/40 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            Cancelar
          </button>
          <button onClick={salvar} disabled={saving} className="btn-primary px-6 py-2 text-sm">
            {saving ? 'Salvando...' : editando ? 'Salvar alterações' : 'Criar Sequência'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Adicionar Contatos ──────────────────────────────────────────────────

function ModalAdicionarContatos({ seqId, sessoes, onSave, onClose }) {
  const [contatos, setContatos] = useState([])
  const [selecionados, setSelecionados] = useState(new Set())
  const [sessionId, setSessionId] = useState(sessoes[0]?.id ?? '')
  const [busca, setBusca] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/contatos?page_size=500').then(r => {
      const lista = Array.isArray(r.data) ? r.data : (r.data.items ?? [])
      setContatos(lista.filter(c => !c.is_blacklisted))
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtrados = contatos.filter(c => {
    const q = busca.toLowerCase()
    return !q || (c.name || '').toLowerCase().includes(q) || c.phone.includes(q)
  })

  function toggle(id) {
    setSelecionados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selecionados.size === filtrados.length) {
      setSelecionados(new Set())
    } else {
      setSelecionados(new Set(filtrados.map(c => c.id)))
    }
  }

  async function adicionar() {
    if (selecionados.size === 0) { toast.error('Selecione ao menos 1 contato'); return }
    if (!sessionId) { toast.error('Selecione um chip'); return }
    setSaving(true)
    try {
      const r = await api.post(`/funnel/sequencias/${seqId}/adicionar-contatos`, {
        contato_ids: [...selecionados],
        session_id: Number(sessionId),
      })
      toast.success(`${r.data.adicionados} contatos adicionados!`)
      onSave()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao adicionar contatos')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg rounded-2xl border border-surface-700/50 shadow-2xl flex flex-col" style={{ background: '#120e1e', maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/40 flex-shrink-0">
          <h2 className="text-lg font-bold text-surface-50">Adicionar Contatos</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 transition-colors">
            <MdClose size={20} />
          </button>
        </div>

        <div className="px-6 pt-4 flex-shrink-0 space-y-3">
          <select className="input w-full text-sm" value={sessionId} onChange={e => setSessionId(e.target.value)}>
            {sessoes.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div className="relative">
            <input className="input w-full text-sm pl-3" placeholder="Buscar contato..." value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <div className="flex items-center justify-between text-xs text-surface-400">
            <button onClick={toggleAll} className="hover:text-primary-300 transition-colors font-medium">
              {selecionados.size === filtrados.length ? 'Desmarcar todos' : 'Selecionar todos'}
            </button>
            <span>{selecionados.size} selecionados</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="text-center py-8 text-surface-500 text-sm">Carregando...</div>
          ) : filtrados.length === 0 ? (
            <div className="text-center py-8 text-surface-500 text-sm">Nenhum contato encontrado</div>
          ) : (
            <div className="space-y-1">
              {filtrados.map(c => (
                <label key={c.id} className="flex items-center gap-3 p-2.5 rounded-xl cursor-pointer hover:bg-surface-800/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={selecionados.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="w-4 h-4 accent-purple-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-200 truncate">{c.name || formatPhone(c.phone)}</p>
                    {c.name && <p className="text-xs text-surface-500 font-mono">{formatPhone(c.phone)}</p>}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-surface-700/40 flex justify-end gap-3 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            Cancelar
          </button>
          <button onClick={adicionar} disabled={saving} className="btn-primary px-6 py-2 text-sm">
            {saving ? 'Adicionando...' : `Adicionar ${selecionados.size > 0 ? selecionados.size : ''} contatos`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Detalhes da Sequência ───────────────────────────────────────────────

function ModalDetalhes({ seq, sessoes, onClose, onUpdate }) {
  const [contatos, setContatos] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddContatos, setShowAddContatos] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)

  const carregar = useCallback(() => {
    setLoading(true)
    api.get(`/funnel/sequencias/${seq.id}/contatos`)
      .then(r => setContatos(r.data))
      .catch(() => toast.error('Erro ao carregar contatos'))
      .finally(() => setLoading(false))
  }, [seq.id])

  useEffect(() => { carregar() }, [carregar])

  async function mudarTemperatura(fcId, temp) {
    setUpdatingId(fcId)
    try {
      await api.put(`/funnel/contatos/${fcId}/status`, { temperatura: temp })
      setContatos(prev => prev.map(c => c.id === fcId ? { ...c, temperatura: temp } : c))
    } catch {
      toast.error('Erro ao atualizar temperatura')
    } finally {
      setUpdatingId(null)
    }
  }

  const total = contatos.length
  const ativos = contatos.filter(c => c.status === 'ativo').length
  const responderam = contatos.filter(c => c.status === 'respondeu').length
  const convertidos = contatos.filter(c => c.temperatura === 'convertido').length
  const concluidos = contatos.filter(c => c.status === 'concluido').length

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
        <div className="w-full max-w-4xl my-8 rounded-2xl border border-surface-700/50 shadow-2xl" style={{ background: '#120e1e' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/40">
            <div>
              <h2 className="text-lg font-bold text-surface-50">{seq.nome}</h2>
              <p className="text-xs text-surface-500 mt-0.5">{seq.total_mensagens} etapas · {total} contatos</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddContatos(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-primary-500/15 border border-primary-500/30 text-primary-300 hover:bg-primary-500/25 transition-colors"
              >
                <MdAdd size={16} /> Adicionar Contatos
              </button>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 transition-colors">
                <MdClose size={20} />
              </button>
            </div>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 pt-5">
            {[
              { label: 'Total', value: total, color: '#22D3EE', emoji: '👥' },
              { label: 'Ativos', value: ativos, color: '#3b82f6', emoji: '🔵' },
              { label: 'Responderam', value: responderam, color: '#10b981', emoji: '💬' },
              { label: 'Convertidos', value: convertidos, color: '#eab308', emoji: '⭐' },
            ].map(card => (
              <div key={card.label} className="rounded-xl p-4 border" style={{ background: `${card.color}11`, borderColor: `${card.color}30` }}>
                <div className="text-lg mb-1">{card.emoji}</div>
                <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</div>
                <div className="text-xs text-surface-500 mt-0.5">{card.label}</div>
              </div>
            ))}
          </div>

          {/* Funil visual */}
          <div className="px-6 pt-4 pb-2">
            <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Funil de Conversão</h3>
            <FunnelChart total={total} ativos={ativos} responderam={responderam} convertidos={convertidos} />
          </div>

          {/* Tabela de contatos */}
          <div className="px-6 pt-4 pb-6">
            <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">Contatos</h3>
            {loading ? (
              <div className="py-8 text-center text-surface-500 text-sm">Carregando...</div>
            ) : contatos.length === 0 ? (
              <div className="py-10 text-center">
                <div className="text-4xl mb-3">📭</div>
                <p className="text-surface-400 text-sm">Nenhum contato nesta sequência</p>
                <button onClick={() => setShowAddContatos(true)} className="mt-3 btn-primary text-sm px-4 py-2">
                  Adicionar contatos
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-surface-500 border-b border-surface-700/40">
                      <th className="pb-2 px-2 font-medium">Contato</th>
                      <th className="pb-2 px-2 font-medium text-center">Etapa</th>
                      <th className="pb-2 px-2 font-medium text-center">Status</th>
                      <th className="pb-2 px-2 font-medium text-center">Temperatura</th>
                      <th className="pb-2 px-2 font-medium">Último contato</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800/40">
                    {contatos.map(c => {
                      const stCfg = STATUS_CONFIG[c.status] || { label: c.status, emoji: '?', cls: 'badge-gray' }
                      const tCfg = TEMP_CONFIG[c.temperatura] || TEMP_CONFIG.frio
                      return (
                        <tr key={c.id} className="hover:bg-surface-800/20 transition-colors">
                          <td className="py-3 px-2">
                            <p className="font-medium text-surface-200 truncate max-w-[140px]">{c.nome || formatPhone(c.telefone)}</p>
                            {c.nome && <p className="text-xs text-surface-500 font-mono mt-0.5">{formatPhone(c.telefone)}</p>}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <span className="text-xs font-bold text-primary-300 bg-primary-900/30 border border-primary-500/25 px-2 py-0.5 rounded-md">
                              {c.etapa_atual}/{c.total_etapas}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-center">
                            <span className={stCfg.cls}>
                              {stCfg.emoji} {stCfg.label}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-center">
                            <select
                              disabled={updatingId === c.id}
                              value={c.temperatura}
                              onChange={e => mudarTemperatura(c.id, e.target.value)}
                              className="text-xs px-2 py-1 rounded-lg border cursor-pointer transition-colors"
                              style={{
                                background: tCfg.bg,
                                borderColor: tCfg.border,
                                color: tCfg.color,
                              }}
                            >
                              {Object.entries(TEMP_CONFIG).map(([val, cfg]) => (
                                <option key={val} value={val} style={{ background: '#1a1425', color: '#e2e8f0' }}>
                                  {cfg.emoji} {cfg.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-3 px-2 text-xs text-surface-400">
                            {formatDate(c.ultimo_envio)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddContatos && (
        <ModalAdicionarContatos
          seqId={seq.id}
          sessoes={sessoes}
          onSave={() => { setShowAddContatos(false); carregar(); onUpdate() }}
          onClose={() => setShowAddContatos(false)}
        />
      )}
    </>
  )
}

// ── Card de Sequência ─────────────────────────────────────────────────────────

function CardSequencia({ seq, onDetalhes, onEditar, onPausarRetomar, onDeletar }) {
  const taxa = seq.taxa_conversao ?? 0
  const statusAtivo = seq.status === 'ativo'

  return (
    <div className="glass-card flex flex-col gap-4" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-surface-100 text-base truncate">{seq.nome}</h3>
            <span className={statusAtivo ? 'badge-green' : 'badge-gray'}>
              {statusAtivo ? '▶ Ativo' : '⏸ Pausado'}
            </span>
          </div>
          <p className="text-xs text-surface-500 mt-1">
            {seq.total_mensagens} etapas · {seq.total_contatos} contatos
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl py-2 px-1" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)' }}>
          <div className="text-xl font-bold text-blue-400">{seq.ativos}</div>
          <div className="text-[10px] text-surface-500 mt-0.5">Ativos</div>
        </div>
        <div className="rounded-xl py-2 px-1" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <div className="text-xl font-bold text-emerald-400">{seq.responderam}</div>
          <div className="text-[10px] text-surface-500 mt-0.5">Responderam</div>
        </div>
        <div className="rounded-xl py-2 px-1" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }}>
          <div className="text-xl font-bold text-yellow-400">{seq.convertidos}</div>
          <div className="text-[10px] text-surface-500 mt-0.5">Convertidos</div>
        </div>
      </div>

      {/* Barra de conversão */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-surface-500">Taxa de conversão</span>
          <span className="text-xs font-bold text-yellow-400">{taxa}%</span>
        </div>
        <div className="h-2 rounded-full bg-surface-800/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${taxa}%`,
              background: 'linear-gradient(90deg, #22D3EE, #eab308)',
            }}
          />
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-surface-700/30">
        <button
          onClick={() => onDetalhes(seq)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-primary-300 bg-primary-500/10 border border-primary-500/25 hover:bg-primary-500/20 transition-colors"
        >
          <MdVisibility size={14} /> Detalhes
        </button>
        <button
          onClick={() => onPausarRetomar(seq)}
          className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
            statusAtivo
              ? 'text-yellow-300 bg-yellow-500/10 border-yellow-500/25 hover:bg-yellow-500/20'
              : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25 hover:bg-emerald-500/20'
          }`}
        >
          {statusAtivo ? <><MdPause size={14} /> Pausar</> : <><MdPlayArrow size={14} /> Retomar</>}
        </button>
        <button
          onClick={() => onEditar(seq)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-surface-400 bg-surface-800/40 border border-surface-700/40 hover:text-surface-200 hover:bg-surface-700/40 transition-colors"
        >
          <MdEdit size={14} />
        </button>
        <button
          onClick={() => onDeletar(seq)}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-red-400/60 bg-red-900/10 border border-red-500/15 hover:text-red-400 hover:bg-red-900/25 transition-colors"
        >
          <MdDelete size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Funil() {
  const [sequencias, setSequencias] = useState([])
  const [sessoes, setSessoes] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const [modalNova, setModalNova] = useState(false)
  const [editando, setEditando] = useState(null)      // sequência para editar
  const [detalhes, setDetalhes] = useState(null)       // sequência para ver detalhes

  const carregar = useCallback(async () => {
    try {
      const [seqR, sessR, statsR] = await Promise.all([
        api.get('/funnel/sequencias'),
        api.get('/sessoes'),
        api.get('/funnel/stats'),
      ])
      setSequencias(Array.isArray(seqR.data) ? seqR.data : (seqR.data?.items ?? []))
      setSessoes(Array.isArray(sessR.data) ? sessR.data : (sessR.data.items ?? []))
      setStats(statsR.data)
    } catch {
      toast.error('Erro ao carregar dados do funil')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function pausarRetomar(seq) {
    const novoStatus = seq.status === 'ativo' ? 'pausado' : 'ativo'
    try {
      await api.put(`/funnel/sequencias/${seq.id}`, { status: novoStatus })
      toast.success(novoStatus === 'ativo' ? 'Sequência retomada!' : 'Sequência pausada!')
      carregar()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  async function deletar(seq) {
    if (!window.confirm(`Deletar sequência "${seq.nome}"? Todos os contatos serão removidos.`)) return
    try {
      await api.delete(`/funnel/sequencias/${seq.id}`)
      toast.success('Sequência deletada!')
      carregar()
    } catch {
      toast.error('Erro ao deletar')
    }
  }

  const sessoesConectadas = sessoes.filter(s => s.status === 'connected' || s.status === 'CONNECTED')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Recuperação de Leads</h1>
          <p className="text-sm text-surface-400 mt-1">Sequências automáticas de follow-up</p>
        </div>
        <button
          onClick={() => setModalNova(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <MdAdd size={18} /> Nova Sequência
        </button>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Sequências', value: stats.total_sequencias, color: '#22D3EE', emoji: '🎯' },
            { label: 'Em andamento', value: stats.total_ativos, color: '#3b82f6', emoji: '🔵' },
            { label: 'Responderam', value: stats.total_responderam, color: '#10b981', emoji: '💬' },
            { label: 'Convertidos', value: stats.total_convertidos, color: '#eab308', emoji: '⭐' },
          ].map(s => (
            <div key={s.label} className="glass-card">
              <div className="text-2xl mb-1">{s.emoji}</div>
              <div className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-surface-500 mt-1">{s.label}</div>
              {s.label === 'Convertidos' && stats.taxa_conversao > 0 && (
                <div className="text-xs font-bold mt-1" style={{ color: s.color }}>{stats.taxa_conversao}% conversão</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Aviso sem chips */}
      {sessoesConectadas.length === 0 && (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-950/20 px-5 py-4 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-orange-300">Nenhum chip WhatsApp conectado</p>
            <p className="text-xs text-orange-400/70 mt-0.5">Conecte um chip em Sessões para enviar mensagens automáticas do funil.</p>
          </div>
        </div>
      )}

      {/* Grid de sequências */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sequencias.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-4">🎯</div>
          <h3 className="text-lg font-bold text-surface-200 mb-2">Nenhuma sequência criada</h3>
          <p className="text-sm text-surface-500 max-w-sm mb-5">
            Crie sua primeira sequência de follow-up automático para recuperar leads que não responderam.
          </p>
          <button onClick={() => setModalNova(true)} className="btn-primary flex items-center gap-2 px-5 py-2.5">
            <MdAdd size={18} /> Criar primeira sequência
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {sequencias.map(seq => (
            <CardSequencia
              key={seq.id}
              seq={seq}
              onDetalhes={setDetalhes}
              onEditar={setEditando}
              onPausarRetomar={pausarRetomar}
              onDeletar={deletar}
            />
          ))}
        </div>
      )}

      {/* Modais */}
      {(modalNova || editando) && (
        <ModalSequencia
          seq={editando}
          sessoes={sessoesConectadas.length ? sessoesConectadas : sessoes}
          onSave={() => { setModalNova(false); setEditando(null); carregar() }}
          onClose={() => { setModalNova(false); setEditando(null) }}
        />
      )}

      {detalhes && (
        <ModalDetalhes
          seq={detalhes}
          sessoes={sessoesConectadas.length ? sessoesConectadas : sessoes}
          onClose={() => setDetalhes(null)}
          onUpdate={carregar}
        />
      )}
    </div>
  )
}
