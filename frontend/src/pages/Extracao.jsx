import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Search, MapPin, Users, FileDown, Smartphone, Play, Download, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const tabs = [
  { id: 'whatsapp', label: 'WhatsApp Grupos', icon: Smartphone },
  { id: 'csv',      label: 'Importar CSV',    icon: FileDown },
  { id: 'maps',     label: 'Google Maps',     icon: MapPin },
  { id: 'facebook', label: 'Facebook',        icon: Users },
]

export default function Extracao() {
  const [activeTab, setActiveTab] = useState('whatsapp')
  const [sessions, setSessions] = useState([])
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [groupUrl, setGroupUrl] = useState('')
  const [selectedSession, setSelectedSession] = useState('')
  const fileRef = useRef()

  // Load sessions on mount
  useState(() => {
    api.get('/sessoes').then(r => {
      const online = (Array.isArray(r.data) ? r.data : []).filter(s =>
        ['connected', 'working'].includes((s.status || '').toLowerCase())
      )
      setSessions(online)
      if (online.length > 0) setSelectedSession(String(online[0].id))
    }).catch(() => {})
  })

  async function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const { data } = await api.post('/contatos/importar-csv/preview', fd)
      setImportPreview(data)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao ler arquivo')
      setImportFile(null)
    }
  }

  async function confirmImport() {
    if (!importFile) return
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const { data } = await api.post('/contatos/importar-csv', fd)
      toast.success(`${data.imported || 0} contatos importados!`)
      setImportFile(null)
      setImportPreview(null)
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao importar')
    }
    setImporting(false)
  }

  async function exportResults() {
    if (!results.length) return
    const csv = ['telefone,nome', ...results.map(r => `${r.phone || r.telefone || ''},${r.name || r.nome || r.name || ''}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'extracao.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              activeTab === t.id ? 'bg-primary text-primary-foreground glow-primary' : 'glass-card text-muted-foreground hover:text-foreground'
            }`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Formulário */}
        <motion.div key={activeTab} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="glass-card p-6 space-y-4">

          {activeTab === 'whatsapp' && (
            <>
              <h3 className="text-sm font-medium text-foreground/90">Extrair de Grupos WhatsApp</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Link do Grupo</label>
                <input value={groupUrl} onChange={e => setGroupUrl(e.target.value)}
                  placeholder="https://chat.whatsapp.com/..."
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Chip para extração</label>
                <select value={selectedSession} onChange={e => setSelectedSession(e.target.value)}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50">
                  {sessions.length === 0
                    ? <option value="">Nenhum chip online</option>
                    : sessions.map(s => <option key={s.id} value={s.id}>{s.name} — Online</option>)
                  }
                </select>
              </div>
              <button
                onClick={() => toast.info('Extração de grupos em breve')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary">
                <Play className="h-4 w-4" /> Iniciar Extração
              </button>
            </>
          )}

          {activeTab === 'csv' && (
            <>
              <h3 className="text-sm font-medium text-foreground/90">Importar Arquivo CSV</h3>
              {!importFile ? (
                <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center cursor-pointer hover:border-primary/30 transition-colors"
                  onClick={() => fileRef.current?.click()}>
                  <FileDown className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Arraste seu arquivo CSV aqui</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">ou clique para selecionar</p>
                  <p className="text-xs text-muted-foreground/40 mt-2">Colunas: telefone, nome (opcional), tags (opcional)</p>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileSelect} />
                </div>
              ) : importPreview ? (
                <div>
                  <div className="p-3 rounded-xl bg-success/10 border border-success/20 mb-3">
                    <p className="text-sm text-success">✓ {importPreview.total || 0} contatos encontrados
                      {importPreview.duplicates ? ` · ${importPreview.duplicates} duplicados` : ''}
                    </p>
                  </div>
                  {(importPreview.sample || []).slice(0, 3).map((c, i) => (
                    <div key={i} className="flex gap-3 text-xs text-muted-foreground py-1.5 border-b border-white/5">
                      <span className="font-mono-data">{c.phone}</span>
                      <span>{c.name || '—'}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {importFile && (
                <div className="flex gap-3">
                  <button onClick={() => { setImportFile(null); setImportPreview(null) }}
                    className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80">
                    Trocar arquivo
                  </button>
                  <button onClick={confirmImport} disabled={importing || !importPreview}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                    {importing ? 'Importando...' : 'Importar Contatos'}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === 'maps' && (
            <>
              <h3 className="text-sm font-medium text-foreground/90">Extrair do Google Maps</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Palavra-chave</label>
                <input placeholder="Ex: restaurantes, clínicas..."
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Localização</label>
                <input placeholder="Ex: São Paulo, SP"
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div className="p-3 rounded-xl bg-warning/10 border border-warning/20">
                <p className="text-xs text-warning">⚠️ Extração do Google Maps requer integração adicional. Em breve.</p>
              </div>
              <button onClick={() => toast.info('Extração do Google Maps em breve')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary opacity-60 cursor-not-allowed">
                <Play className="h-4 w-4" /> Iniciar Extração
              </button>
            </>
          )}

          {activeTab === 'facebook' && (
            <>
              <h3 className="text-sm font-medium text-foreground/90">Extrair do Facebook</h3>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">URL do Grupo/Página</label>
                <input placeholder="https://facebook.com/groups/..."
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div className="p-3 rounded-xl bg-warning/10 border border-warning/20">
                <p className="text-xs text-warning">⚠️ Extração do Facebook requer integração adicional. Em breve.</p>
              </div>
              <button onClick={() => toast.info('Extração do Facebook em breve')}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary opacity-60 cursor-not-allowed">
                <Play className="h-4 w-4" /> Iniciar Extração
              </button>
            </>
          )}
        </motion.div>

        {/* Resultados */}
        <div className="glass-card p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-medium text-foreground/90">Resultados ({results.length})</h3>
            {results.length > 0 && (
              <button onClick={exportResults}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80">
                <Download className="h-3.5 w-3.5" /> Exportar CSV
              </button>
            )}
          </div>
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Search className="h-10 w-10 text-muted-foreground/20 mb-3" />
              <p className="text-sm text-muted-foreground">Inicie uma extração para ver os resultados</p>
            </div>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[400px]">
              {results.map((r, i) => (
                <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                  className="p-3 rounded-xl bg-muted/20 border border-white/5 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-foreground/90">{r.name || r.nome || '—'}</p>
                    {r.location && <p className="text-xs text-muted-foreground">{r.location}</p>}
                  </div>
                  <p className="text-xs font-mono-data text-muted-foreground">{r.phone || r.telefone}</p>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
