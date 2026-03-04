import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdPlayArrow, MdPause, MdStop, MdDelete, MdRefresh, MdClose, MdInfo } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_LABEL = {
  draft: 'Rascunho', running: 'Rodando', paused: 'Pausado',
  completed: 'Concluído', cancelled: 'Cancelado',
}
const STATUS_CLASS = {
  draft: 'badge-gray', running: 'badge-primary', paused: 'badge-yellow',
  completed: 'badge-green', cancelled: 'badge-red',
}

const EMPTY_FORM = {
  name: '',
  messages: [''],
  session_ids: [],
  ordem_mensagens: 'aleatorio',
}

function ProgressBar({ percent }) {
  return (
    <div className="w-full bg-surface-950 border border-surface-800 shadow-inner rounded-full h-2 mt-1.5 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r from-primary-600 to-primary-400 shadow-[0_0_10px_theme(colors.primary.500/50)] relative"
        style={{ width: `${Math.min(percent, 100)}%` }}
      >
        <div className="absolute top-0 left-0 w-full h-full bg-white/20"></div>
      </div>
    </div>
  )
}

export default function Campanhas() {
  const [campaigns, setCampaigns] = useState([])
  const [sessions, setSessions] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    const [cRes, sRes] = await Promise.allSettled([
      api.get('/campanhas?page_size=50'),
      api.get('/sessoes'),
    ])
    if (cRes.status === 'fulfilled') setCampaigns(cRes.value.data)
    else toast.error('Erro ao carregar campanhas')
    if (sRes.status === 'fulfilled') setSessions(sRes.value.data)
    else toast.error('Erro ao carregar sessões')
  }, [])

  useEffect(() => { load() }, [load])

  // Polling de progresso para campanhas ativas
  useEffect(() => {
    const running = campaigns.filter(c => c.status === 'running')
    if (running.length === 0) return
    const interval = setInterval(async () => {
      const updates = await Promise.allSettled(
        running.map(c => api.get(`/campanhas/${c.id}/progresso`))
      )
      setCampaigns(prev =>
        prev.map(camp => {
          const upd = updates.find((_, i) => running[i]?.id === camp.id)
          if (upd?.status === 'fulfilled') return { ...camp, ...upd.value.data }
          return camp
        })
      )
    }, 3000)
    return () => clearInterval(interval)
  }, [campaigns])

  // ── Mensagens ──────────────────────────────────────────────────────────────

  function addMessage() {
    if (form.messages.length >= 10) return
    setForm(f => ({ ...f, messages: [...f.messages, ''] }))
  }

  function removeMessage(i) {
    if (form.messages.length <= 1) return
    setForm(f => ({ ...f, messages: f.messages.filter((_, idx) => idx !== i) }))
  }

  function updateMessage(i, val) {
    setForm(f => {
      const msgs = [...f.messages]
      msgs[i] = val
      return { ...f, messages: msgs }
    })
  }

  // ── Sessões ────────────────────────────────────────────────────────────────

  function toggleSession(id) {
    setForm(f => ({
      ...f,
      session_ids: f.session_ids.includes(id)
        ? f.session_ids.filter(s => s !== id)
        : [...f.session_ids, id],
    }))
  }

  // ── Criar campanha ────────────────────────────────────────────────────────

  async function handleCreate(e) {
    e.preventDefault()
    if (form.session_ids.length === 0) {
      toast.error('Selecione ao menos 1 chip')
      return
    }
    setLoading(true)
    try {
      await api.post('/campanhas', {
        name: form.name,
        messages: form.messages.filter(m => m.trim()),
        session_ids: form.session_ids,
        ordem_mensagens: form.ordem_mensagens,
      })
      toast.success('Campanha criada!')
      setShowModal(false)
      setForm(EMPTY_FORM)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao criar campanha')
    } finally {
      setLoading(false)
    }
  }

  async function action(id, endpoint, label) {
    try {
      await api.post(`/campanhas/${id}/${endpoint}`)
      toast.success(label)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro')
    }
  }

  async function deleteCampaign(id) {
    if (!confirm('Deletar campanha?')) return
    try {
      await api.delete(`/campanhas/${id}`)
      toast.success('Campanha deletada')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao deletar')
    }
  }

  const connectedSessions = sessions.filter(s =>
    ['connected', 'working'].includes((s.status || '').toLowerCase())
  )
  const msgCount = form.messages.filter(m => m.trim()).length
  const chipCount = form.session_ids.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Campanhas</h1>
          <p className="text-sm text-surface-400 mt-1">Gerencie seus disparos em massa</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button onClick={load} className="btn-secondary flex items-center gap-2 shadow-sm px-4">
            <MdRefresh size={18} /> Atualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2 px-5 shadow-lg shadow-primary-900/20">
            <MdAdd size={20} /> Nova Campanha
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-900/50">
              <tr className="text-left text-surface-400 border-b border-surface-700/50">
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Propriedades</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Status</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Progresso</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Desempenho</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/50">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center text-surface-500">
                    <div className="flex flex-col items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-surface-800 flex items-center justify-center mb-4 shadow-inner">
                        <MdPlayArrow className="text-3xl text-surface-600" />
                      </div>
                      <p className="font-medium text-surface-400 text-base">Nenhuma campanha criada.</p>
                      <p className="text-sm mt-1 max-w-sm">Inicie sua primeira campanha de disparos em massa clicando no botão acima.</p>
                    </div>
                  </td>
                </tr>
              ) : campaigns.map(c => {
                const pct = c.total_contacts > 0
                  ? Math.round((c.sent_count / c.total_contacts) * 100) : 0
                return (
                  <tr key={c.id} className="hover:bg-surface-800/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-bold text-surface-200 max-w-[200px] truncate group-hover:text-primary-300 transition-colors">
                        {c.name}
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1 uppercase tracking-wider font-medium flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-surface-800 border border-surface-700 font-bold flex items-center justify-center text-surface-400">{c.messages?.length ?? 1} </span> msg
                        <span className="text-surface-700">|</span>
                        <span className="w-4 h-4 rounded-full bg-surface-800 border border-surface-700 font-bold flex items-center justify-center text-surface-400">{c.session_ids?.length ?? 1} </span> chip
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`${STATUS_CLASS[c.status] || 'badge-gray'} shadow-sm px-2.5 py-1 text-[11px] uppercase tracking-wider font-bold`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 min-w-[160px]">
                      <div className="flex justify-between text-xs font-medium mb-1">
                        <span className="text-surface-400">
                          <strong className="text-surface-200">{c.sent_count}</strong> / {c.total_contacts} contatos
                        </span>
                        <span className="text-primary-400 font-bold">{pct}%</span>
                      </div>
                      <ProgressBar percent={pct} />
                    </td>
                    <td className="px-6 py-4 text-xs font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-primary-400/90"><div className="w-1.5 h-1.5 rounded-full bg-primary-500"></div> {c.success_count} concluídos</span>
                        <span className="flex items-center gap-1.5 text-red-400/90"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div> {c.fail_count} falhas</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(c.status === 'draft' || c.status === 'paused') && (
                          <button
                            onClick={() => action(c.id, 'disparar', 'Disparo iniciado!')}
                            className="p-2.5 rounded-xl bg-primary-900/10 hover:bg-primary-900/40 text-primary-400 hover:text-primary-300 transition-all border border-primary-500/20 shadow-sm shadow-primary-900/10"
                            title="Disparar"
                          >
                            <MdPlayArrow size={18} />
                          </button>
                        )}
                        {c.status === 'running' && (
                          <button
                            onClick={() => action(c.id, 'pausar', 'Campanha pausada')}
                            className="p-2.5 rounded-xl bg-yellow-900/10 hover:bg-yellow-900/40 text-yellow-500 hover:text-yellow-400 transition-all border border-yellow-500/20 shadow-sm"
                            title="Pausar"
                          >
                            <MdPause size={18} />
                          </button>
                        )}
                        {c.status !== 'completed' && c.status !== 'cancelled' && c.status !== 'draft' && (
                          <button
                            onClick={() => action(c.id, 'parar', 'Campanha parada')}
                            className="p-2.5 rounded-xl bg-red-900/10 hover:bg-red-900/40 text-red-400 transition-all border border-red-500/20 shadow-sm"
                            title="Parar"
                          >
                            <MdStop size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteCampaign(c.id)}
                          className="p-2.5 rounded-xl hover:bg-red-900/20 text-surface-500 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                          title="Excluir campanha"
                        >
                          <MdDelete size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Nova Campanha */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto animate-[fadeIn_0.2s_ease-out]">
          <div className="glass-card w-full max-w-lg my-8 p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-surface-600/50 animate-[slideIn_0.3s_ease-out]">
            <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                  <MdPlayArrow size={20} />
                </div>
                Nova Campanha
              </h2>
              <button
                onClick={() => { setShowModal(false); setForm(EMPTY_FORM) }}
                className="w-8 h-8 rounded-full bg-surface-800 flex items-center justify-center text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
                title="Fechar"
              >
                <MdClose size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-6">
              {/* Nome */}
              <div>
                <label className="label">Nome da campanha</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Promoção Junho"
                  required
                  className="input"
                />
              </div>

              {/* Mensagens */}
              <div className="bg-surface-900/30 p-5 rounded-2xl border border-surface-800/50">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-700/50">
                  <label className="label mb-0 flex-1 flex items-center gap-2">
                    <span className="text-surface-200">Mensagens</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-surface-800 text-surface-400 px-2 py-0.5 rounded border border-surface-700">
                      {form.messages.length}/10
                    </span>
                  </label>
                  {form.messages.length < 10 && (
                    <button
                      type="button"
                      onClick={addMessage}
                      className="text-xs font-semibold text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors px-2 py-1 rounded-md hover:bg-primary-500/10"
                    >
                      <MdAdd size={16} /> Adicionar Alternativa
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {form.messages.map((msg, i) => (
                    <div key={i} className="relative group">
                      <div className="absolute top-2 left-2 w-5 h-5 rounded-full bg-surface-800 border border-surface-700 flex items-center justify-center text-[10px] font-bold text-surface-400 z-10 pointer-events-none">
                        {i + 1}
                      </div>
                      <textarea
                        value={msg}
                        onChange={e => updateMessage(i, e.target.value)}
                        placeholder={`Conteúdo da mensagem...`}
                        required
                        rows={3}
                        className="input resize-none pl-9 pr-10 min-h-[80px]"
                      />
                      {form.messages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMessage(i)}
                          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-surface-800/50 text-surface-500 hover:text-red-400 hover:bg-red-900/30 transition-all flex items-center justify-center border border-transparent hover:border-red-500/20 opacity-0 group-hover:opacity-100"
                          title="Remover mensagem"
                        >
                          <MdClose size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {/* Ordem de envio */}
                <div className="mt-4 space-y-3">
                  <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Ordem de envio</p>
                  <div
                    className="flex rounded-xl p-1 gap-1"
                    style={{ background: 'rgba(11,9,20,0.6)', border: '1px solid rgba(157,78,221,0.15)' }}
                  >
                    {[
                      { value: 'aleatorio', icon: '🔀', label: 'Aleatório', desc: 'Mensagem sorteada a cada envio' },
                      { value: 'sequencial', icon: '🔢', label: 'Em ordem', desc: 'Mensagem 1 → contato 1, mensagem 2 → contato 2…' },
                    ].map(opt => {
                      const active = form.ordem_mensagens === opt.value
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, ordem_mensagens: opt.value }))}
                          className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                          style={
                            active
                              ? {
                                  background: 'linear-gradient(135deg, rgba(157,78,221,0.25), rgba(106,13,173,0.2))',
                                  color: '#b07de6',
                                  border: '1px solid rgba(157,78,221,0.4)',
                                  boxShadow: '0 0 12px rgba(157,78,221,0.15)',
                                }
                              : {
                                  color: '#64748b',
                                  background: 'transparent',
                                  border: '1px solid transparent',
                                }
                          }
                        >
                          <span className="text-base leading-none">{opt.icon}</span>
                          <div className="text-left">
                            <div>{opt.label}</div>
                            <div
                              className="text-[10px] font-normal leading-tight mt-0.5"
                              style={{ color: active ? 'rgba(176,125,230,0.7)' : '#475569' }}
                            >
                              {opt.desc}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-3 flex items-start gap-2 bg-primary-900/10 p-3 rounded-lg border border-primary-500/20">
                  <MdInfo className="text-primary-400 text-lg flex-shrink-0" />
                  <p className="text-[11px] leading-relaxed text-primary-200/70 font-medium">
                    Use a variável <span className="font-mono text-primary-300 bg-primary-900/40 px-1 py-0.5 rounded border border-primary-800/50">{'{nome}'}</span> para personalizar o texto com o nome do contato.
                  </p>
                </div>
              </div>

              {/* Chips (sessões) */}
              <div>
                <label className="label flex justify-between items-center mb-3">
                  <span className="text-surface-200">Chips WhatsApp</span>
                  <span className="text-xs text-surface-500 font-normal">Selecione as conexões de envio</span>
                </label>
                {connectedSessions.length === 0 ? (
                  <div className="p-4 rounded-xl border border-yellow-500/30 bg-yellow-900/10 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 flex-shrink-0">
                      <MdInfo size={18} />
                    </div>
                    <p className="text-sm text-yellow-500/90 font-medium">
                      Você precisa conectar um chip na página de Sessões antes de criar uma campanha.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {connectedSessions.map(s => {
                      const checked = form.session_ids.includes(s.id)
                      return (
                        <label
                          key={s.id}
                          className={`flex justify-between items-center p-3.5 rounded-xl border cursor-pointer transition-all ${checked
                              ? 'border-primary-500/50 bg-primary-900/20 shadow-[0_0_15px_theme(colors.primary.900/30)]'
                              : 'border-surface-700 bg-surface-900/30 hover:border-surface-500 hover:bg-surface-800'
                            }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${checked ? 'bg-primary-500 border-primary-500' : 'bg-surface-900 border-surface-600'}`}>
                              {checked && <MdPlayArrow className="text-white text-xs" />}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className={`text-sm font-bold truncate ${checked ? 'text-primary-300' : 'text-surface-300'}`}>{s.name}</span>
                              {s.phone_number && (
                                <span className={`text-[10px] font-mono mt-0.5 ${checked ? 'text-primary-400/80' : 'text-surface-500'}`}>{s.phone_number}</span>
                              )}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Preview Resumo */}
              <div className="bg-surface-950/80 border border-surface-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-inner">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-xl font-black text-primary-400 leading-none">{msgCount}</div>
                    <div className="text-[10px] text-surface-500 uppercase font-bold tracking-widest mt-1">Msg{(msgCount !== 1) ? 's' : ''}</div>
                  </div>
                  <div className="w-[1px] h-8 bg-surface-800"></div>
                  <div className="text-center">
                    <div className="text-xl font-black text-primary-400 leading-none">{chipCount}</div>
                    <div className="text-[10px] text-surface-500 uppercase font-bold tracking-widest mt-1">Chip{(chipCount !== 1) ? 's' : ''}</div>
                  </div>
                </div>

                {chipCount > 0 && msgCount > 0 ? (
                  <p className="text-[11px] text-surface-400 font-medium leading-relaxed max-w-[220px]">
                    Cada cliente receberá <strong className="text-surface-200">1</strong> mensagem diferente de forma aleatória enviada por <strong className="text-surface-200">1</strong> chip aleatório.
                  </p>
                ) : (
                  <p className="text-[11px] text-red-400/80 font-medium">Preencha as mensagens e selecione os chips.</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(EMPTY_FORM) }}
                  className="btn-secondary flex-1 py-3"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || chipCount === 0 || msgCount === 0}
                  className="btn-primary flex-[2] py-3 text-sm flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Criando...
                    </>
                  ) : 'Salvar e Iniciar Campanha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
