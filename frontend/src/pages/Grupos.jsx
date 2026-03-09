import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import toast from 'react-hot-toast'
import {
  MdGroup, MdRefresh, MdDelete, MdPeople, MdCheckBox, MdCheckBoxOutlineBlank,
  MdIndeterminateCheckBox, MdClose, MdDownload, MdAutorenew, MdSchedule,
  MdSearch, MdCampaign, MdFilterList, MdOutlineCampaign, MdCleaningServices,
} from 'react-icons/md'

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

function horasAtras(dateStr) {
  if (!dateStr) return null
  const diffH = Math.floor((Date.now() - new Date(dateStr).getTime()) / 3600000)
  if (diffH < 1) return 'menos de 1h atrás'
  if (diffH < 24) return `${diffH}h atrás`
  return `${Math.floor(diffH / 24)}d atrás`
}

function proximaExtracao(dateStr, intervalHours) {
  if (!dateStr || !intervalHours) return null
  const diffMs = new Date(dateStr).getTime() + intervalHours * 3600000 - Date.now()
  if (diffMs <= 0) return 'Em breve'
  const diffH = Math.ceil(diffMs / 3600000)
  return diffH < 24 ? `em ${diffH}h` : `em ${Math.floor(diffH / 24)}d`
}

function exportCSV(members, groupName) {
  const header = ['Nome', 'Telefone', 'Admin', 'Status', 'Adicionado em']
  const rows = members.map(m => [
    m.name || '',
    m.phone,
    m.is_admin ? 'Sim' : 'Não',
    m.is_blacklisted ? 'Bloqueado' : 'Ativo',
    new Date(m.added_at).toLocaleString('pt-BR'),
  ])
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: `${groupName}-contatos.csv` }).click()
  URL.revokeObjectURL(url)
}

const AUTO_OPTIONS = [
  { label: 'Desativado', value: null },
  { label: 'A cada 6h', value: 6 },
  { label: 'A cada 12h', value: 12 },
  { label: 'A cada 24h', value: 24 },
  { label: 'A cada 7 dias', value: 168 },
]

const FILTER_TABS = [
  { key: 'all', label: 'Todos' },
  { key: 'named', label: 'Com nome' },
  { key: 'unnamed', label: 'Sem nome' },
  { key: 'admins', label: 'Admins' },
]

const MODAL_PAGE_SIZE = 50

// ── Componente principal ──────────────────────────────────────────────────────

