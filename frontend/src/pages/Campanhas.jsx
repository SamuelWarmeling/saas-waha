import { useEffect, useState, useCallback, useRef } from 'react'
import {
  MdAdd, MdPlayArrow, MdPause, MdStop, MdDelete, MdRefresh, MdClose, MdInfo,
  MdAccessTime, MdSettings, MdShield, MdSchedule, MdFilterList,
  MdBarChart, MdDownload, MdImage, MdAudiotrack, MdAttachFile, MdSmartButton,
  MdMessage, MdCheckCircle, MdCancel, MdSkipNext, MdEmail, MdLink,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

// ── Constantes ─────────────────────────────────────────────────────────────────

const STATUS_LABEL = {
  draft: 'Rascunho', scheduled: 'Agendada', running: 'Rodando', paused: 'Pausado',
  completed: 'Concluído', cancelled: 'Cancelado',
}
const STATUS_CLASS = {
  draft: 'badge-gray', scheduled: 'badge-yellow', running: 'badge-primary',
  paused: 'badge-yellow', completed: 'badge-green', cancelled: 'badge-red',
}

const MEDIA_TABS = [
  { tipo: 'text',    icon: MdMessage,     label: '💬 Texto' },
  { tipo: 'image',   icon: MdImage,       label: '🖼 Imagem' },
  { tipo: 'file',    icon: MdAttachFile,  label: '📄 Arquivo' },
  { tipo: 'audio',   icon: MdAudiotrack,  label: '🎵 Áudio' },
  { tipo: 'buttons', icon: MdSmartButton, label: '🔘 Botões' },
]

const EMPTY_MSG_ITEM = { tipo: 'text', text: '', media_url: '', media_filename: '', botoes: [{ texto: '', tipo: 'reply', valor: '' }] }
const EMPTY_FORM = { name: '', message_items: [{ ...EMPTY_MSG_ITEM }], session_ids: [], ordem_mensagens: 'aleatorio' }
const EMPTY_ADVANCED = {
  delay_min: 5, delay_max: 15, max_per_chip_per_day: 200,
  stop_on_disconnect: true, business_hours_only: false,
  business_hours_start: '08:00', business_hours_end: '18:00',
  skip_unnamed_contacts: false, no_duplicates: true,
  schedule_enabled: false, schedule_date: '', schedule_time: '',
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function ProgressBar({ percent, status }) {
  const color = status === 'paused'
    ? 'from-yellow-600 to-yellow-400 shadow-[0_0_10px_theme(colors.yellow.500/40)]'
    : 'from-primary-600 to-primary-400 shadow-[0_0_10px_theme(colors.primary.500/50)]'
  return (
    <div className="w-full bg-surface-950 border border-surface-800 shadow-inner rounded-full h-2 mt-1.5 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r ${color} relative`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      >
        <div className="absolute top-0 left-0 w-full h-full bg-white/20" />
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none ${checked ? 'bg-primary-500 border-primary-500' : 'bg-surface-700 border-surface-700'}`}>
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

function DrawerSection({ icon: Icon, title, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-white/10">
        <div className="w-6 h-6 rounded-md bg-primary-500/20 text-primary-400 flex items-center justify-center flex-shrink-0"><Icon size={14} /></div>
        <span className="text-xs font-bold text-surface-300 uppercase tracking-widest">{title}</span>
      </div>
      {children}
    </div>
  )
}

// ── Editor de mensagem por tipo ────────────────────────────────────────────────

function MessageItemEditor({ item, onChange, onUpload, uploadingIdx }) {
  const tipo = item.tipo || 'text'
  const fileRef = useRef()

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    await onUpload(file, item, onChange)
    e.target.value = ''
  }

  const mediaAccept = {
    image: 'image/jpeg,image/png,image/gif,image/webp',
    file: '.pdf,.doc,.docx,.xls,.xlsx',
    audio: 'audio/mpeg,audio/ogg,audio/wav,audio/mp3',
  }

  return (
    <div className="space-y-3">
      {/* Tabs de tipo */}
      <div className="flex rounded-xl p-0.5 gap-0.5 flex-wrap" style={{ background: 'rgba(11,9,20,0.6)', border: '1px solid rgba(157,78,221,0.15)' }}>
        {MEDIA_TABS.map(tab => {
          const active = tipo === tab.tipo
          return (
            <button key={tab.tipo} type="button"
              onClick={() => onChange({ ...item, tipo: tab.tipo })}
              className="flex-1 min-w-[80px] text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-all"
              style={active
                ? { background: 'linear-gradient(135deg,rgba(157,78,221,0.3),rgba(106,13,173,0.25))', color: '#b07de6', border: '1px solid rgba(157,78,221,0.4)' }
                : { color: '#64748b', background: 'transparent', border: '1px solid transparent' }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Texto / Caption */}
      {(tipo === 'text' || tipo === 'image' || tipo === 'file') && (
        <div>
          <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1 block">
            {tipo === 'text' ? 'Mensagem' : 'Legenda (opcional)'}
          </label>
          <textarea
            value={item.text}
            onChange={e => onChange({ ...item, text: e.target.value })}
            placeholder={tipo === 'text' ? 'Conteúdo da mensagem...' : 'Legenda da mídia...'}
            required={tipo === 'text'}
            rows={tipo === 'text' ? 3 : 2}
            className="input resize-none min-h-[70px] text-sm"
          />
        </div>
      )}

      {/* Upload de mídia */}
      {(tipo === 'image' || tipo === 'file' || tipo === 'audio') && (
        <div>
          <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">
            {tipo === 'image' ? 'Imagem (JPG/PNG/GIF)' : tipo === 'audio' ? 'Áudio (MP3/OGG/WAV)' : 'Arquivo (PDF/DOC/XLS)'}
          </label>
          {item.media_url ? (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-primary-500/30 bg-primary-900/10">
              {tipo === 'image' && (
                <img src={item.media_url} alt="preview" className="w-14 h-14 object-cover rounded-lg border border-surface-700" />
              )}
              {tipo === 'audio' && (
                <audio controls src={item.media_url} className="h-8 flex-1" />
              )}
              {tipo === 'file' && (
                <div className="flex items-center gap-2 flex-1">
                  <MdAttachFile className="text-primary-400" size={20} />
                  <span className="text-xs text-surface-300 truncate">{item.media_filename || 'arquivo'}</span>
                </div>
              )}
              <button type="button" onClick={() => onChange({ ...item, media_url: '', media_filename: '' })}
                className="p-1.5 rounded-lg bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors ml-auto flex-shrink-0">
                <MdClose size={14} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              disabled={uploadingIdx}
              className="w-full py-4 rounded-xl border-2 border-dashed border-surface-700 hover:border-primary-500/50 bg-surface-900/30 hover:bg-primary-900/10 transition-all text-surface-400 hover:text-primary-400 flex flex-col items-center gap-1.5 disabled:opacity-50">
              <input ref={fileRef} type="file" accept={mediaAccept[tipo]} onChange={handleFileChange} className="hidden" />
              {uploadingIdx ? (
                <div className="w-5 h-5 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin" />
              ) : (
                <MdDownload size={22} className="rotate-180" />
              )}
              <span className="text-xs font-medium">{uploadingIdx ? 'Enviando...' : 'Clique para fazer upload'}</span>
            </button>
          )}
        </div>
      )}

      {/* Botões interativos */}
      {tipo === 'buttons' && (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1 block">Corpo da mensagem</label>
            <textarea
              value={item.text}
              onChange={e => onChange({ ...item, text: e.target.value })}
              placeholder="Texto principal da mensagem..."
              required
              rows={2}
              className="input resize-none text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block flex items-center justify-between">
              <span>Botões (máx. 3)</span>
              {item.botoes.length < 3 && (
                <button type="button"
                  onClick={() => onChange({ ...item, botoes: [...item.botoes, { texto: '', tipo: 'reply', valor: '' }] })}
                  className="text-primary-400 hover:text-primary-300 text-[11px] flex items-center gap-1">
                  <MdAdd size={14} /> Adicionar
                </button>
              )}
            </label>
            {item.botoes.map((btn, bi) => (
              <div key={bi} className="flex items-start gap-2 mb-2">
                <div className="flex-1 space-y-1.5">
                  <input
                    value={btn.texto}
                    onChange={e => {
                      const b = [...item.botoes]; b[bi] = { ...b[bi], texto: e.target.value }
                      onChange({ ...item, botoes: b })
                    }}
                    placeholder={`Texto botão ${bi + 1}`}
                    className="input text-xs py-1.5"
                  />
                  <div className="flex gap-1">
                    {['reply', 'link'].map(t => (
                      <button key={t} type="button"
                        onClick={() => { const b = [...item.botoes]; b[bi] = { ...b[bi], tipo: t }; onChange({ ...item, botoes: b }) }}
                        className={`text-[10px] px-2 py-0.5 rounded border font-semibold transition-colors ${btn.tipo === t ? 'border-primary-500/50 bg-primary-900/20 text-primary-400' : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>
                        {t === 'reply' ? '↩ Resposta' : '🔗 Link'}
                      </button>
                    ))}
                  </div>
                  {btn.tipo === 'link' && (
                    <input
                      value={btn.valor}
                      onChange={e => { const b = [...item.botoes]; b[bi] = { ...b[bi], valor: e.target.value }; onChange({ ...item, botoes: b }) }}
                      placeholder="https://..."
                      className="input text-xs py-1.5"
                    />
                  )}
                </div>
                {item.botoes.length > 1 && (
                  <button type="button" onClick={() => onChange({ ...item, botoes: item.botoes.filter((_, idx) => idx !== bi) })}
                    className="p-1.5 rounded-lg bg-surface-800 text-surface-500 hover:text-red-400 hover:bg-red-900/20 transition-colors mt-0.5">
                    <MdClose size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Modal de Relatório ─────────────────────────────────────────────────────────

function ReportModal({ campaign, onClose }) {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const loadReport = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const { data } = await api.get(`/campanhas/${campaign.id}/relatorio?page=${p}&page_size=50`)
      setReport(data)
    } catch {
      toast.error('Erro ao carregar relatório')
    } finally {
      setLoading(false)
    }
  }, [campaign.id])

  useEffect(() => { loadReport(page) }, [loadReport, page])

  async function exportCSV() {
    try {
      const resp = await api.get(`/campanhas/${campaign.id}/relatorio/exportar`, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a'); a.href = url; a.download = `relatorio_${campaign.name}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erro ao exportar')
    }
  }

  const s = report?.summary
  const statusIcon = { sent: <MdCheckCircle className="text-primary-400" />, failed: <MdCancel className="text-red-400" />, skipped: <MdSkipNext className="text-yellow-400" />, delivered: <MdEmail className="text-blue-400" />, read: <MdCheckCircle className="text-green-400" /> }
  const statusColor = { sent: 'text-primary-300', failed: 'text-red-300', skipped: 'text-yellow-300', delivered: 'text-blue-300', read: 'text-green-300' }
  const ccStatusLabel = { pending: 'Pendente', sent: 'Enviado', failed: 'Erro', skipped: 'Ignorado' }
  const ccStatusClass = { pending: 'badge-gray', sent: 'badge-primary', failed: 'badge-red', skipped: 'badge-yellow' }

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.88)' }}>
      <div className="w-full flex flex-col rounded-2xl overflow-hidden" style={{
        maxWidth: 900, maxHeight: '93vh',
        background: 'linear-gradient(160deg,#1a1228 0%,#120d1e 100%)',
        border: '1px solid rgba(157,78,221,0.25)',
        boxShadow: '0 0 80px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0" style={{ background: 'rgba(157,78,221,0.07)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-500/20 text-primary-400 flex items-center justify-center"><MdBarChart size={20} /></div>
            <div>
              <h3 className="font-bold text-white text-sm">Relatório: {campaign.name}</h3>
              <p className="text-[11px] text-surface-500 mt-0.5">{s ? `${s.total} contatos processados` : 'Carregando...'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-400 border border-primary-500/30 bg-primary-900/10 hover:bg-primary-900/30 transition-all">
              <MdDownload size={15} /> Exportar CSV
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface-800/80 flex items-center justify-center text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
              <MdClose size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && !report ? (
            <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin" /></div>
          ) : (
            <>
              {/* Cards de resumo */}
              {s && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { key: 'total', label: 'Total', val: s.total, color: 'text-surface-200', bg: 'bg-surface-800/60 border-surface-700/40' },
                    { key: 'sent', label: 'Enviados', val: s.sent, color: 'text-primary-300', bg: 'bg-primary-900/20 border-primary-500/20' },
                    { key: 'failed', label: 'Falhas', val: s.failed, color: 'text-red-300', bg: 'bg-red-900/15 border-red-500/20' },
                    { key: 'skipped', label: 'Ignorados', val: s.skipped, color: 'text-yellow-300', bg: 'bg-yellow-900/15 border-yellow-500/20' },
                    { key: 'delivered', label: 'Entregues', val: s.delivered, color: 'text-blue-300', bg: 'bg-blue-900/15 border-blue-500/20' },
                    { key: 'read', label: 'Lidos', val: s.read, color: 'text-green-300', bg: 'bg-green-900/15 border-green-500/20' },
                  ].map(card => (
                    <div key={card.key} className={`rounded-xl border p-3 text-center ${card.bg}`}>
                      <div className={`text-2xl font-black ${card.color}`}>{card.val}</div>
                      <div className="text-[10px] text-surface-500 uppercase font-bold tracking-wider mt-1">{card.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Barras de progresso */}
              {s && s.total > 0 && (
                <div className="rounded-xl border border-surface-700/40 bg-surface-900/30 p-4 space-y-3">
                  {[
                    { label: 'Enviados', val: s.sent, color: 'bg-primary-500' },
                    { label: 'Falhas', val: s.failed, color: 'bg-red-500' },
                    { label: 'Ignorados', val: s.skipped, color: 'bg-yellow-500' },
                    { label: 'Entregues', val: s.delivered, color: 'bg-blue-500' },
                    { label: 'Lidos', val: s.read, color: 'bg-green-500' },
                  ].map(bar => (
                    <div key={bar.label} className="flex items-center gap-3">
                      <span className="text-[11px] text-surface-400 w-20 text-right">{bar.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-surface-800 overflow-hidden">
                        <div className={`h-full rounded-full ${bar.color} transition-all duration-700`} style={{ width: `${Math.round(bar.val / s.total * 100)}%` }} />
                      </div>
                      <span className="text-[11px] text-surface-300 font-semibold w-8">{Math.round(bar.val / s.total * 100)}%</span>
                      <span className="text-[11px] text-surface-500 w-6">{bar.val}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tabela de contatos */}
              <div>
                <h4 className="text-xs font-bold text-surface-400 uppercase tracking-wider mb-3">Detalhamento por Contato</h4>
                <div className="rounded-xl overflow-hidden border border-surface-700/40">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-surface-900/60 text-surface-500 border-b border-surface-700/40">
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">Contato</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">Chip</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">Enviado</th>
                          <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider">Lido</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-800/40">
                        {report?.contacts?.map(cc => (
                          <tr key={cc.id} className="hover:bg-surface-800/20 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-medium text-surface-200">{cc.name || '—'}</div>
                              <div className="text-surface-500 font-mono text-[10px]">{cc.phone}</div>
                            </td>
                            <td className="px-4 py-3 text-surface-400">{cc.session_name || '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`${ccStatusClass[cc.status] || 'badge-gray'} text-[10px]`}>
                                {ccStatusLabel[cc.status] || cc.status}
                              </span>
                              {cc.error_message && <div className="text-red-400/70 text-[10px] mt-0.5 truncate max-w-[120px]">{cc.error_message}</div>}
                            </td>
                            <td className="px-4 py-3 text-surface-400">
                              {cc.sent_at ? new Date(cc.sent_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-green-400/80">
                              {cc.read_at ? new Date(cc.read_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Paginação relatório */}
                {report && report.total_rows > 50 && (
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-surface-500">{report.total_rows} contatos no total</span>
                    <div className="flex gap-2">
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                        className="px-3 py-1.5 rounded-lg text-xs text-surface-400 border border-surface-700 hover:border-primary-500/40 disabled:opacity-30 transition-colors">
                        ← Anterior
                      </button>
                      <span className="px-3 py-1.5 text-xs text-surface-400">Pág. {page}</span>
                      <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= report.total_rows}
                        className="px-3 py-1.5 rounded-lg text-xs text-surface-400 border border-surface-700 hover:border-primary-500/40 disabled:opacity-30 transition-colors">
                        Próxima →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function Campanhas() {
  const [campaigns, setCampaigns] = useState([])
  const [sessions, setSessions] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [showDrawer, setShowDrawer] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [adv, setAdv] = useState(EMPTY_ADVANCED)
  const [drawerDraft, setDrawerDraft] = useState(EMPTY_ADVANCED)
  const [uploadingIdx, setUploadingIdx] = useState(null)
  const [reportCampaign, setReportCampaign] = useState(null)

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

  // Polling para campanhas ativas
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

  function addMsgItem() {
    if (form.message_items.length >= 10) return
    setForm(f => ({ ...f, message_items: [...f.message_items, { ...EMPTY_MSG_ITEM }] }))
  }

  function removeMsgItem(i) {
    if (form.message_items.length <= 1) return
    setForm(f => ({ ...f, message_items: f.message_items.filter((_, idx) => idx !== i) }))
  }

  function updateMsgItem(i, val) {
    setForm(f => {
      const items = [...f.message_items]
      items[i] = val
      return { ...f, message_items: items }
    })
  }

  async function handleUpload(file, item, onChange) {
    setUploadingIdx(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post('/campanhas/upload-media', fd)
      onChange({ ...item, media_url: data.url, media_filename: data.filename, tipo: data.tipo })
      toast.success('Arquivo enviado!')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao enviar arquivo')
    } finally {
      setUploadingIdx(false)
    }
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

  // ── Drawer helpers ─────────────────────────────────────────────────────────

  function openDrawer() { setDrawerDraft({ ...adv }); setShowDrawer(true) }
  function saveDrawer() { setAdv({ ...drawerDraft }); setShowDrawer(false); toast.success('Configurações salvas') }

  // ── Criar campanha ─────────────────────────────────────────────────────────

  async function handleCreate(e) {
    e.preventDefault()
    if (form.session_ids.length === 0) { toast.error('Selecione ao menos 1 chip'); return }

    // Validar itens de mensagem
    const validItems = form.message_items.filter(item =>
      (item.tipo === 'text' && item.text.trim()) ||
      (item.tipo !== 'text' && item.media_url)
    )
    if (!validItems.length) { toast.error('Adicione ao menos 1 mensagem válida'); return }

    // Calcular scheduled_at
    let scheduledAt = null
    if (adv.schedule_enabled && adv.schedule_date && adv.schedule_time) {
      scheduledAt = new Date(`${adv.schedule_date}T${adv.schedule_time}:00`).toISOString()
    }

    setLoading(true)
    try {
      await api.post('/campanhas', {
        name: form.name,
        message_items: validItems,
        session_ids: form.session_ids,
        ordem_mensagens: form.ordem_mensagens,
        delay_min: Number(adv.delay_min),
        delay_max: Number(adv.delay_max),
        scheduled_at: scheduledAt,
      })
      toast.success(scheduledAt ? 'Campanha agendada!' : 'Campanha criada!')
      setShowModal(false)
      setForm(EMPTY_FORM)
      setAdv(EMPTY_ADVANCED)
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

  // ── Derived ────────────────────────────────────────────────────────────────

  const connectedSessions = sessions.filter(s =>
    ['connected', 'working'].includes((s.status || '').toLowerCase())
  )
  const validMsgCount = form.message_items.filter(item =>
    (item.tipo === 'text' && item.text.trim()) || (item.tipo !== 'text' && item.media_url)
  ).length
  const chipCount = form.session_ids.length

  const advBadgeParts = [
    `${adv.delay_min}-${adv.delay_max}s delay`,
    adv.business_hours_only ? 'Horário comercial' : null,
    adv.schedule_enabled && adv.schedule_date ? `Agendada ${adv.schedule_date.split('-').reverse().slice(0, 2).join('/')}` : null,
  ].filter(Boolean)

  function fmtScheduledAt(dt) {
    if (!dt) return null
    const d = new Date(dt)
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
                const isScheduled = c.status === 'scheduled'
                return (
                  <tr key={c.id} className="hover:bg-surface-800/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-bold text-surface-200 max-w-[200px] truncate group-hover:text-primary-300 transition-colors">{c.name}</div>
                      <div className="text-[11px] text-surface-500 mt-1 uppercase tracking-wider font-medium flex items-center gap-1.5 flex-wrap">
                        <span className="w-4 h-4 rounded-full bg-surface-800 border border-surface-700 font-bold flex items-center justify-center text-surface-400">{c.messages?.length ?? 1}</span> msg
                        <span className="text-surface-700">|</span>
                        <span className="w-4 h-4 rounded-full bg-surface-800 border border-surface-700 font-bold flex items-center justify-center text-surface-400">{c.session_ids?.length ?? 1}</span> chip
                        {isScheduled && c.scheduled_at && (
                          <span className="text-yellow-400/90 font-semibold flex items-center gap-1 text-[10px]">
                            <MdSchedule size={12} /> {fmtScheduledAt(c.scheduled_at)}
                          </span>
                        )}
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
                        <span className={`font-bold ${c.status === 'paused' ? 'text-yellow-400' : 'text-primary-400'}`}>{pct}%</span>
                      </div>
                      <ProgressBar percent={pct} status={c.status} />
                    </td>
                    <td className="px-6 py-4 text-xs font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="flex items-center gap-1.5 text-primary-400/90"><div className="w-1.5 h-1.5 rounded-full bg-primary-500" />{c.success_count} concluídos</span>
                        <span className="flex items-center gap-1.5 text-red-400/90"><div className="w-1.5 h-1.5 rounded-full bg-red-500" />{c.fail_count} falhas</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Ver Relatório */}
                        {(c.status === 'completed' || c.status === 'cancelled' || c.sent_count > 0) && (
                          <button
                            onClick={() => setReportCampaign(c)}
                            className="p-2.5 rounded-xl bg-surface-800/50 hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-all border border-surface-700/40"
                            title="Ver Relatório"
                          >
                            <MdBarChart size={18} />
                          </button>
                        )}
                        {(c.status === 'draft' || c.status === 'paused' || c.status === 'scheduled') && (
                          <button
                            onClick={() => action(c.id, 'disparar', 'Disparo iniciado!')}
                            className="p-2.5 rounded-xl bg-primary-900/10 hover:bg-primary-900/40 text-primary-400 hover:text-primary-300 transition-all border border-primary-500/20 shadow-sm shadow-primary-900/10"
                            title="Disparar agora"
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

      {/* ── Modal Nova Campanha ─────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="glass-card w-full max-w-lg my-8 p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-surface-600/50">

            {/* Header */}
            <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center"><MdPlayArrow size={20} /></div>
                Nova Campanha
              </h2>
              <button onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setAdv(EMPTY_ADVANCED) }}
                className="w-8 h-8 rounded-full bg-surface-800 flex items-center justify-center text-surface-400 hover:text-white hover:bg-surface-700 transition-colors">
                <MdClose size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-6">

              {/* Nome */}
              <div>
                <label className="label">Nome da campanha</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Promoção Junho" required className="input" />
              </div>

              {/* Mensagens com tipos de mídia */}
              <div className="bg-surface-900/30 p-5 rounded-2xl border border-surface-800/50">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-700/50">
                  <label className="label mb-0 flex items-center gap-2">
                    <span className="text-surface-200">Mensagens</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider bg-surface-800 text-surface-400 px-2 py-0.5 rounded border border-surface-700">
                      {form.message_items.length}/10
                    </span>
                  </label>
                  {form.message_items.length < 10 && (
                    <button type="button" onClick={addMsgItem}
                      className="text-xs font-semibold text-primary-400 hover:text-primary-300 flex items-center gap-1 transition-colors px-2 py-1 rounded-md hover:bg-primary-500/10">
                      <MdAdd size={16} /> Adicionar Alternativa
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {form.message_items.map((item, i) => (
                    <div key={i} className="relative rounded-xl border border-surface-700/40 bg-surface-900/40 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-5 h-5 rounded-full bg-surface-800 border border-surface-700 flex items-center justify-center text-[10px] font-bold text-surface-400">{i + 1}</div>
                        {form.message_items.length > 1 && (
                          <button type="button" onClick={() => removeMsgItem(i)}
                            className="w-6 h-6 rounded-lg bg-surface-800/50 text-surface-500 hover:text-red-400 hover:bg-red-900/30 transition-all flex items-center justify-center">
                            <MdClose size={14} />
                          </button>
                        )}
                      </div>
                      <MessageItemEditor
                        item={item}
                        onChange={val => updateMsgItem(i, val)}
                        onUpload={handleUpload}
                        uploadingIdx={uploadingIdx}
                      />
                    </div>
                  ))}
                </div>

                {/* Ordem de envio */}
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Ordem de envio</p>
                  <div className="flex rounded-xl p-1 gap-1" style={{ background: 'rgba(11,9,20,0.6)', border: '1px solid rgba(157,78,221,0.15)' }}>
                    {[
                      { value: 'aleatorio', icon: '🔀', label: 'Aleatório' },
                      { value: 'sequencial', icon: '🔢', label: 'Em ordem' },
                    ].map(opt => {
                      const active = form.ordem_mensagens === opt.value
                      return (
                        <button key={opt.value} type="button"
                          onClick={() => setForm(f => ({ ...f, ordem_mensagens: opt.value }))}
                          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
                          style={active
                            ? { background: 'linear-gradient(135deg,rgba(157,78,221,0.25),rgba(106,13,173,0.2))', color: '#b07de6', border: '1px solid rgba(157,78,221,0.4)' }
                            : { color: '#64748b', background: 'transparent', border: '1px solid transparent' }}>
                          <span>{opt.icon}</span> {opt.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="mt-3 flex items-start gap-2 bg-primary-900/10 p-3 rounded-lg border border-primary-500/20">
                  <MdInfo className="text-primary-400 text-lg flex-shrink-0" />
                  <p className="text-[11px] leading-relaxed text-primary-200/70 font-medium">
                    Use <span className="font-mono text-primary-300 bg-primary-900/40 px-1 py-0.5 rounded border border-primary-800/50">{'{nome}'}</span> para personalizar o texto com o nome do contato.
                  </p>
                </div>
              </div>

              {/* Chips */}
              <div>
                <label className="label flex justify-between items-center mb-3">
                  <span className="text-surface-200">Chips WhatsApp</span>
                  <span className="text-xs text-surface-500 font-normal">Selecione as conexões de envio</span>
                </label>
                {connectedSessions.length === 0 ? (
                  <div className="p-4 rounded-xl border border-yellow-500/30 bg-yellow-900/10 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-500 flex-shrink-0"><MdInfo size={18} /></div>
                    <p className="text-sm text-yellow-500/90 font-medium">Conecte um chip na página de Sessões antes de criar uma campanha.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {connectedSessions.map(s => {
                      const checked = form.session_ids.includes(s.id)
                      return (
                        <label key={s.id} onClick={() => toggleSession(s.id)}
                          className={`flex justify-between items-center p-3.5 rounded-xl border cursor-pointer transition-all ${checked ? 'border-primary-500/50 bg-primary-900/20' : 'border-surface-700 bg-surface-900/30 hover:border-surface-500'}`}>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center ${checked ? 'bg-primary-500 border-primary-500' : 'bg-surface-900 border-surface-600'}`}>
                              {checked && <MdPlayArrow className="text-white text-xs" />}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className={`text-sm font-bold truncate ${checked ? 'text-primary-300' : 'text-surface-300'}`}>{s.name}</span>
                              {s.phone_number && <span className={`text-[10px] font-mono mt-0.5 ${checked ? 'text-primary-400/80' : 'text-surface-500'}`}>{s.phone_number}</span>}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Botão Configurações Avançadas */}
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={openDrawer}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 bg-surface-800/50 hover:bg-surface-700/60 hover:border-primary-500/30 text-surface-400 hover:text-primary-300 transition-all text-sm font-medium group">
                  <MdSettings size={16} className="group-hover:rotate-45 transition-transform duration-300" />
                  Configurações Avançadas
                </button>
                <div className="flex flex-wrap gap-1.5">
                  {advBadgeParts.map((part, i) => (
                    <span key={i} className="text-[10px] font-semibold px-2 py-1 rounded-full border border-primary-500/25 bg-primary-900/15 text-primary-400/80 tracking-wide">{part}</span>
                  ))}
                </div>
              </div>

              {/* Preview resumo */}
              <div className="bg-surface-950/80 border border-surface-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-inner">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-xl font-black text-primary-400">{validMsgCount}</div>
                    <div className="text-[10px] text-surface-500 uppercase font-bold tracking-widest mt-1">Msg{validMsgCount !== 1 ? 's' : ''}</div>
                  </div>
                  <div className="w-[1px] h-8 bg-surface-800" />
                  <div className="text-center">
                    <div className="text-xl font-black text-primary-400">{chipCount}</div>
                    <div className="text-[10px] text-surface-500 uppercase font-bold tracking-widest mt-1">Chip{chipCount !== 1 ? 's' : ''}</div>
                  </div>
                  {adv.schedule_enabled && adv.schedule_date && adv.schedule_time && (
                    <>
                      <div className="w-[1px] h-8 bg-surface-800" />
                      <div className="text-center">
                        <MdSchedule className="text-yellow-400 mx-auto" size={20} />
                        <div className="text-[10px] text-yellow-400/80 uppercase font-bold tracking-widest mt-1">Agendado</div>
                      </div>
                    </>
                  )}
                </div>
                {chipCount > 0 && validMsgCount > 0
                  ? <p className="text-[11px] text-surface-400 font-medium leading-relaxed max-w-[220px]">Cada cliente receberá <strong className="text-surface-200">1</strong> mensagem enviada por <strong className="text-surface-200">1</strong> chip aleatório.</p>
                  : <p className="text-[11px] text-red-400/80 font-medium">Preencha as mensagens e selecione os chips.</p>
                }
              </div>

              {/* Rodapé */}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); setAdv(EMPTY_ADVANCED) }}
                  className="btn-secondary flex-1 py-3">Cancelar</button>
                <button type="submit" disabled={loading || chipCount === 0 || validMsgCount === 0}
                  className="btn-primary flex-[2] py-3 text-sm flex items-center justify-center gap-2">
                  {loading
                    ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" /> Criando...</>
                    : adv.schedule_enabled && adv.schedule_date ? 'Agendar Campanha' : 'Salvar e Iniciar Campanha'
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Drawer Configurações Avançadas ─────────────────────────────────── */}
      {showModal && (
        <>
          <div
            className={`fixed inset-0 z-[60] transition-opacity duration-300 ${showDrawer ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setShowDrawer(false)}
          />
          <div
            className="fixed top-0 right-0 h-full z-[61] flex flex-col"
            style={{
              width: 400,
              background: 'linear-gradient(160deg,#1a1228 0%,#120d1e 100%)',
              borderLeft: '1px solid rgba(157,78,221,0.2)',
              boxShadow: '-20px 0 60px rgba(0,0,0,0.6)',
              transform: showDrawer ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.32s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(157,78,221,0.2)' }}>
                  <MdSettings size={18} className="text-primary-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white leading-tight">Configurações de Disparo</h3>
                  <p className="text-[10px] text-surface-500 mt-0.5">Ajuste fino do comportamento</p>
                </div>
              </div>
              <button onClick={() => setShowDrawer(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-surface-500 hover:text-white hover:bg-white/10 transition-colors">
                <MdClose size={16} />
              </button>
            </div>

            {/* Conteúdo com scroll */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">

              {/* Agendamento */}
              <DrawerSection icon={MdSchedule} title="Agendamento">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-surface-300">Agendar envio</p>
                    <p className="text-[11px] text-surface-500 mt-0.5">Inicia automaticamente na data/hora</p>
                  </div>
                  <Toggle checked={drawerDraft.schedule_enabled} onChange={v => setDrawerDraft(d => ({ ...d, schedule_enabled: v }))} />
                </div>
                {drawerDraft.schedule_enabled && (
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div>
                      <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Data</label>
                      <input type="date" value={drawerDraft.schedule_date}
                        onChange={e => setDrawerDraft(d => ({ ...d, schedule_date: e.target.value }))}
                        className="input text-sm py-2" min={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div>
                      <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Hora</label>
                      <input type="time" value={drawerDraft.schedule_time}
                        onChange={e => setDrawerDraft(d => ({ ...d, schedule_time: e.target.value }))}
                        className="input text-sm py-2" />
                    </div>
                  </div>
                )}
              </DrawerSection>

              {/* Delay */}
              <DrawerSection icon={MdAccessTime} title="Delay entre mensagens">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Mínimo (s)</label>
                    <input type="number" min={1} value={drawerDraft.delay_min}
                      onChange={e => setDrawerDraft(d => ({ ...d, delay_min: e.target.value }))} className="input text-sm py-2" />
                  </div>
                  <div>
                    <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Máximo (s)</label>
                    <input type="number" min={1} value={drawerDraft.delay_max}
                      onChange={e => setDrawerDraft(d => ({ ...d, delay_max: e.target.value }))} className="input text-sm py-2" />
                  </div>
                </div>
                <p className="text-[11px] text-surface-500 mt-2">
                  Aguardará entre <span className="text-primary-400 font-semibold">{drawerDraft.delay_min}s</span> e <span className="text-primary-400 font-semibold">{drawerDraft.delay_max}s</span> entre cada envio.
                </p>
              </DrawerSection>

              {/* Limite de segurança */}
              <DrawerSection icon={MdShield} title="Limite de segurança">
                <div>
                  <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Máx. disparos por chip por dia</label>
                  <input type="number" min={1} value={drawerDraft.max_per_chip_per_day}
                    onChange={e => setDrawerDraft(d => ({ ...d, max_per_chip_per_day: e.target.value }))} className="input text-sm py-2" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs font-medium text-surface-300">Parar se chip desconectar</p>
                    <p className="text-[11px] text-surface-500 mt-0.5">Interrompe a campanha automaticamente</p>
                  </div>
                  <Toggle checked={drawerDraft.stop_on_disconnect} onChange={v => setDrawerDraft(d => ({ ...d, stop_on_disconnect: v }))} />
                </div>
              </DrawerSection>

              {/* Horário de envio */}
              <DrawerSection icon={MdSchedule} title="Horário de envio">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-surface-300">Apenas horário comercial</p>
                    <p className="text-[11px] text-surface-500 mt-0.5">Pausa fora do intervalo definido</p>
                  </div>
                  <Toggle checked={drawerDraft.business_hours_only} onChange={v => setDrawerDraft(d => ({ ...d, business_hours_only: v }))} />
                </div>
                {drawerDraft.business_hours_only && (
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <div>
                      <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Início</label>
                      <input type="time" value={drawerDraft.business_hours_start}
                        onChange={e => setDrawerDraft(d => ({ ...d, business_hours_start: e.target.value }))} className="input text-sm py-2" />
                    </div>
                    <div>
                      <label className="text-[11px] text-surface-400 font-semibold uppercase tracking-wider mb-1.5 block">Fim</label>
                      <input type="time" value={drawerDraft.business_hours_end}
                        onChange={e => setDrawerDraft(d => ({ ...d, business_hours_end: e.target.value }))} className="input text-sm py-2" />
                    </div>
                  </div>
                )}
              </DrawerSection>

              {/* Filtros de contato */}
              <DrawerSection icon={MdFilterList} title="Filtros de contato">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-surface-300">Ignorar sem nome salvo</p>
                    <p className="text-[11px] text-surface-500 mt-0.5">Pula contatos sem nome no cadastro</p>
                  </div>
                  <Toggle checked={drawerDraft.skip_unnamed_contacts} onChange={v => setDrawerDraft(d => ({ ...d, skip_unnamed_contacts: v }))} />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs font-medium text-surface-300">Evitar duplicatas</p>
                    <p className="text-[11px] text-surface-500 mt-0.5">Envia apenas uma vez por contato</p>
                  </div>
                  <Toggle checked={drawerDraft.no_duplicates} onChange={v => setDrawerDraft(d => ({ ...d, no_duplicates: v }))} />
                </div>
              </DrawerSection>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-white/10 flex-shrink-0">
              <button type="button" onClick={saveDrawer}
                className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{ background: 'linear-gradient(135deg,#9d4edd,#6a0dad)', boxShadow: '0 4px 20px rgba(157,78,221,0.35)' }}>
                Salvar configurações
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Modal de Relatório ──────────────────────────────────────────────── */}
      {reportCampaign && (
        <ReportModal campaign={reportCampaign} onClose={() => setReportCampaign(null)} />
      )}
    </div>
  )
}
