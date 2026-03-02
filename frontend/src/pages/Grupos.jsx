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
      .catch(() => {})
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
        <h1 className="text-xl font-bold text-white">Grupos do WhatsApp</h1>
        <p className="text-sm text-gray-500 mt-1">
          Selecione uma sessão, marque os grupos e extraia os membros. Admins, números fora do Brasil
          e números inválidos são ignorados automaticamente.
        </p>
      </div>

      {/* ── Seleção de sessão ─────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="label">Sessão WhatsApp</label>
            <select
              value={selectedSession || ''}
              onChange={e => setSelectedSession(e.target.value ? parseInt(e.target.value) : null)}
              className="input"
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
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <MdRefresh className={loadingWaha ? 'animate-spin' : ''} size={18} />
              Atualizar lista
            </button>
          )}
        </div>
      </div>

      {/* ── Resultado da última extração ─────────────────────────────────── */}
      {lastResult && (
        <div className="bg-green-900/20 border border-green-800/40 rounded-xl p-4">
          <p className="font-semibold text-green-400 mb-3">Extração concluída</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-black/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{lastResult.extracted_members}</div>
              <div className="text-gray-400 text-xs mt-1">Membros salvos</div>
            </div>
            <div className="bg-black/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-300">{lastResult.skipped_admin}</div>
              <div className="text-gray-400 text-xs mt-1">Admins ignorados</div>
            </div>
            <div className="bg-black/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-300">{lastResult.skipped_nonbr}</div>
              <div className="text-gray-400 text-xs mt-1">Não-BR ignorados</div>
            </div>
            <div className="bg-black/30 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-gray-300">{lastResult.skipped_invalid}</div>
              <div className="text-gray-400 text-xs mt-1">Inválidos ignorados</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lista de grupos do WAHA (para seleção) ───────────────────────── */}
      {selectedSession && (
        <div className="card overflow-hidden">
          {/* Header do card */}
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <MdGroup size={20} className="text-green-500" />
                Grupos disponíveis
                {wahaGroups.length > 0 && (
                  <span className="text-sm font-normal text-gray-500">
                    ({wahaGroups.length} grupos)
                  </span>
                )}
              </h2>
              {selectedIds.size > 0 && (
                <p className="text-xs text-green-400 mt-0.5">{selectedIds.size} selecionado(s)</p>
              )}
            </div>

            <div className="flex gap-2">
              {wahaGroups.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="btn-secondary flex items-center gap-1.5 text-sm py-1.5 px-3"
                >
                  {allChecked
                    ? <MdCheckBox size={16} className="text-green-400" />
                    : someChecked
                      ? <MdIndeterminateCheckBox size={16} className="text-green-400" />
                      : <MdCheckBoxOutlineBlank size={16} />
                  }
                  {allChecked ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              )}

              <button
                onClick={extractSelected}
                disabled={extracting || selectedIds.size === 0}
                className="btn-primary flex items-center gap-2 disabled:opacity-40"
              >
                {extracting ? (
                  <>
                    <div className="w-4 h-4 border-b-2 border-white rounded-full animate-spin" />
                    Extraindo...
                  </>
                ) : (
                  <>
                    <MdDownload size={18} />
                    Extrair selecionados ({selectedIds.size})
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Corpo */}
          {loadingWaha ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <div className="w-8 h-8 border-b-2 border-green-500 rounded-full animate-spin mb-3" />
              Carregando grupos...
            </div>
          ) : wahaGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <MdGroup size={48} className="mb-3 text-gray-700" />
              <p className="text-sm">Nenhum grupo encontrado.</p>
              <p className="text-xs text-gray-700 mt-1">Certifique-se de que a sessão está conectada no WhatsApp.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <button onClick={toggleAll} className="text-gray-400 hover:text-white">
                        {allChecked
                          ? <MdCheckBox size={18} className="text-green-400" />
                          : someChecked
                            ? <MdIndeterminateCheckBox size={18} className="text-green-400" />
                            : <MdCheckBoxOutlineBlank size={18} />
                        }
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Nome do Grupo
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Participantes
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {wahaGroups.map(grupo => (
                    <tr
                      key={grupo.id}
                      onClick={() => toggleGroup(grupo.id)}
                      className={`cursor-pointer transition-colors ${
                        selectedIds.has(grupo.id)
                          ? 'bg-green-900/10 hover:bg-green-900/20'
                          : 'hover:bg-gray-800/50'
                      }`}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleGroup(grupo.id)} className="text-gray-400 hover:text-white">
                          {selectedIds.has(grupo.id)
                            ? <MdCheckBox size={18} className="text-green-400" />
                            : <MdCheckBoxOutlineBlank size={18} />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-200">
                        {grupo.name}
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        <span className="flex items-center gap-1">
                          <MdPeople size={14} />
                          {grupo.size}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {grupo.already_extracted ? (
                          <span className="badge-green">Extraído</span>
                        ) : (
                          <span className="badge-gray">Não extraído</span>
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
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800">
            <h2 className="text-base font-semibold text-white">
              Grupos extraídos
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({dbTotal} total)
              </span>
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-800">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Membros</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Última extração</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {dbGroups.map(grupo => (
                  <tr key={grupo.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-200">{grupo.name}</td>
                    <td className="px-5 py-3">
                      <span className="badge-green">{grupo.member_count} membros</span>
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {grupo.last_extracted_at
                        ? new Date(grupo.last_extracted_at).toLocaleString('pt-BR')
                        : '–'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => loadMembers(grupo)}
                          className="text-xs text-green-400 hover:text-green-300 font-medium transition-colors"
                        >
                          Ver membros
                        </button>
                        <button
                          onClick={() => deleteGroup(grupo.id)}
                          className="p-1 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <MdDelete size={16} />
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
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <MdPeople size={18} className="text-green-500" />
              {memberGroup.name}
              <span className="text-sm font-normal text-gray-500">
                ({membersTotal} contatos)
              </span>
            </h2>
            <button
              onClick={() => { setMemberGroup(null); setMembers([]) }}
              className="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors"
            >
              <MdClose size={18} />
            </button>
          </div>

          {loadingMembers ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <div className="w-7 h-7 border-b-2 border-green-500 rounded-full animate-spin mb-3" />
              Carregando membros...
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-600">
              <MdPeople size={40} className="mb-2 text-gray-700" />
              <p className="text-sm">Nenhum membro encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                  <tr>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Telefone</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {members.map(m => (
                    <tr key={m.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-5 py-3 font-mono text-gray-200">{m.phone}</td>
                      <td className="px-5 py-3 text-gray-400">{m.name || '–'}</td>
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
        <div className="card flex flex-col items-center justify-center py-20 text-gray-600">
          <MdGroup size={56} className="mb-4 text-gray-700" />
          <p className="text-base font-medium text-gray-500">Selecione uma sessão para ver os grupos</p>
          <p className="text-sm text-gray-700 mt-1">Os grupos disponíveis no WhatsApp serão listados aqui</p>
        </div>
      )}
    </div>
  )
}
