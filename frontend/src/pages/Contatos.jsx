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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Contatos</h1>
          <p className="text-sm text-gray-500">{total.toLocaleString('pt-BR')} contatos cadastrados</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-secondary flex items-center gap-2 cursor-pointer ${importing ? 'opacity-50' : ''}`}>
            <MdUpload /> {importing ? 'Importando...' : 'Importar XLSX'}
            <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" disabled={importing} />
          </label>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <MdDownload /> Exportar
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <MdAdd /> Adicionar
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-800/40 rounded-xl p-4">
        <MdInfo className="text-blue-400 text-xl mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-300">
          Contatos são extraídos automaticamente quando alguém envia mensagem para suas sessões conectadas. Você também pode adicionar manualmente ou importar via XLSX.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Buscar por nome ou número..."
            className="input pl-9"
          />
        </div>
        <select
          value={filterBlacklist === null ? '' : String(filterBlacklist)}
          onChange={e => {
            setFilterBlacklist(e.target.value === '' ? null : e.target.value === 'true')
            setPage(1)
          }}
          className="input w-auto"
        >
          <option value="">Todos</option>
          <option value="false">Ativos</option>
          <option value="true">Blacklist</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-3 pr-4 font-medium">Telefone</th>
                <th className="pb-3 pr-4 font-medium">Nome</th>
                <th className="pb-3 pr-4 font-medium">Status</th>
                <th className="pb-3 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-600">
                    Nenhum contato encontrado.
                  </td>
                </tr>
              ) : contacts.map(c => (
                <tr key={c.id}>
                  <td className="py-3 pr-4 text-gray-200 font-mono">{c.phone}</td>
                  <td className="py-3 pr-4 text-gray-300">{c.name || '–'}</td>
                  <td className="py-3 pr-4">
                    {c.is_blacklisted
                      ? <span className="badge-red">Blacklist</span>
                      : <span className="badge-green">Ativo</span>}
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleBlacklist(c.id)}
                        className={`p-1.5 rounded transition-colors ${
                          c.is_blacklisted
                            ? 'hover:bg-green-900/40 text-green-400'
                            : 'hover:bg-yellow-900/40 text-yellow-400'
                        }`}
                        title={c.is_blacklisted ? 'Remover da blacklist' : 'Adicionar à blacklist'}
                      >
                        <MdBlock />
                      </button>
                      <button
                        onClick={() => deleteContact(c.id)}
                        className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors"
                        title="Deletar"
                      >
                        <MdDelete />
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
          <div className="flex items-center justify-between pt-4 border-t border-gray-800 mt-2">
            <span className="text-xs text-gray-500">
              Página {page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary px-3 py-1 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary px-3 py-1 text-xs disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md">
            <h2 className="text-lg font-bold text-white mb-5">Adicionar Contato</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="label">Telefone</label>
                <input
                  name="phone" value={form.phone} onChange={update}
                  placeholder="5511999999999" required className="input"
                />
                <p className="text-xs text-gray-600 mt-1">Formato: 55 + DDD + número</p>
              </div>
              <div>
                <label className="label">Nome (opcional)</label>
                <input name="name" value={form.name} onChange={update}
                  placeholder="João Silva" className="input" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary flex-1">
                  Cancelar
                </button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  {loading ? 'Salvando...' : 'Adicionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
