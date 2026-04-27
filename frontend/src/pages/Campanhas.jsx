import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Play, Pause, BarChart3, Pencil, Trash2, X, StopCircle, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const STATUS_COLORS = {
  running:   'bg-success/10 text-success',
  paused:    'bg-warning/10 text-warning',
  completed: 'bg-primary/10 text-primary',
  draft:     'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  scheduled: 'bg-warning/10 text-warning',
  queued:    'bg-warning/10 text-warning',
}
const STATUS_LABELS = {
  running: 'Ativa', paused: 'Pausada', completed: 'Concluída',
  draft: 'Rascunho', cancelled: 'Cancelada', scheduled: 'Agendada', queued: 'Na Fila',
}

export default function Campanhas() {
  const [campaigns, setCampaigns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [sessions, setSessions] = useState([])
  const [form, setForm] = useState({ name: '', message: '', session_ids: [] })
  const [saving, setSaving] = useState(false)
  const [antiBan, setAntiBan] = useState(null)
  const [riskModal, setRiskModal] = useState(null) // { campaign, data, loading }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/campanhas')
      setCampaigns(Array.isArray(data) ? data : [])
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    api.get('/sessoes').then(r => setSessions(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    let mounted = true
    const poll = () => api.get('/antiban/status').then(r => { if (mounted) setAntiBan(r.data) }).catch(() => {})
    poll()
    const id = setInterval(poll, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  async function openCreate() {
    setForm({ name: '', message: '', session_ids: [] })
    setShowModal(true)
  }

  async function createCampaign() {
    if (!form.name.trim()) { toast.error('Nome obrigatório'); return }
    if (!form.message.trim()) { toast.error('Adicione ao menos 1 mensagem'); return }
    setSaving(true)
    try {
      await api.post('/campanhas', {
        name: form.name.trim(),
        messages: [form.message.trim()],
        session_ids: form.session_ids,
        fonte: 'lista',
      })
      toast.success('Campanha criada!')
      setShowModal(false)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao criar campanha')
    }
    setSaving(false)
  }

  async function action(campaign, tipo) {
    if (tipo === 'start') {
      // Primeiro: análise de risco
      setRiskModal({ campaign, data: null, loading: true })
      try {
        const { data } = await api.get(`/campanhas/${campaign.id}/analise-risco`)
        setRiskModal({ campaign, data, loading: false })
      } catch {
        setRiskModal(null)
        await _doStart(campaign)
      }
      return
    }
    const endpoints = { pause: 'pausar', stop: 'parar' }
    try {
      await api.post(`/campanhas/${campaign.id}/${endpoints[tipo]}`)
      toast.success(tipo === 'pause' ? 'Campanha pausada' : 'Campanha parada')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || `Erro ao ${tipo === 'pause' ? 'pausar' : 'parar'}`)
    }
  }

  async function _doStart(campaign) {
    try {
      await api.post(`/campanhas/${campaign.id}/iniciar`)
      toast.success('Campanha iniciada!')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao iniciar')
    }
  }

  async function deleteCampaign(id) {
    if (!window.confirm('Remover esta campanha?')) return
    try {
      await api.delete(`/campanhas/${id}`)
      toast.success('Campanha removida')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao remover')
    }
  }

  function toggleSession(id) {
    setForm(f => ({
      ...f,
      session_ids: f.session_ids.includes(id) ? f.session_ids.filter(s => s !== id) : [...f.session_ids, id],
    }))
  }

  function getProgress(c) {
    if (!c.total_contacts || c.total_contacts === 0) return 0
    return Math.round((c.sent_count / c.total_contacts) * 100)
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{campaigns.length} campanhas</p>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors glow-primary">
          <Plus className="h-4 w-4" /> Nova Campanha
        </button>
      </div>

      {loading ? (
        <div className="glass-card p-12 text-center text-muted-foreground text-sm">Carregando...</div>
      ) : campaigns.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-muted-foreground text-sm">Nenhuma campanha criada ainda.</p>
          <button onClick={openCreate} className="mt-4 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90">
            Criar primeira campanha
          </button>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Nome', 'Status', 'Progresso', 'Enviados', 'Ações'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-5 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => {
                const progress = getProgress(c)
                return (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="border-b border-white/5 hover:bg-muted/20 transition-colors h-16"
                  >
                    <td className="px-5 text-sm text-foreground/90 max-w-[200px] truncate">{c.name}</td>
                    <td className="px-5">
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs px-2 py-1 rounded-full w-fit ${STATUS_COLORS[c.status] || STATUS_COLORS.draft}`}>
                          {STATUS_LABELS[c.status] || c.status}
                        </span>
                        {c.status === 'running' && antiBan && (
                          <div className="flex items-center gap-1">
                            <ShieldCheck className="h-2.5 w-2.5 text-green-400" />
                            <span className="text-[9px] text-green-400 font-semibold">Anti-ban ativo</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                          <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${progress}%`, boxShadow: '0 0 8px #9D4EDD' }} />
                          </div>
                          <span className="text-xs font-mono-data text-muted-foreground">{progress}%</span>
                        </div>
                        {c.status === 'running' && (
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">✨ Variacao</span>
                            <span className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">Gaussian delay</span>
                            <span className="text-[9px] text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded">Opt-out</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-5 text-sm font-mono-data text-muted-foreground">
                      {(c.sent_count || 0).toLocaleString('pt-BR')}/{(c.total_contacts || 0).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-5">
                      <div className="flex gap-1">
                        {c.status === 'draft' || c.status === 'paused' || c.status === 'queued' ? (
                          <button onClick={() => action(c, 'start')} title="Iniciar"
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-success hover:bg-success/10 transition-colors">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {c.status === 'running' ? (
                          <button onClick={() => action(c, 'pause')} title="Pausar"
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-warning hover:bg-warning/10 transition-colors">
                            <Pause className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        {['running', 'paused', 'queued'].includes(c.status) ? (
                          <button onClick={() => action(c, 'stop')} title="Parar"
                            className="h-7 w-7 rounded-lg flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors">
                            <StopCircle className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button onClick={() => deleteCampaign(c.id)} title="Remover"
                          className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-muted transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Análise de Risco */}
      {riskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setRiskModal(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg glass-card p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-foreground/90">Análise de Risco</h2>
              <button onClick={() => setRiskModal(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {riskModal.loading ? (
              <div className="py-12 text-center text-muted-foreground text-sm">Analisando risco...</div>
            ) : riskModal.data ? (() => {
              const d = riskModal.data
              const nivelConfig = {
                baixo:   { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20',  label: 'Campanha segura para disparar' },
                medio:   { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: 'Atencao: alguns riscos detectados' },
                alto:    { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20', label: 'Alto risco de ban. Recomendamos corrigir.' },
                critico: { color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/20', label: 'Nao recomendamos disparar agora' },
              }
              const nc = nivelConfig[d.nivel] || nivelConfig.baixo
              const circ = 2 * Math.PI * 36
              const offset = circ - (d.score / 100) * circ
              return (
                <div>
                  {/* Score gauge */}
                  <div className={`flex items-center gap-5 p-4 rounded-xl mb-4 ${nc.bg} border ${nc.border}`}>
                    <div className="relative h-20 w-20 flex-shrink-0">
                      <svg className="transform -rotate-90 w-20 h-20">
                        <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="5" fill="transparent" className="text-muted/30" />
                        <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="5" fill="transparent"
                          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
                          className={`${nc.color} transition-all duration-700`} />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center font-bold text-xl ${nc.color}`}>{d.score}</span>
                    </div>
                    <div>
                      <p className={`text-sm font-bold ${nc.color}`}>{d.nivel.charAt(0).toUpperCase() + d.nivel.slice(1)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{nc.label}</p>
                      <p className="text-xs text-muted-foreground mt-1">{d.chips_total} chip(s) · {d.contatos_total} contatos</p>
                    </div>
                  </div>

                  {/* Fatores */}
                  {d.fatores.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Fatores de risco</p>
                      <ul className="space-y-1">
                        {d.fatores.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                            <span className="text-destructive mt-0.5">•</span> {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recomendações */}
                  {d.recomendacoes.length > 0 && (
                    <div className="mb-5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recomendacoes</p>
                      <ul className="space-y-1">
                        {d.recomendacoes.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <span className="text-success mt-0.5">→</span> {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Botões */}
                  <div className="flex gap-3">
                    <button onClick={() => setRiskModal(null)}
                      className="flex-1 py-2 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80 transition-colors">
                      Cancelar
                    </button>
                    <button onClick={() => setRiskModal(null)}
                      className="flex-1 py-2 rounded-xl bg-muted/50 border border-white/10 text-foreground text-sm hover:bg-muted transition-colors">
                      Corrigir problemas
                    </button>
                    <button
                      onClick={async () => { setRiskModal(null); await _doStart(riskModal.campaign) }}
                      disabled={!d.pode_disparar}
                      className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {d.nivel === 'critico' ? 'Bloqueado' : 'Disparar mesmo assim'}
                    </button>
                  </div>
                </div>
              )
            })() : null}
          </motion.div>
        </div>
      )}

      {/* Modal: Nova Campanha */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => setShowModal(false)}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg glass-card p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-foreground/90">Nova Campanha</h2>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nome da campanha *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Black Friday 2024"
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Mensagem</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Olá {nome}! Temos uma oferta especial para você..."
                  rows={4}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">Use {'{nome}'} para personalizar com o nome do contato</p>
              </div>

              {sessions.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">Chips (opcional)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {sessions.filter(s => ['connected', 'working'].includes((s.status || '').toLowerCase())).map(s => (
                      <button key={s.id} onClick={() => toggleSession(s.id)}
                        className={`text-left px-3 py-2 rounded-xl text-xs border transition-colors ${
                          form.session_ids.includes(s.id)
                            ? 'bg-primary/20 border-primary/40 text-primary'
                            : 'bg-muted/20 border-white/10 text-muted-foreground hover:text-foreground'
                        }`}>
                        <span className="block font-medium">{s.name}</span>
                        <span className="text-[10px] opacity-60">{s.phone_number || 'Conectado'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground bg-muted/20 rounded-xl px-3 py-2">
                💡 Após criar, adicione contatos e configure disparos avançados nas opções da campanha.
              </p>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80 transition-colors">
                Cancelar
              </button>
              <button onClick={createCampaign} disabled={saving || !form.name.trim() || !form.message.trim()}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {saving ? 'Criando...' : 'Criar Campanha'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
