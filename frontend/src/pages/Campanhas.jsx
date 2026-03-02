import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdPlayArrow, MdPause, MdStop, MdDelete, MdRefresh, MdClose } from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_LABEL = {
  draft: 'Rascunho', running: 'Rodando', paused: 'Pausado',
  completed: 'Concluído', cancelled: 'Cancelado',
}
const STATUS_CLASS = {
  draft: 'badge-gray', running: 'badge-green', paused: 'badge-yellow',
  completed: 'badge-blue', cancelled: 'badge-red',
}

const EMPTY_FORM = {
  name: '',
  messages: [''],
  session_ids: [],
  delay_min: 3,
  delay_max: 8,
}

function ProgressBar({ percent }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-1">
      <div
        className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
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
    try {
      const [c, s] = await Promise.all([
        api.get('/campanhas?page_size=50'),
        api.get('/sessoes'),
      ])
      setCampaigns(c.data)
      setSessions(s.data)
    } catch {
      toast.error('Erro ao carregar campanhas')
    }
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
        delay_min: Number(form.delay_min),
        delay_max: Number(form.delay_max),
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

  const connectedSessions = sessions.filter(s => s.status === 'connected')
  const msgCount = form.messages.filter(m => m.trim()).length
  const chipCount = form.session_ids.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Campanhas</h1>
          <p className="text-sm text-gray-500">Gerencie seus disparos em massa</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <MdRefresh /> Atualizar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <MdAdd /> Nova Campanha
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-3 pr-4 font-medium">Nome</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 pr-4 font-medium">Progresso</th>
                <th className="pb-3 pr-4 font-medium">Sucesso / Falha</th>
                <th className="pb-3 pr-4 font-medium">Msgs / Chips</th>
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-600">
                    Nenhuma campanha criada.
                  </td>
                </tr>
              ) : campaigns.map(c => {
                const pct = c.total_contacts > 0
                  ? Math.round((c.sent_count / c.total_contacts) * 100) : 0
                return (
                  <tr key={c.id}>
                    <td className="py-3 pr-4 text-gray-200 font-medium max-w-[180px] truncate">
                      {c.name}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={STATUS_CLASS[c.status] || 'badge-gray'}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 min-w-[140px]">
                      <span className="text-xs text-gray-400">
                        {c.sent_count}/{c.total_contacts} ({pct}%)
                      </span>
                      <ProgressBar percent={pct} />
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      <span className="text-green-400">{c.success_count} ok</span>
                      {' / '}
                      <span className="text-red-400">{c.fail_count} falha</span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-500">
                      {c.messages?.length ?? 1} msg
                      {' · '}
                      {c.session_ids?.length ?? 1} chip{(c.session_ids?.length ?? 1) !== 1 ? 's' : ''}
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1">
                        {(c.status === 'draft' || c.status === 'paused') && (
                          <button
                            onClick={() => action(c.id, 'disparar', 'Disparo iniciado!')}
                            className="p-1.5 rounded hover:bg-green-900/40 text-green-400 transition-colors"
                            title="Disparar"
                          >
                            <MdPlayArrow />
                          </button>
                        )}
                        {c.status === 'running' && (
                          <button
                            onClick={() => action(c.id, 'pausar', 'Campanha pausada')}
                            className="p-1.5 rounded hover:bg-yellow-900/40 text-yellow-400 transition-colors"
                            title="Pausar"
                          >
                            <MdPause />
                          </button>
                        )}
                        {c.status !== 'completed' && c.status !== 'cancelled' && (
                          <button
                            onClick={() => action(c.id, 'parar', 'Campanha parada')}
                            className="p-1.5 rounded hover:bg-red-900/40 text-red-400 transition-colors"
                            title="Parar"
                          >
                            <MdStop />
                          </button>
                        )}
                        <button
                          onClick={() => deleteCampaign(c.id)}
                          className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
                          title="Deletar"
                        >
                          <MdDelete />
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
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="card w-full max-w-lg my-8">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-white">Nova Campanha</h2>
              <button
                onClick={() => { setShowModal(false); setForm(EMPTY_FORM) }}
                className="text-gray-500 hover:text-gray-300 transition-colors"
              >
                <MdClose className="text-xl" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-5">
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
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">
                    Mensagens
                    <span className="ml-2 text-xs text-gray-600 font-normal">
                      ({form.messages.length}/10) — escolha aleatória por contato
                    </span>
                  </label>
                  {form.messages.length < 10 && (
                    <button
                      type="button"
                      onClick={addMessage}
                      className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors"
                    >
                      <MdAdd /> Adicionar mensagem
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {form.messages.map((msg, i) => (
                    <div key={i} className="relative">
                      <textarea
                        value={msg}
                        onChange={e => updateMessage(i, e.target.value)}
                        placeholder={`Mensagem ${i + 1} — use {nome} para personalizar`}
                        required
                        rows={3}
                        className="input resize-none pr-8"
                      />
                      {form.messages.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMessage(i)}
                          className="absolute top-2 right-2 text-gray-600 hover:text-red-400 transition-colors"
                          title="Remover mensagem"
                        >
                          <MdClose />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-1">Use {'{nome}'} para personalizar com o nome do contato</p>
              </div>

              {/* Chips (sessões) */}
              <div>
                <label className="label">
                  Chips WhatsApp
                  <span className="ml-2 text-xs text-gray-600 font-normal">
                    rodízio aleatório entre os selecionados
                  </span>
                </label>
                {connectedSessions.length === 0 ? (
                  <p className="text-xs text-yellow-500 mt-1">
                    Nenhum chip conectado. Conecte em Sessões.
                  </p>
                ) : (
                  <div className="space-y-2 mt-2">
                    {connectedSessions.map(s => {
                      const checked = form.session_ids.includes(s.id)
                      return (
                        <label
                          key={s.id}
                          className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'border-green-500/50 bg-green-500/10'
                              : 'border-gray-700 hover:border-gray-600'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSession(s.id)}
                            className="accent-green-500 w-4 h-4"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-gray-200 font-medium">{s.name}</span>
                            {s.phone_number && (
                              <span className="text-xs text-gray-500 ml-2">{s.phone_number}</span>
                            )}
                          </div>
                          <span className="text-xs text-green-400">conectado</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Delay */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Delay mínimo (s)</label>
                  <input
                    type="number"
                    value={form.delay_min}
                    onChange={e => setForm(f => ({ ...f, delay_min: e.target.value }))}
                    min={1} max={60}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Delay máximo (s)</label>
                  <input
                    type="number"
                    value={form.delay_max}
                    onChange={e => setForm(f => ({ ...f, delay_max: e.target.value }))}
                    min={1} max={120}
                    className="input"
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="bg-gray-800/60 rounded-lg px-4 py-3 text-sm text-gray-400 flex items-center gap-3">
                <span className="text-white font-medium">
                  {msgCount} mensage{msgCount !== 1 ? 'ns' : 'm'}
                </span>
                <span className="text-gray-600">·</span>
                <span className="text-white font-medium">
                  {chipCount} chip{chipCount !== 1 ? 's' : ''}
                </span>
                {chipCount > 0 && msgCount > 0 && (
                  <>
                    <span className="text-gray-600">·</span>
                    <span className="text-gray-500 text-xs">
                      cada contato recebe 1 mensagem aleatória via 1 chip aleatório
                    </span>
                  </>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(EMPTY_FORM) }}
                  className="btn-secondary flex-1"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || chipCount === 0}
                  className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Criando...' : 'Criar Campanha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
