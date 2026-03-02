import { useEffect, useState, useCallback } from 'react'
import {
  MdAdd, MdUpload, MdDownload, MdDelete, MdBlock, MdSearch, MdInfo,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

export default function Contatos() {
  const [contacts, setContacts] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterBlacklist, setFilterBlacklist] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [form, setForm] = useState({ phone: '', name: '' })

  const PAGE_SIZE = 20
  const isNew = (createdAt) => createdAt && (Date.now() - new Date(createdAt)) < 86400000

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page, page_size: PAGE_SIZE,
        ...(search && { search }),
        ...(filterBlacklist !== null && { blacklisted: filterBlacklist }),
      })
      const { data } = await api.get(`/contatos?${params}`)
      setContacts(data.items)
      setTotal(data.total)
    } catch {
      toast.error('Erro ao carregar contatos')
    }
  }, [page, search, filterBlacklist])

  useEffect(() => { load() }, [load])

  const update = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  async function handleCreate(e) {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/contatos', form)
      toast.success('Contato adicionado!')
      setShowModal(false)
      setForm({ phone: '', name: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao adicionar')
    } finally {
      setLoading(false)
    }
  }

  async function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const { data } = await api.post('/contatos/importar', fd)
      toast.success(`Importados: ${data.imported} | Ignorados: ${data.skipped}`)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao importar')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  async function handleExport() {
    try {
      const resp = await api.get('/contatos/exportar/xlsx', { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = 'contatos.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Erro ao exportar')
    }
  }

  async function toggleBlacklist(id) {
    try {
      const { data } = await api.post(`/contatos/${id}/blacklist`)
      toast.success(data.is_blacklisted ? 'Adicionado à blacklist' : 'Removido da blacklist')
      load()
    } catch {
      toast.error('Erro')
    }
  }

  async function deleteContact(id) {
    if (!confirm('Deletar contato?')) return
    try {
      await api.delete(`/contatos/${id}`)
      toast.success('Contato deletado')
      load()
    } catch {
      toast.error('Erro ao deletar')
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Contatos</h1>
          <p className="text-sm text-surface-400 mt-1">{total.toLocaleString('pt-BR')} contatos cadastrados</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className={`btn-secondary flex items-center gap-2 cursor-pointer ${importing ? 'opacity-50' : ''}`}>
            {importing ? (
              <div className="w-4 h-4 border-2 border-surface-400 border-t-white rounded-full animate-spin" />
            ) : (
              <MdUpload size={18} />
            )}
            {importing ? 'Importando...' : 'Importar XLSX'}
            <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" disabled={importing} />
          </label>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <MdDownload size={18} /> Exportar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <MdAdd size={20} /> Adicionar
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-primary-900/10 border border-primary-500/20 backdrop-blur-md rounded-2xl p-4 shadow-inner">
        <MdInfo className="text-primary-400 text-xl mt-0.5 flex-shrink-0 drop-shadow-[0_0_8px_rgba(139,92,246,0.4)]" />
        <p className="text-sm text-primary-200/80 leading-relaxed font-medium">
          Contatos são extraídos automaticamente quando alguém envia mensagem para suas sessões conectadas. Você também pode adicionar manualmente ou importar via XLSX.
        </p>
      </div>

      {/* Filters */}
      <div className="glass-card p-4 flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <MdSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 text-lg" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar por nome ou número..."
            className="input pl-10 w-full"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-surface-400 whitespace-nowrap hidden sm:block">Filtrar por Status:</label>
          <select
            value={filterBlacklist === null ? '' : String(filterBlacklist)}
            onChange={e => {
              setFilterBlacklist(e.target.value === '' ? null : e.target.value === 'true')
              setPage(1)
            }}
            className="input w-40"
          >
            <option value="">Todos os status</option>
            <option value="false">Apenas Ativos</option>
            <option value="true">Na Blacklist</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-900/50">
              <tr className="text-left text-surface-400 border-b border-surface-700/50">
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Telefone</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Nome</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-xs">Status</th>
                <th className="px-6 py-4 font-semibold tracking-wider text-xs text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/50">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-16 text-center text-surface-500">
                    <div className="flex flex-col items-center justify-center">
                      <MdSearch className="text-4xl mb-3 text-surface-600" />
                      <p className="font-medium text-surface-400">Nenhum contato encontrado.</p>
                      <p className="text-xs mt-1">Tente ajustar seus filtros de busca.</p>
                    </div>
                  </td>
                </tr>
              ) : contacts.map(c => (
                <tr key={c.id} className="hover:bg-surface-800/30 transition-colors">
                  <td className="px-6 py-4 text-surface-200 font-mono">
                    <div className="flex items-center gap-3">
                      <span className="bg-surface-950 px-2.5 py-1 rounded border border-surface-800 shadow-inner">
                        {c.phone}
                      </span>
                      {isNew(c.created_at) && (
                        <span className="text-[10px] uppercase font-bold tracking-wider bg-primary-500/20 text-primary-400 border border-primary-500/30 rounded px-1.5 py-0.5">Novo</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-surface-300 font-medium">
                    {c.name || <span className="text-surface-600 italic font-normal">Sem nome</span>}
                  </td>
                  <td className="px-6 py-4">
                    {c.is_blacklisted
                      ? <span className="badge-red">Blacklist</span>
                      : <span className="badge-green">Ativo</span>}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => toggleBlacklist(c.id)}
                        className={`p-2 rounded-lg transition-all border border-transparent ${c.is_blacklisted
                            ? 'hover:bg-primary-900/30 text-primary-400 hover:border-primary-500/20'
                            : 'hover:bg-amber-900/30 text-amber-400 hover:border-amber-500/20'
                          }`}
                        title={c.is_blacklisted ? 'Remover da blacklist' : 'Adicionar à blacklist'}
                      >
                        <MdBlock size={18} />
                      </button>
                      <button
                        onClick={() => deleteContact(c.id)}
                        className="p-2 rounded-lg hover:bg-red-900/20 text-surface-500 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                        title="Deletar contato"
                      >
                        <MdDelete size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-surface-700/50 bg-surface-900/30">
            <span className="text-sm font-medium text-surface-500">
              Página <span className="text-surface-200">{page}</span> de <span className="text-surface-200">{totalPages}</span>
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary px-4 py-1.5 text-sm disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary px-4 py-1.5 text-sm disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="glass-card w-full max-w-md p-0 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] border-surface-600/50 animate-[slideIn_0.3s_ease-out]">
            <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                  <MdAdd size={20} />
                </div>
                Adicionar Contato
              </h2>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-5">
              <div>
                <label className="label">Telefone</label>
                <input
                  name="phone" value={form.phone} onChange={update}
                  placeholder="5511999999999" required className="input"
                />
                <p className="text-[11px] font-medium text-surface-500 mt-1.5 ml-1">Formato: 55 + DDD + número (apenas números)</p>
              </div>
              <div>
                <label className="label">Nome <span className="text-surface-500 font-normal">(opcional)</span></label>
                <input name="name" value={form.name} onChange={update}
                  placeholder="Ex: João da Silva" className="input" />
              </div>

              <div className="flex gap-3 pt-4 border-t border-surface-700/50 mt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1 py-2.5">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1 py-2.5">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Salvando...
                    </span>
                  ) : 'Adicionar Contato'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