export default function Grupos() {
  // ── Sessões e grupos (lista principal) ─────────────────────────────────────
  const [sessoes, setSessoes] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [wahaGroups, setWahaGroups] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loadingWaha, setLoadingWaha] = useState(false)
  const [lastResult, setLastResult] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [dbGroups, setDbGroups] = useState([])
  const [dbTotal, setDbTotal] = useState(0)
  const [dbPage, setDbPage] = useState(1)
  const [dbLoadingMore, setDbLoadingMore] = useState(false)
  const DB_PAGE_SIZE = 50
  const [autoUpdateLoading, setAutoUpdateLoading] = useState({})
  const [cleaning, setCleaning] = useState(false)

  // ── Modal de contatos ────────────────────────────────────────────────────────
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [modalGroup, setModalGroup] = useState(null)
  const [modalMembers, setModalMembers] = useState([])
  const [modalTotal, setModalTotal] = useState(0)
  const [modalPage, setModalPage] = useState(1)
  const [modalSearch, setModalSearch] = useState('')
  const [modalFilter, setModalFilter] = useState('all')
  const [modalLoading, setModalLoading] = useState(false)
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set()) // GroupMember.id

  // ── Campaign picker ──────────────────────────────────────────────────────────
  const [campaigns, setCampaigns] = useState([])
  const [campaignPicker, setCampaignPicker] = useState(null) // { contactIds: [int] }
  const [addingToCampaign, setAddingToCampaign] = useState(false)

  const searchTimer = useRef(null)

  // ── Sessões ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/sessoes').then(r => setSessoes(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedSession) {
      setWahaGroups([])
      setSelectedIds(new Set())
      setDbGroups([])
      setLastResult(null)
      return
    }
    loadWahaGroups()
    loadDbGroups()
  }, [selectedSession])

  const loadWahaGroups = async () => {
    setLoadingWaha(true)
    setLastResult(null)
    try {
      const { data } = await api.get(`/grupos/session/${selectedSession}/waha-list`)
      setWahaGroups(data.groups || [])
      setSelectedIds(new Set((data.groups || []).filter(g => !g.already_extracted).map(g => g.id)))
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao carregar grupos')
      setWahaGroups([])
    } finally {
      setLoadingWaha(false)
    }
  }

  const loadDbGroups = async (page = 1, append = false) => {
    if (!append) setDbPage(1)
    else setDbLoadingMore(true)
    try {
      const { data } = await api.get('/grupos', {
        params: { session_id: selectedSession, page_size: DB_PAGE_SIZE, page },
      })
      const items = data.items || []
      setDbGroups(prev => append ? [...prev, ...items] : items)
      setDbTotal(data.total || 0)
      setDbPage(page)
    } catch {
      if (!append) setDbGroups([])
    } finally {
      setDbLoadingMore(false)
    }
  }

  const loadMoreGroups = () => loadDbGroups(dbPage + 1, true)

  // ── Modal de contatos ────────────────────────────────────────────────────────

  const loadModalMembers = useCallback(async (groupId, page, search, filter) => {
    setModalLoading(true)
    try {
      const params = { page, page_size: MODAL_PAGE_SIZE }
      if (search?.trim()) params.search = search.trim()
      if (filter && filter !== 'all') params.filter_type = filter
      const { data } = await api.get(`/grupos/${groupId}/members`, { params })
      setModalMembers(data.items || [])
      setModalTotal(data.total || 0)
    } catch {
      toast.error('Erro ao carregar membros')
    } finally {
      setModalLoading(false)
    }
  }, [])

  const openMemberModal = async (group) => {
    setModalGroup(group)
    setModalPage(1)
    setModalSearch('')
    setModalFilter('all')
    setSelectedMemberIds(new Set())
    setShowMemberModal(true)
    loadModalMembers(group.id, 1, '', 'all')
    api.get('/campanhas?page_size=100').then(r => setCampaigns(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }

  const closeMemberModal = () => {
    setShowMemberModal(false)
    setModalGroup(null)
    setModalMembers([])
    setCampaignPicker(null)
  }

  const handleSearch = (val) => {
    setModalSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setModalPage(1)
      loadModalMembers(modalGroup.id, 1, val, modalFilter)
    }, 380)
  }

  const handleFilter = (f) => {
    setModalFilter(f)
    setModalPage(1)
    loadModalMembers(modalGroup.id, 1, modalSearch, f)
  }

  const handlePage = (p) => {
    setModalPage(p)
    loadModalMembers(modalGroup.id, p, modalSearch, modalFilter)
  }

  const toggleMember = (id) => {
    setSelectedMemberIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAllPage = () => {
    const pageIds = modalMembers.map(m => m.id)
    const allSelected = pageIds.every(id => selectedMemberIds.has(id))
    setSelectedMemberIds(prev => {
      const next = new Set(prev)
      pageIds.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const openCampaignPicker = (contactIds) => {
    const validIds = contactIds.filter(Boolean)
    if (validIds.length === 0) {
      toast.error('Nenhum contato com cadastro vinculado')
      return
    }
    setCampaignPicker({ contactIds: validIds })
  }

  const addToCampaign = async (campaignId) => {
    if (!campaignPicker || !modalGroup) return
    setAddingToCampaign(true)
    try {
      const { data } = await api.post(`/grupos/${modalGroup.id}/add-contacts-to-campaign`, {
        campaign_id: campaignId,
        contact_ids: campaignPicker.contactIds,
      })
      toast.success(data.message)
      setCampaignPicker(null)
      setSelectedMemberIds(new Set())
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao adicionar à campanha')
    } finally {
      setAddingToCampaign(false)
    }
  }

  // ── Outros ───────────────────────────────────────────────────────────────────

  const extractSelected = async () => {
    if (selectedIds.size === 0) { toast.error('Selecione ao menos um grupo'); return }
    setExtracting(true)
    setLastResult(null)
    try {
      const { data } = await api.post(`/grupos/session/${selectedSession}/extract-selected`, { group_ids: Array.from(selectedIds) })
      setLastResult(data)
      toast.success(data.message)
      await Promise.all([loadWahaGroups(), loadDbGroups()])
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro na extração')
    } finally {
      setExtracting(false)
    }
  }

  const deleteGroup = async (groupId) => {
    if (!confirm('Deletar este grupo e seus membros?')) return
    try {
      await api.delete(`/grupos/${groupId}`)
      toast.success('Grupo deletado')
      loadDbGroups()
    } catch {
      toast.error('Erro ao deletar grupo')
    }
  }

  const setAutoUpdate = async (groupId, intervalValue) => {
    setAutoUpdateLoading(prev => ({ ...prev, [groupId]: true }))
    try {
      await api.patch(`/grupos/${groupId}/auto-update`, { auto_update_interval: intervalValue })
      setDbGroups(prev => prev.map(g => g.id === groupId ? { ...g, auto_update_interval: intervalValue } : g))
      toast.success(intervalValue ? `Auto-atualização ativada: a cada ${intervalValue}h` : 'Auto-atualização desativada')
    } catch {
      toast.error('Erro ao salvar configuração')
    } finally {
      setAutoUpdateLoading(prev => ({ ...prev, [groupId]: false }))
    }
  }

  const cleanupSmallGroups = async () => {
    if (!confirm('Deletar todos os grupos com 0 ou 1 membro? Esta ação não pode ser desfeita.')) return
    setCleaning(true)
    try {
      const { data } = await api.delete('/grupos/cleanup')
      toast.success(data.message)
      loadDbGroups()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Erro ao limpar grupos')
    } finally {
      setCleaning(false)
    }
  }

  const toggleGroup = (id) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => selectedIds.size === wahaGroups.length ? setSelectedIds(new Set()) : setSelectedIds(new Set(wahaGroups.map(g => g.id)))

  const allChecked = wahaGroups.length > 0 && selectedIds.size === wahaGroups.length
  const someChecked = selectedIds.size > 0 && selectedIds.size < wahaGroups.length
  const totalPages = Math.ceil(modalTotal / MODAL_PAGE_SIZE)
  const pageIds = modalMembers.map(m => m.id)
  const allPageSelected = pageIds.length > 0 && pageIds.every(id => selectedMemberIds.has(id))
  const somePageSelected = pageIds.some(id => selectedMemberIds.has(id))
  const selectedWithContact = modalMembers.filter(m => selectedMemberIds.has(m.id) && m.contact_id)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Grupos do WhatsApp</h1>
        <p className="text-sm text-surface-400 mt-1">
          Selecione uma sessão, marque os grupos e extraia os membros. Admins, números fora do Brasil e números inválidos são ignorados automaticamente.
        </p>
      </div>

      {/* Seleção de sessão */}
      <div className="glass-card p-6">
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-surface-300 mb-1.5 ml-1">Sessão WhatsApp</label>
            <select
              value={selectedSession || ''}
              onChange={e => setSelectedSession(e.target.value ? parseInt(e.target.value) : null)}
              className="input w-full"
            >
              <option value="">-- Selecione uma sessão --</option>
              {sessoes.map(s => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
            </select>
          </div>
          {selectedSession && (
            <button onClick={loadWahaGroups} disabled={loadingWaha} className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50 py-2.5 h-[42px]">
              <MdRefresh className={loadingWaha ? 'animate-spin' : ''} size={18} /> Atualizar lista
            </button>
          )}
        </div>
      </div>

      {/* Resultado da última extração */}
      {lastResult && (
        <div className="bg-primary-900/20 border border-primary-500/30 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-[-50%] right-[-10%] w-[40%] h-[200%] bg-primary-500/10 blur-[50px] pointer-events-none rounded-full" />
          <p className="font-semibold text-primary-400 mb-4 flex items-center gap-2 relative z-10"><MdCheckBox size={20} /> Extração concluída com sucesso</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm relative z-10">
            {[
              { val: lastResult.extracted_members, label: 'Membros salvos', color: 'text-primary-400' },
              { val: lastResult.skipped_admin, label: 'Admins ignorados', color: 'text-surface-200' },
              { val: lastResult.skipped_nonbr, label: 'Não-BR ignorados', color: 'text-surface-200' },
              { val: lastResult.skipped_invalid, label: 'Inválidos ignorados', color: 'text-surface-200' },
            ].map(({ val, label, color }) => (
              <div key={label} className="bg-surface-950/50 border border-surface-700/50 rounded-xl p-4 text-center shadow-inner">
                <div className={`text-3xl font-bold ${color}`}>{val}</div>
                <div className="text-surface-400 text-xs mt-1.5 font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista WAHA */}
      {selectedSession && (
        <div className="glass-card overflow-hidden p-0">
          <div className="px-6 py-4 border-b border-surface-700/50 flex items-center justify-between flex-wrap gap-4 bg-surface-900/30">
            <div>
              <h2 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center"><MdGroup size={18} /></div>
                Grupos disponíveis
                {wahaGroups.length > 0 && <span className="text-xs font-medium text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">{wahaGroups.length}</span>}
              </h2>
              {selectedIds.size > 0 && (
                <p className="text-xs text-primary-400 font-medium mt-1 ml-10 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" /> {selectedIds.size} selecionado(s)
                </p>
              )}
            </div>
            <div className="flex gap-3">
              {wahaGroups.length > 0 && (
                <button onClick={toggleAll} className="btn-secondary flex items-center gap-2 text-sm py-2 px-4">
                  {allChecked ? <MdCheckBox size={20} className="text-primary-400" /> : someChecked ? <MdIndeterminateCheckBox size={20} className="text-primary-400" /> : <MdCheckBoxOutlineBlank size={20} className="text-surface-400" />}
                  {allChecked ? 'Desmarcar todos' : 'Selecionar'}
                </button>
              )}
              <button onClick={extractSelected} disabled={extracting || selectedIds.size === 0} className="btn-primary flex items-center gap-2 disabled:opacity-40 py-2 px-5">
                {extracting ? <><div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />Extraindo...</> : <><MdDownload size={20} />Extrair ({selectedIds.size})</>}
              </button>
            </div>
          </div>

          {loadingWaha ? (
            <div className="flex flex-col items-center justify-center py-20 text-surface-400">
              <div className="w-10 h-10 border-2 border-surface-700 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="font-medium text-sm">Carregando grupos...</p>
            </div>
          ) : wahaGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <div className="w-16 h-16 rounded-full bg-surface-800/50 flex items-center justify-center mb-4 border border-surface-700/50"><MdGroup size={32} className="text-surface-600" /></div>
              <p className="text-sm font-medium text-surface-300">Nenhum grupo encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-900/90 backdrop-blur-md border-b border-surface-700/50 z-10">
                  <tr>
                    <th className="w-12 px-5 py-3.5">
                      <button onClick={toggleAll} className="text-surface-500 hover:text-surface-200 transition-colors">
                        {allChecked ? <MdCheckBox size={20} className="text-primary-500" /> : someChecked ? <MdIndeterminateCheckBox size={20} className="text-primary-500" /> : <MdCheckBoxOutlineBlank size={20} />}
                      </button>
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Nome do Grupo</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Participantes</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800/50">
                  {wahaGroups.map(grupo => (
                    <tr key={grupo.id} onClick={() => toggleGroup(grupo.id)} className={`cursor-pointer transition-all ${selectedIds.has(grupo.id) ? 'bg-primary-900/10 hover:bg-primary-900/20' : 'hover:bg-surface-800/40'}`}>
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleGroup(grupo.id)}>
                          {selectedIds.has(grupo.id) ? <MdCheckBox size={20} className="text-primary-500 drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]" /> : <MdCheckBoxOutlineBlank size={20} className="text-surface-500" />}
                        </button>
                      </td>
                      <td className="px-5 py-4 font-medium text-surface-100 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${selectedIds.has(grupo.id) ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-400'}`}>
                          {grupo.name.substring(0, 2).toUpperCase()}
                        </div>
                        {grupo.name}
                      </td>
                      <td className="px-5 py-4 text-surface-400">
                        <span className="flex items-center gap-1.5 bg-surface-800/50 px-2.5 py-1 rounded-lg w-max border border-surface-700/50"><MdPeople size={16} className="text-surface-500" />{grupo.size}</span>
                      </td>
                      <td className="px-5 py-4">
                        {grupo.already_extracted ? <span className="badge-primary">Já extraído</span> : <span className="badge-gray">Novo grupo</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Grupos processados (banco) */}
      {selectedSession && dbGroups.length > 0 && (
        <div className="glass-card overflow-hidden p-0">
          <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/30 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center"><MdCheckBox size={18} /></div>
              Grupos processados
              <span className="ml-2 text-xs font-medium text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">{dbTotal} salvos</span>
            </h2>
            <button
              onClick={cleanupSmallGroups}
              disabled={cleaning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 border border-red-500/25 bg-red-900/10 hover:bg-red-900/25 hover:border-red-500/40 transition-all disabled:opacity-50"
              title="Deletar grupos com 0 ou 1 membro"
            >
              {cleaning
                ? <div className="w-3.5 h-3.5 border-2 border-red-400/30 border-t-red-400 rounded-full animate-spin" />
                : <MdCleaningServices size={15} />
              }
              Limpar grupos vazios
            </button>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-sm" style={{ minWidth: 600 }}>
              <thead className="bg-surface-900/50 border-b border-surface-700/50">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Nome</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Membros</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider hidden md:table-cell">Última extração</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider hidden lg:table-cell">Auto-atualização</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/50">
                {dbGroups.map(grupo => {
                  const proxima = proximaExtracao(grupo.last_extracted_at, grupo.auto_update_interval)
                  const isAutoActive = !!grupo.auto_update_interval
                  return (
                    <tr key={grupo.id} className="hover:bg-surface-800/30 transition-colors">
                      <td className="px-6 py-4 font-medium text-surface-100">
                        <div className="flex items-center gap-2">
                          {grupo.name}
                          {isAutoActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400 border border-green-500/30">
                              <MdAutorenew size={11} className="animate-spin" style={{ animationDuration: '3s' }} /> Auto
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4"><span className="badge-primary px-2.5 py-1">{grupo.member_count} membros</span></td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-surface-300 font-medium flex items-center gap-1"><MdSchedule size={13} className="text-surface-500" />{horasAtras(grupo.last_extracted_at) || '–'}</span>
                          {proxima && <span className="text-[11px] text-green-400/80 font-medium">Próxima: {proxima}</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <div className="flex items-center gap-2">
                          {autoUpdateLoading[grupo.id] && <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin" />}
                          <select
                            value={grupo.auto_update_interval ?? ''}
                            onChange={e => setAutoUpdate(grupo.id, e.target.value === '' ? null : parseInt(e.target.value))}
                            disabled={autoUpdateLoading[grupo.id]}
                            className="text-xs rounded-lg px-2 py-1.5 border border-surface-700/60 bg-surface-800/60 text-surface-300 focus:outline-none focus:border-primary-500/50 disabled:opacity-50 hover:border-surface-500 cursor-pointer"
                            style={{ minWidth: 130 }}
                          >
                            {AUTO_OPTIONS.map(opt => <option key={String(opt.value)} value={opt.value ?? ''}>{opt.label}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            onClick={() => openMemberModal(grupo)}
                            className="text-xs text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 bg-primary-900/10 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5"
                          >
                            <MdPeople size={15} /> Ver contatos
                          </button>
                          <button onClick={() => deleteGroup(grupo.id)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-surface-500 hover:text-red-400 transition-colors border border-transparent hover:border-red-500/20" title="Excluir grupo">
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

          {/* Footer: contador + Carregar mais */}
          <div className="px-6 py-4 border-t border-surface-800/50 flex items-center justify-between bg-surface-900/20">
            <span className="text-xs text-surface-500">
              Mostrando <strong className="text-surface-300">{dbGroups.length}</strong> de <strong className="text-surface-300">{dbTotal}</strong> grupos
            </span>
            {dbGroups.length < dbTotal && (
              <button
                onClick={loadMoreGroups}
                disabled={dbLoadingMore}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-primary-400 border border-primary-500/30 bg-primary-900/10 hover:bg-primary-900/30 transition-all disabled:opacity-40"
              >
                {dbLoadingMore && <div className="w-3.5 h-3.5 border-2 border-primary-400/30 border-t-primary-400 rounded-full animate-spin" />}
                {dbLoadingMore ? 'Carregando...' : 'Carregar mais'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Estado vazio */}
      {!selectedSession && (
        <div className="glass-card flex flex-col items-center justify-center py-24 text-surface-500 border-dashed border-2 border-surface-700 bg-surface-900/20">
          <div className="w-20 h-20 rounded-full bg-surface-800 flex items-center justify-center mb-6 shadow-inner"><MdGroup size={40} className="text-surface-600" /></div>
          <p className="text-lg font-semibold text-surface-300">Selecione uma sessão do WhatsApp</p>
          <p className="text-sm text-surface-500 mt-2 max-w-sm text-center">Para visualizar e extrair grupos, selecione uma sessão conectada acima.</p>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          MODAL DE CONTATOS DO GRUPO
      ════════════════════════════════════════════════════════════════════════ */}
      {showMemberModal && modalGroup && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div
            className="w-full flex flex-col rounded-2xl overflow-hidden"
            style={{
              maxWidth: 900,
              maxHeight: '92vh',
              background: 'linear-gradient(160deg,#1a1228 0%,#120d1e 100%)',
              border: '1px solid rgba(157,78,221,0.25)',
              boxShadow: '0 0 80px rgba(0,0,0,0.7)',
            }}
          >
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0" style={{ background: 'rgba(157,78,221,0.07)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,rgba(157,78,221,0.3),rgba(106,13,173,0.2))', border: '1px solid rgba(157,78,221,0.3)' }}>
                  <MdPeople size={22} className="text-primary-400" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white truncate">{modalGroup.name}</h2>
                  <p className="text-xs text-primary-400/80 font-medium mt-0.5">{modalTotal} contatos extraídos</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => exportCSV(modalMembers, modalGroup.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-300 border border-primary-500/30 bg-primary-900/20 hover:bg-primary-900/40 transition-colors"
                >
                  <MdDownload size={15} /> Exportar CSV
                </button>
                <button onClick={closeMemberModal} className="w-8 h-8 rounded-full flex items-center justify-center text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
                  <MdClose size={18} />
                </button>
              </div>
            </div>

            {/* ── Toolbar ────────────────────────────────────────────────────── */}
            <div className="px-6 py-3 border-b border-white/10 flex-shrink-0 space-y-3">
              {/* Search */}
              <div className="relative">
                <MdSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 pointer-events-none" />
                <input
                  value={modalSearch}
                  onChange={e => handleSearch(e.target.value)}
                  placeholder="Buscar por nome ou telefone..."
                  className="input pl-9 py-2 text-sm w-full"
                />
              </div>

              {/* Filter tabs + bulk action */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {FILTER_TABS.map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => handleFilter(tab.key)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={modalFilter === tab.key
                        ? { background: 'linear-gradient(135deg,rgba(157,78,221,0.3),rgba(106,13,173,0.2))', color: '#c084fc', border: '1px solid rgba(157,78,221,0.4)' }
                        : { color: '#64748b', background: 'transparent', border: '1px solid transparent' }
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {selectedMemberIds.size > 0 && (
                  <button
                    onClick={() => openCampaignPicker(selectedWithContact.map(m => m.contact_id))}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={{ background: 'linear-gradient(135deg,rgba(157,78,221,0.25),rgba(106,13,173,0.2))', color: '#c084fc', border: '1px solid rgba(157,78,221,0.4)' }}
                  >
                    <MdCampaign size={15} />
                    Adicionar {selectedMemberIds.size} à campanha
                  </button>
                )}
              </div>
            </div>

            {/* ── Tabela ─────────────────────────────────────────────────────── */}
            <div className="flex-1 overflow-auto custom-scrollbar">
              {modalLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-surface-400">
                  <div className="w-10 h-10 border-2 border-surface-700 border-t-primary-500 rounded-full animate-spin mb-4" />
                  <p className="text-sm font-medium">Carregando contatos...</p>
                </div>
              ) : modalMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-surface-500">
                  <MdPeople size={40} className="mb-4 opacity-30" />
                  <p className="text-sm font-medium text-surface-300">Nenhum contato encontrado.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 border-b border-white/10" style={{ background: 'rgba(11,9,20,0.95)', backdropFilter: 'blur(8px)' }}>
                    <tr>
                      <th className="w-12 px-5 py-3">
                        <button onClick={toggleAllPage}>
                          {allPageSelected
                            ? <MdCheckBox size={18} className="text-primary-500" />
                            : somePageSelected
                              ? <MdIndeterminateCheckBox size={18} className="text-primary-500" />
                              : <MdCheckBoxOutlineBlank size={18} className="text-surface-500" />
                          }
                        </button>
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Contato</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Telefone</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Extraído em</th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {modalMembers.map(m => {
                      const initials = (m.name || m.phone || '?').charAt(0).toUpperCase()
                      const selected = selectedMemberIds.has(m.id)
                      return (
                        <tr
                          key={m.id}
                          className={`transition-colors ${selected ? 'bg-primary-900/10' : 'hover:bg-white/[0.03]'}`}
                        >
                          {/* Checkbox */}
                          <td className="px-5 py-3.5">
                            <button onClick={() => toggleMember(m.id)}>
                              {selected
                                ? <MdCheckBox size={18} className="text-primary-500" />
                                : <MdCheckBoxOutlineBlank size={18} className="text-surface-600" />
                              }
                            </button>
                          </td>

                          {/* Avatar + Nome */}
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                                style={{ background: selected ? 'rgba(157,78,221,0.25)' : 'rgba(157,78,221,0.1)', color: '#c084fc', border: `1px solid ${selected ? 'rgba(157,78,221,0.4)' : 'rgba(157,78,221,0.2)'}` }}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0">
                                {m.name
                                  ? <span className="text-surface-100 font-medium truncate block">{m.name}</span>
                                  : <span className="text-surface-600 italic text-xs">Sem nome</span>
                                }
                                {m.is_admin && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-500/30 inline-block mt-0.5">
                                    Admin
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Telefone */}
                          <td className="px-4 py-3.5">
                            <span className="font-mono text-xs text-surface-300 bg-surface-900/60 px-2.5 py-1 rounded-lg border border-surface-800/80 inline-block">
                              {formatPhone(m.phone)}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="px-4 py-3.5">
                            {m.is_blacklisted
                              ? <span className="badge-red text-[10px] px-2 py-0.5">Bloqueado</span>
                              : <span className="badge-green text-[10px] px-2 py-0.5">Ativo</span>
                            }
                          </td>

                          {/* Data */}
                          <td className="px-4 py-3.5 text-xs text-surface-500 font-mono">
                            {m.added_at ? new Date(m.added_at).toLocaleDateString('pt-BR') : '–'}
                          </td>

                          {/* Ação */}
                          <td className="px-4 py-3.5 text-right">
                            <button
                              onClick={() => m.contact_id
                                ? openCampaignPicker([m.contact_id])
                                : toast.error('Contato sem cadastro vinculado')
                              }
                              title="Adicionar à campanha"
                              className={`p-1.5 rounded-lg transition-all border ${m.contact_id
                                ? 'text-primary-400 border-primary-500/20 bg-primary-900/10 hover:bg-primary-900/30'
                                : 'text-surface-700 border-surface-800 cursor-not-allowed'
                              }`}
                            >
                              <MdOutlineCampaign size={17} />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* ── Footer / Paginação ─────────────────────────────────────────── */}
            {totalPages > 1 && (
              <div className="px-6 py-3 border-t border-white/10 flex-shrink-0 flex items-center justify-between" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <span className="text-xs text-surface-500">
                  Mostrando {(modalPage - 1) * MODAL_PAGE_SIZE + 1}–{Math.min(modalPage * MODAL_PAGE_SIZE, modalTotal)} de {modalTotal}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handlePage(modalPage - 1)}
                    disabled={modalPage <= 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Anterior
                  </button>
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    const p = totalPages <= 7 ? i + 1 : modalPage <= 4 ? i + 1 : modalPage + i - 3
                    if (p < 1 || p > totalPages) return null
                    return (
                      <button
                        key={p}
                        onClick={() => handlePage(p)}
                        className="w-8 h-8 rounded-lg text-xs font-semibold transition-all"
                        style={p === modalPage
                          ? { background: 'rgba(157,78,221,0.3)', color: '#c084fc', border: '1px solid rgba(157,78,221,0.4)' }
                          : { color: '#64748b' }
                        }
                      >
                        {p}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => handlePage(modalPage + 1)}
                    disabled={modalPage >= totalPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-surface-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    Próximo →
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Campaign Picker overlay ──────────────────────────────────────── */}
          {campaignPicker && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', zIndex: 10 }}>
              <div
                className="rounded-2xl overflow-hidden shadow-2xl"
                style={{
                  width: 420,
                  background: 'linear-gradient(160deg,#1e1630 0%,#150f25 100%)',
                  border: '1px solid rgba(157,78,221,0.35)',
                  boxShadow: '0 0 60px rgba(157,78,221,0.15)',
                }}
              >
                <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between" style={{ background: 'rgba(157,78,221,0.08)' }}>
                  <div className="flex items-center gap-2">
                    <MdCampaign size={20} className="text-primary-400" />
                    <h3 className="text-sm font-bold text-white">Adicionar à campanha</h3>
                  </div>
                  <button onClick={() => setCampaignPicker(null)} className="w-7 h-7 rounded-full flex items-center justify-center text-surface-400 hover:text-white hover:bg-white/10 transition-colors">
                    <MdClose size={15} />
                  </button>
                </div>
                <div className="p-5">
                  <p className="text-xs text-surface-400 mb-4">
                    {campaignPicker.contactIds.length} contato(s) serão adicionados à campanha selecionada.
                  </p>
                  {campaigns.length === 0 ? (
                    <p className="text-sm text-surface-500 text-center py-4">Nenhuma campanha encontrada. Crie uma primeiro.</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                      {campaigns.map(c => (
                        <button
                          key={c.id}
                          onClick={() => addToCampaign(c.id)}
                          disabled={addingToCampaign}
                          className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-surface-700/50 bg-surface-900/40 hover:border-primary-500/40 hover:bg-primary-900/20 transition-all text-left disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-semibold text-surface-100">{c.name}</p>
                            <p className="text-[11px] text-surface-500 mt-0.5 capitalize">{c.status}</p>
                          </div>
                          {addingToCampaign
                            ? <div className="w-4 h-4 border-2 border-primary-500/30 border-t-primary-400 rounded-full animate-spin" />
                            : <span className="text-xs font-bold text-primary-400 border border-primary-500/30 px-2 py-1 rounded-lg hover:bg-primary-900/30">Selecionar</span>
                          }
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
