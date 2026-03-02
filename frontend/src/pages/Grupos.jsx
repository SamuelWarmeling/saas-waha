import React, { useState, useEffect } from 'react'
import api from '../api'
import toast from 'react-hot-toast'
import {
  MdGroup,
  MdRefresh,
  MdDelete,
  MdPeople,
  MdCheckBox,
  MdCheckBoxOutlineBlank,
  MdIndeterminateCheckBox,
  MdClose,
  MdDownload,
} from 'react-icons/md'

export default function Grupos() {
  const [sessoes, setSessoes] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)

  // Grupos do WAHA (para seleção — não estão no banco ainda)
  const [wahaGroups, setWahaGroups] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [loadingWaha, setLoadingWaha] = useState(false)

  // Resultado da última extração
  const [lastResult, setLastResult] = useState(null)
  const [extracting, setExtracting] = useState(false)

  // Grupos já extraídos (do banco)
  const [dbGroups, setDbGroups] = useState([])
  const [dbTotal, setDbTotal] = useState(0)

  // Membros de um grupo específico
  const [memberGroup, setMemberGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [membersTotal, setMembersTotal] = useState(0)
  const [loadingMembers, setLoadingMembers] = useState(false)

  // ── Sessões ──────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/sessoes')
      .then(r => setSessoes(r.data))
      .catch(() => { })
  }, [])

  // ── Ao trocar sessão: carregar lista do WAHA + grupos do banco ────────────
  useEffect(() => {
    if (!selectedSession) {
      setWahaGroups([])
      setSelectedIds(new Set())
      setDbGroups([])
      setLastResult(null)
      setMemberGroup(null)
      setMembers([])
      return
    }
    loadWahaGroups()
    loadDbGroups()
  }, [selectedSession])

  // ── Carrega grupos direto do WAHA (para seleção) ──────────────────────────
  const loadWahaGroups = async () => {
    setLoadingWaha(true)
    setLastResult(null)
    try {
      const { data } = await api.get(`/grupos/session/${selectedSession}/waha-list`)
      setWahaGroups(data.groups || [])
      const novos = new Set(
        (data.groups || [])
          .filter(g => !g.already_extracted)
          .map(g => g.id)
      )
      setSelectedIds(novos)
    } catch (err) {
      const msg = err.response?.data?.detail || 'Erro ao carregar grupos'
      toast.error(msg)
      setWahaGroups([])
    } finally {
      setLoadingWaha(false)
    }
  }

  // ── Carrega grupos já extraídos (do banco) ────────────────────────────────
  const loadDbGroups = async () => {
    try {
      const { data } = await api.get('/grupos', {
        params: { session_id: selectedSession, page_size: 50 },
      })
      setDbGroups(data.items || [])
      setDbTotal(data.total || 0)
    } catch {
      setDbGroups([])
    }
  }

  // ── Toggle de checkbox individual ────────────────────────────────────────
  const toggleGroup = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Selecionar / desmarcar todos ──────────────────────────────────────────
  const toggleAll = () => {
    if (selectedIds.size === wahaGroups.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(wahaGroups.map(g => g.id)))
    }
  }

  // ── Extrair grupos selecionados ───────────────────────────────────────────
  const extractSelected = async () => {
    if (selectedIds.size === 0) {
      toast.error('Selecione ao menos um grupo')
      return
    }
    setExtracting(true)
    setLastResult(null)
    try {
      const { data } = await api.post(
        `/grupos/session/${selectedSession}/extract-selected`,
        { group_ids: Array.from(selectedIds) }
      )
      setLastResult(data)
      toast.success(data.message)
      await Promise.all([loadWahaGroups(), loadDbGroups()])
    } catch (err) {
      const msg = err.response?.data?.detail || 'Erro na extração'
      toast.error(msg)
    } finally {
      setExtracting(false)
    }
  }

  // ── Ver membros de um grupo extraído ─────────────────────────────────────
  const loadMembers = async (group) => {
    setMemberGroup(group)
    setLoadingMembers(true)
    try {
      const { data } = await api.get(`/grupos/${group.id}/members`, {
        params: { page_size: 200 },
      })
      setMembers(data.items || [])
      setMembersTotal(data.total || 0)
    } catch {
      toast.error('Erro ao carregar membros')
    } finally {
      setLoadingMembers(false)
    }
  }

  // ── Deletar grupo do banco ────────────────────────────────────────────────
  const deleteGroup = async (groupId) => {
    if (!confirm('Deletar este grupo e seus membros?')) return
    try {
      await api.delete(`/grupos/${groupId}`)
      toast.success('Grupo deletado')
      loadDbGroups()
      if (memberGroup?.id === groupId) {
        setMemberGroup(null)
        setMembers([])
      }
    } catch {
      toast.error('Erro ao deletar grupo')
    }
  }

  const allChecked = wahaGroups.length > 0 && selectedIds.size === wahaGroups.length
  const someChecked = selectedIds.size > 0 && selectedIds.size < wahaGroups.length

  return (
    <div className="space-y-6">

      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Grupos do WhatsApp</h1>
        <p className="text-sm text-surface-400 mt-1">
          Selecione uma sessão, marque os grupos e extraia os membros. Admins, números fora do Brasil
          e números inválidos são ignorados automaticamente.
        </p>
      </div>

      {/* ── Seleção de sessão ─────────────────────────────────────────────── */}
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
              {sessoes.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
          </div>

          {selectedSession && (
            <button
              onClick={loadWahaGroups}
              disabled={loadingWaha}
              className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50 py-2.5 h-[42px]"
            >
              <MdRefresh className={loadingWaha ? 'animate-spin' : ''} size={18} />
              Atualizar lista
            </button>
          )}
        </div>
      </div>

      {/* ── Resultado da última extração ─────────────────────────────────── */}
      {lastResult && (
        <div className="bg-primary-900/20 border border-primary-500/30 backdrop-blur-md shadow-lg shadow-primary-900/20 rounded-2xl p-5 relative overflow-hidden">
          <div className="absolute top-[-50%] right-[-10%] w-[40%] h-[200%] bg-primary-500/10 blur-[50px] pointer-events-none rounded-full" />
          <p className="font-semibold text-primary-400 mb-4 flex items-center gap-2 relative z-10">
            <MdCheckBox size={20} />
            Extração concluída com sucesso
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm relative z-10">
            <div className="bg-surface-950/50 border border-surface-700/50 rounded-xl p-4 text-center shadow-inner">
              <div className="text-3xl font-bold text-primary-400">{lastResult.extracted_members}</div>
              <div className="text-surface-400 text-xs mt-1.5 font-medium">Membros salvos</div>
            </div>
            <div className="bg-surface-950/50 border border-surface-700/50 rounded-xl p-4 text-center shadow-inner">
              <div className="text-3xl font-bold text-surface-200">{lastResult.skipped_admin}</div>
              <div className="text-surface-400 text-xs mt-1.5 font-medium">Admins ignorados</div>
            </div>
            <div className="bg-surface-950/50 border border-surface-700/50 rounded-xl p-4 text-center shadow-inner">
              <div className="text-3xl font-bold text-surface-200">{lastResult.skipped_nonbr}</div>
              <div className="text-surface-400 text-xs mt-1.5 font-medium">Não-BR ignorados</div>
            </div>
            <div className="bg-surface-950/50 border border-surface-700/50 rounded-xl p-4 text-center shadow-inner">
              <div className="text-3xl font-bold text-surface-200">{lastResult.skipped_invalid}</div>
              <div className="text-surface-400 text-xs mt-1.5 font-medium">Inválidos ignorados</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lista de grupos do WAHA (para seleção) ───────────────────────── */}
      {selectedSession && (
        <div className="glass-card overflow-hidden p-0">
          {/* Header do card */}
          <div className="px-6 py-4 border-b border-surface-700/50 flex items-center justify-between flex-wrap gap-4 bg-surface-900/30">
            <div>
              <h2 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                  <MdGroup size={18} />
                </div>
                Grupos disponíveis
                {wahaGroups.length > 0 && (
                  <span className="text-xs font-medium text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">
                    {wahaGroups.length}
                  </span>
                )}
              </h2>
              {selectedIds.size > 0 && (
                <p className="text-xs text-primary-400 font-medium mt-1 ml-10 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 shadow-[0_0_8px_theme(colors.primary.500)] animate-pulse"></span>
                  {selectedIds.size} selecionado(s)
                </p>
              )}
            </div>

            <div className="flex gap-3">
              {wahaGroups.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="btn-secondary flex items-center gap-2 text-sm py-2 px-4 shadow-sm"
                >
                  {allChecked
                    ? <MdCheckBox size={20} className="text-primary-400" />
                    : someChecked
                      ? <MdIndeterminateCheckBox size={20} className="text-primary-400" />
                      : <MdCheckBoxOutlineBlank size={20} className="text-surface-400" />
                  }
                  {allChecked ? 'Desmarcar todos' : 'Selecionar'}
                </button>
              )}

              <button
                onClick={extractSelected}
                disabled={extracting || selectedIds.size === 0}
                className="btn-primary flex items-center gap-2 disabled:opacity-40 py-2 px-5"
              >
                {extracting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  <>
                    <MdDownload size={20} />
                    Extrair ({selectedIds.size})
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Corpo */}
          {loadingWaha ? (
            <div className="flex flex-col items-center justify-center py-20 text-surface-400">
              <div className="w-10 h-10 border-2 border-surface-700 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="font-medium text-sm">Carregando grupos do WhatsApp...</p>
            </div>
          ) : wahaGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-surface-500">
              <div className="w-16 h-16 rounded-full bg-surface-800/50 flex items-center justify-center mb-4 border border-surface-700/50">
                <MdGroup size={32} className="text-surface-600" />
              </div>
              <p className="text-sm font-medium text-surface-300">Nenhum grupo encontrado.</p>
              <p className="text-xs text-surface-500 mt-2 max-w-xs text-center">Certifique-se de que a sessão está conectada corretamente no dispositivo.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-900/90 backdrop-blur-md border-b border-surface-700/50 z-10 shadow-sm">
                  <tr>
                    <th className="w-12 px-5 py-3.5">
                      <button onClick={toggleAll} className="text-surface-500 hover:text-surface-200 transition-colors">
                        {allChecked
                          ? <MdCheckBox size={20} className="text-primary-500" />
                          : someChecked
                            ? <MdIndeterminateCheckBox size={20} className="text-primary-500" />
                            : <MdCheckBoxOutlineBlank size={20} />
                        }
                      </button>
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                      Nome do Grupo
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                      Participantes
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800/50">
                  {wahaGroups.map(grupo => (
                    <tr
                      key={grupo.id}
                      onClick={() => toggleGroup(grupo.id)}
                      className={`cursor-pointer transition-all duration-200 ${selectedIds.has(grupo.id)
                          ? 'bg-primary-900/10 hover:bg-primary-900/20'
                          : 'hover:bg-surface-800/40'
                        }`}
                    >
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleGroup(grupo.id)} className="text-surface-500 hover:text-surface-300 transition-colors">
                          {selectedIds.has(grupo.id)
                            ? <MdCheckBox size={20} className="text-primary-500 drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
                            : <MdCheckBoxOutlineBlank size={20} />
                          }
                        </button>
                      </td>
                      <td className="px-5 py-4 font-medium text-surface-100 flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${selectedIds.has(grupo.id) ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-400'}`}>
                          {grupo.name.substring(0, 2).toUpperCase()}
                        </div>
                        {grupo.name}
                      </td>
                      <td className="px-5 py-4 text-surface-400 font-medium">
                        <span className="flex items-center gap-1.5 bg-surface-800/50 px-2.5 py-1 rounded-lg w-max border border-surface-700/50">
                          <MdPeople size={16} className="text-surface-500" />
                          {grupo.size}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {grupo.already_extracted ? (
                          <span className="badge-primary">Já extraído</span>
                        ) : (
                          <span className="badge-gray">Novo grupo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Grupos já extraídos (banco) ───────────────────────────────────── */}
      {selectedSession && dbGroups.length > 0 && (
        <div className="glass-card overflow-hidden p-0 mt-8">
          <div className="px-6 py-5 border-b border-surface-700/50 bg-surface-900/30">
            <h2 className="text-sm font-semibold text-surface-100 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-500/20 text-primary-400 flex items-center justify-center">
                <MdCheckBox size={18} />
              </div>
              Grupos processados
              <span className="ml-2 text-xs font-medium text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full">
                {dbTotal} salvos
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-900/50 border-b border-surface-700/50">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Nome</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Membros Salvos</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Última extração</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-surface-400 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/50">
                {dbGroups.map(grupo => (
                  <tr key={grupo.id} className="hover:bg-surface-800/30 transition-colors">
                    <td className="px-6 py-4 font-medium text-surface-100">{grupo.name}</td>
                    <td className="px-6 py-4">
                      <span className="badge-green px-2.5 py-1">{grupo.member_count} membros</span>
                    </td>
                    <td className="px-6 py-4 text-surface-500 text-xs font-mono">
                      {grupo.last_extracted_at
                        ? new Date(grupo.last_extracted_at).toLocaleString('pt-BR')
                        : '–'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => loadMembers(grupo)}
                          className="text-xs text-primary-400 border border-primary-500/30 hover:bg-primary-500/20 bg-primary-900/10 px-3 py-1.5 rounded-lg font-medium transition-colors"
                        >
                          Ver contatos
                        </button>
                        <button
                          onClick={() => deleteGroup(grupo.id)}
                          className="p-1.5 rounded-lg hover:bg-red-900/30 text-surface-500 hover:text-red-400 transition-colors border border-transparent hover:border-red-500/20"
                          title="Excluir grupo"
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
        </div>
      )}

      {/* ── Membros do grupo selecionado ──────────────────────────────────── */}
      {memberGroup && (
        <div className="glass-card overflow-hidden p-0 border-primary-500/30 shadow-[0_0_30px_rgba(0,0,0,0.4)] mt-8 animate-[slideIn_0.3s_ease-out]">
          <div className="px-6 py-5 border-b border-surface-700/50 flex items-center justify-between bg-surface-900/50">
            <h2 className="text-base font-semibold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary-900/50 border border-primary-400/30">
                <MdPeople size={22} />
              </div>
              <div>
                <span className="block">{memberGroup.name}</span>
                <span className="text-xs font-medium text-primary-400 mt-0.5 block">
                  {membersTotal} contatos extraídos
                </span>
              </div>
            </h2>
            <button
              onClick={() => { setMemberGroup(null); setMembers([]) }}
              className="p-2 rounded-xl bg-surface-800/80 hover:bg-surface-700 text-surface-400 hover:text-white transition-all border border-surface-600/50"
            >
              <MdClose size={20} />
            </button>
          </div>

          {loadingMembers ? (
            <div className="flex flex-col items-center justify-center py-16 text-surface-400">
              <div className="w-10 h-10 border-2 border-surface-700 border-t-primary-500 rounded-full animate-spin mb-4" />
              <p className="font-medium text-sm">Carregando contatos...</p>
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-surface-500">
              <MdPeople size={48} className="mb-4 text-surface-600 opacity-50" />
              <p className="text-sm font-medium text-surface-300">Nenhum membro listado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-900/90 backdrop-blur-md border-b border-surface-700/50 z-10 shadow-sm">
                  <tr>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider w-1/3">Telefone</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">Nome do Contato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800/50">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-surface-800/30 transition-colors">
                      <td className="px-6 py-4 font-mono text-surface-300 text-sm">
                        <span className="bg-surface-950 px-3 py-1.5 rounded-lg border border-surface-800 inline-block shadow-inner">
                          {m.phone}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-surface-100 font-medium">
                        {m.name || <span className="text-surface-600 italic font-normal">Sem nome</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Estado vazio: nenhuma sessão selecionada ─────────────────────── */}
      {!selectedSession && (
        <div className="glass-card flex flex-col items-center justify-center py-24 text-surface-500 mt-4 border-dashed border-2 border-surface-700 bg-surface-900/20">
          <div className="w-20 h-20 rounded-full bg-surface-800 flex items-center justify-center mb-6 shadow-inner">
            <MdGroup size={40} className="text-surface-600" />
          </div>
          <p className="text-lg font-semibold text-surface-300">Selecione uma sessão do WhatsApp</p>
          <p className="text-sm text-surface-500 mt-2 max-w-sm text-center">Para visualizar e extrair grupos, você precisa selecionar uma sessão conectada ativa acima.</p>
        </div>
      )}
    </div>
  )
}
