import React, { useState, useEffect } from 'react'
import api from '../api'
import toast from 'react-hot-toast'
import { FiRefreshCw, FiTrash2, FiUsers, FiCheckSquare, FiSquare } from 'react-icons/fi'

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
      // Pré-selecionar os que ainda não foram extraídos
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
      // Recarrega lista do WAHA (atualiza badge "já extraído") e do banco
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

      {/* ── Cabeçalho + seleção de sessão ────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-1">Grupos do WhatsApp</h2>
        <p className="text-gray-500 text-sm mb-6">
          Selecione uma sessão, marque os grupos desejados e clique em Extrair Selecionados.
          Admins, números fora do Brasil e números fora de 12–13 dígitos são ignorados automaticamente.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sessão
            </label>
            <select
              value={selectedSession || ''}
              onChange={e => setSelectedSession(e.target.value ? parseInt(e.target.value) : null)}
              className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
            >
              <FiRefreshCw className={loadingWaha ? 'animate-spin' : ''} />
              Atualizar lista
            </button>
          )}
        </div>
      </div>

      {/* ── Resultado da última extração ─────────────────────────────────── */}
      {lastResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="font-semibold text-green-800 mb-1">Extração concluída</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div className="bg-white rounded p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-green-600">{lastResult.extracted_members}</div>
              <div className="text-gray-500">Membros salvos</div>
            </div>
            <div className="bg-white rounded p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-gray-700">{lastResult.skipped_admin}</div>
              <div className="text-gray-500">Admins ignorados</div>
            </div>
            <div className="bg-white rounded p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-gray-700">{lastResult.skipped_nonbr}</div>
              <div className="text-gray-500">Não-BR ignorados</div>
            </div>
            <div className="bg-white rounded p-3 text-center shadow-sm">
              <div className="text-2xl font-bold text-gray-700">{lastResult.skipped_invalid}</div>
              <div className="text-gray-500">Inválidos ignorados</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Lista de grupos do WAHA (para seleção) ───────────────────────── */}
      {selectedSession && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Grupos disponíveis no WhatsApp
                {wahaGroups.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({wahaGroups.length} grupos)
                  </span>
                )}
              </h3>
              {selectedIds.size > 0 && (
                <p className="text-sm text-blue-600">{selectedIds.size} selecionados</p>
              )}
            </div>
            <div className="flex gap-2">
              {wahaGroups.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center gap-1"
                >
                  {allChecked ? <FiCheckSquare className="text-blue-500" /> : <FiSquare />}
                  {allChecked ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              )}
              <button
                onClick={extractSelected}
                disabled={extracting || selectedIds.size === 0}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-2"
              >
                {extracting
                  ? <><FiRefreshCw className="animate-spin" /> Extraindo...</>
                  : <><FiUsers /> Extrair Selecionados ({selectedIds.size})</>
                }
              </button>
            </div>
          </div>

          {loadingWaha ? (
            <div className="p-8 text-center text-gray-400">
              <FiRefreshCw className="animate-spin mx-auto mb-2 text-2xl" />
              Carregando grupos...
            </div>
          ) : wahaGroups.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {selectedSession
                ? 'Nenhum grupo encontrado. Certifique-se de que a sessão está conectada.'
                : 'Selecione uma sessão para ver os grupos.'}
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked }}
                        onChange={toggleAll}
                        className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 uppercase text-xs">
                      Nome do Grupo
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 uppercase text-xs">
                      Participantes
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600 uppercase text-xs">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {wahaGroups.map(grupo => (
                    <tr
                      key={grupo.id}
                      onClick={() => toggleGroup(grupo.id)}
                      className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                        selectedIds.has(grupo.id) ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(grupo.id)}
                          onChange={() => toggleGroup(grupo.id)}
                          className="w-4 h-4 rounded text-blue-600 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {grupo.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {grupo.size}
                      </td>
                      <td className="px-4 py-3">
                        {grupo.already_extracted ? (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">
                            Extraído
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                            Não extraído
                          </span>
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
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Grupos extraídos
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({dbTotal} total)
              </span>
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Nome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Membros salvos</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Última extração</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dbGroups.map(grupo => (
                  <tr key={grupo.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{grupo.name}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 font-medium">
                        {grupo.member_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {grupo.last_extracted_at
                        ? new Date(grupo.last_extracted_at).toLocaleString('pt-BR')
                        : '–'}
                    </td>
                    <td className="px-4 py-3 flex items-center gap-3">
                      <button
                        onClick={() => loadMembers(grupo)}
                        className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                      >
                        Ver membros
                      </button>
                      <button
                        onClick={() => deleteGroup(grupo.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <FiTrash2 />
                      </button>
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
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Membros: {memberGroup.name}
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({membersTotal} contatos)
              </span>
            </h3>
            <button
              onClick={() => { setMemberGroup(null); setMembers([]) }}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              Fechar
            </button>
          </div>

          {loadingMembers ? (
            <div className="text-center text-gray-400 py-4">
              <FiRefreshCw className="animate-spin mx-auto mb-1" />
              Carregando...
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Telefone</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 uppercase">Nome</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map(m => (
                    <tr key={m.id}>
                      <td className="px-4 py-2 font-mono text-gray-800">{m.phone}</td>
                      <td className="px-4 py-2 text-gray-600">{m.name || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
