import { useEffect, useState, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { Search, Download, Trash2, Upload, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

export default function Contatos() {
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [activeTag, setActiveTag] = useState('Todos')
  const [tags, setTags] = useState(['Todos'])
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const fileRef = useRef()
  const PAGE_SIZE = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page,
        page_size: PAGE_SIZE,
        ...(search && { search }),
        ...(activeTag !== 'Todos' && { tags: activeTag }),
      })
      const { data } = await api.get(`/contatos?${params}`)
      setContacts(Array.isArray(data.items) ? data.items : [])
      setTotal(data.total || 0)
      if (page === 1) {
        const allTags = new Set(['Todos'])
        ;(data.items || []).forEach(c => {
          if (c.tags) c.tags.split(',').forEach(t => allTags.add(t.trim()))
        })
        setTags([...allTags])
      }
    } catch {}
    setLoading(false)
  }, [page, search, activeTag])

  useEffect(() => { load() }, [load])

  async function bulkDelete() {
    if (!selected.length) return
    if (!window.confirm(`Remover ${selected.length} contatos?`)) return
    try {
      await api.delete('/contatos/bulk', { data: { ids: selected } })
      toast.success(`${selected.length} contatos removidos`)
      setSelected([])
      load()
    } catch {
      toast.error('Erro ao remover contatos')
    }
  }

  async function exportContacts() {
    try {
      const res = await api.get('/contatos/exportar/xlsx', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url; a.download = 'contatos.xlsx'; a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erro ao exportar')
    }
  }

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
      setShowImport(false); setImportFile(null); setImportPreview(null)
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao importar')
    }
    setImporting(false)
  }

  function getInitials(name) {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  }

  function formatDate(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('pt-BR')
  }

  const allSelected = contacts.length > 0 && selected.length === contacts.length

  return (
    <div className="flex gap-6 h-[calc(100vh-8rem)]">
      {/* Sidebar de tags */}
      <div className="w-48 shrink-0 glass-card p-3 space-y-1 overflow-y-auto">
        <p className="text-xs font-medium text-muted-foreground px-2 py-2">LISTAS</p>
        {tags.map(t => (
          <button key={t} onClick={() => { setActiveTag(t); setPage(1); setSelected([]) }}
            className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
              activeTag === t ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Área principal */}
      <div className="flex-1 flex flex-col space-y-4 min-w-0 overflow-hidden">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Buscar por nome ou telefone..."
              className="w-full bg-card/60 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50 backdrop-blur-md"
            />
          </div>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 glow-primary">
            <Upload className="h-4 w-4" /> Importar
          </button>
          <button onClick={exportContacts}
            className="flex items-center gap-2 px-4 rounded-xl glass-card text-sm text-muted-foreground hover:text-foreground">
            <Download className="h-4 w-4" /> Exportar
          </button>
        </div>

        {selected.length > 0 && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20 flex-wrap">
            <span className="text-sm text-primary font-medium">{selected.length} selecionados</span>
            <button onClick={bulkDelete}
              className="text-xs px-3 py-1 rounded-lg bg-destructive/20 text-destructive hover:bg-destructive/30 flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Remover
            </button>
            <button onClick={() => setSelected([])}
              className="text-xs px-3 py-1 rounded-lg bg-muted/40 text-muted-foreground hover:bg-muted/60">
              Cancelar
            </button>
          </div>
        )}

        <div className="glass-card overflow-auto flex-1">
          <table className="w-full">
            <thead className="sticky top-0 bg-card/80 backdrop-blur-sm z-10">
              <tr className="border-b border-white/5">
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" className="accent-primary" checked={allSelected}
                    onChange={e => setSelected(e.target.checked ? contacts.map(c => c.id) : [])} />
                </th>
                {['Nome', 'Telefone', 'Tags', 'Data'].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">Carregando...</td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-muted-foreground text-sm">Nenhum contato encontrado</td></tr>
              ) : contacts.map((c, i) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <input type="checkbox" className="accent-primary" checked={selected.includes(c.id)}
                      onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(s => s !== c.id))} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${c.is_blacklisted ? 'bg-destructive/20 text-destructive' : 'bg-primary/20 text-primary'}`}>
                        {getInitials(c.name)}
                      </div>
                      <div>
                        <span className="text-sm text-foreground/90">{c.name || '—'}</span>
                        {c.is_blacklisted && <span className="ml-2 text-xs text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">Blacklist</span>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-mono-data text-muted-foreground">{c.phone}</td>
                  <td className="px-4 py-3">
                    {c.tags ? (
                      <div className="flex gap-1 flex-wrap">
                        {c.tags.split(',').map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{t.trim()}</span>
                        ))}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(c.created_at)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{total.toLocaleString('pt-BR')} contatos no total</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 rounded-lg bg-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors">
                Anterior
              </button>
              <span className="px-3 py-1">Pág. {page} / {Math.ceil(total / PAGE_SIZE)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / PAGE_SIZE)}
                className="px-3 py-1 rounded-lg bg-muted/30 hover:bg-muted/50 disabled:opacity-40 transition-colors">
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Importar CSV */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          onClick={() => { setShowImport(false); setImportFile(null); setImportPreview(null) }}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg glass-card p-6"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold text-foreground/90">Importar Contatos</h2>
              <button onClick={() => { setShowImport(false); setImportFile(null); setImportPreview(null) }}
                className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            {!importFile ? (
              <div className="border-2 border-dashed border-white/10 rounded-xl p-10 text-center cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => fileRef.current?.click()}>
                <Upload className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Arraste seu arquivo CSV aqui</p>
                <p className="text-xs text-muted-foreground/60 mt-1">ou clique para selecionar</p>
                <p className="text-xs text-muted-foreground/40 mt-2">Colunas: telefone, nome (opcional), tags (opcional)</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileSelect} />
              </div>
            ) : importPreview ? (
              <div>
                <div className="p-3 rounded-xl bg-success/10 border border-success/20 mb-4">
                  <p className="text-sm text-success">
                    ✓ {importPreview.total || 0} contatos encontrados
                    {importPreview.duplicates ? ` · ${importPreview.duplicates} duplicados` : ''}
                  </p>
                </div>
                {(importPreview.sample || []).slice(0, 3).map((c, i) => (
                  <div key={i} className="flex gap-3 text-xs text-muted-foreground py-1.5 border-b border-white/5">
                    <span className="font-mono-data">{c.phone}</span>
                    <span>{c.name || '—'}</span>
                  </div>
                ))}
                {importPreview.total > 3 && <p className="text-xs text-muted-foreground mt-2">... e mais {importPreview.total - 3}</p>}
              </div>
            ) : <p className="text-sm text-muted-foreground text-center py-4">Analisando arquivo...</p>}

            {importFile && (
              <div className="flex gap-3 mt-4">
                <button onClick={() => { setImportFile(null); setImportPreview(null) }}
                  className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm hover:bg-muted/80">
                  Trocar arquivo
                </button>
                <button onClick={confirmImport} disabled={importing || !importPreview}
                  className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  {importing ? 'Importando...' : 'Confirmar Importação'}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  )
}
