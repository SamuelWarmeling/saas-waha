import { useEffect, useState, useCallback } from 'react'
import { MdAdd, MdPlayArrow, MdPause, MdStop, MdDelete, MdRefresh } from 'react-icons/md'
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
  const [contacts, setContacts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', message: '', session_id: '', delay_min: 3, delay_max: 8,
  })

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

  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/campanhas', {
        ...form,
        session_id: form.session_id ? Number(form.session_id) : null,
        delay_min: Number(form.delay_min),
        delay_max: Number(form.delay_max),
      })
      toast.success('Campanha criada!')
      setShowModal(false)
      setForm({ name: '', message: '', session_id: '', delay_min: 3, delay_max: 8 })
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
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {campaigns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-600">
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
                    <td className="py-3">
                      <div className="flex items-center gap-1">
                        {c.status === 'draft' || c.status === 'paused' ? (
                          <button
                            onClick={() => action(c.id, 'disparar', 'Disparo iniciado!')}
                            className="p-1.5 rounded hover:bg-green-900/40 text-green-400 transition-colors"
                            title="Disparar"
                          >
                            <MdPlayArrow />
                          </button>
                        ) : null}
                        {c.status === 'running' ? (
                          <button
                            onClick={() => action(c.id, 'pausar', 'Campanha pausada')}
                            className="p-1.5 rounded hover:bg-yellow-900/40 text-yellow-400 transition-colors"
                            title="Pausar"
                          >
                            <MdPause />
                          </button>
                        ) : null}
                        {c.status !== 'completed' && c.status !== 'cancelled' ? (
                          <button
                            onClick={() => action(c.id, 'parar', 'Campanha parada')}
                            className="p-1.5 rounded hover:bg-red-900/40 text-red-400 transition-colors"
                            title="Parar"
                          >
                            <MdStop />
                          </button>
                        ) : null}
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
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-lg">
            <h2 className="text-lg font-bold text-white mb-5">Nova Campanha</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Nome da campanha</label>
                <input name="name" value={form.name} onChange={update}
                  placeholder="Ex: Promoção Junho" required className="input" />
              </div>
              <div>
                <label className="label">Mensagem</label>
                <textarea name="message" value={form.message} onChange={update}
                  placeholder="Olá {nome}, temos uma oferta especial..." required rows={4}
                  className="input resize-none" />
                <p className="text-xs text-gray-600 mt-1">Use {'{nome}'} para personalizar</p>
              </div>
              <div>
                <label className="label">Sessão WhatsApp</label>
                <select name="session_id" value={form.session_id} onChange={update} className="input">
                  <option value="">Selecione uma sessão conectada</option>
                  {connectedSessions.map(s => (
                    <option key={s.id} value={s.id}>{s.name} – {s.phone_number}</option>
                  ))}
                </select>
                {connectedSessions.length === 0 && (
                  <p className="text-xs text-yellow-500 mt-1">Nenhuma sessão conectada. Conecte uma em Sessões.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Delay mínimo (s)</label>
                  <input type="number" name="delay_min" value={form.delay_min}
                    onChange={update} min={1} max={60} className="input" />
                </div>
                <div>
                  <label className="label">Delay máximo (s)</label>
                  <input type="number" name="delay_max" value={form.delay_max}
                    onChange={update} min={1} max={120} className="input" />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
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
