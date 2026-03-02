import React, { useState, useEffect } from 'react'
import { api } from '../api'
import toast from 'react-hot-toast'
import { FiRefreshCw, FiTrash2, FiPlus } from 'react-icons/fi'

export default function Grupos() {
  const [grupos, setGrupos] = useState([])
  const [sessoes, setSessoes] = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  // Carregar sessões do usuário
  const loadSessoes = async () => {
    try {
      const response = await api.get('/api/sessoes')
      setSessoes(response.data)
    } catch (error) {
      console.error('Erro ao carregar sessões:', error)
    }
  }

  // Carregar grupos
  const loadGrupos = async () => {
    setLoading(true)
    try {
      const params = {
        page,
        page_size: 20,
      }
      if (selectedSession) {
        params.session_id = selectedSession
      }
      
      const response = await api.get('/api/grupos', { params })
      setGrupos(response.data.items)
      setTotal(response.data.total)
    } catch (error) {
      console.error('Erro ao carregar grupos:', error)
      toast.error('Erro ao carregar grupos')
    } finally {
      setLoading(false)
    }
  }

  // Carregar membros de um grupo
  const loadMembers = async (groupId) => {
    try {
      const response = await api.get(`/api/grupos/${groupId}/members`)
      setMembers(response.data.items)
      setSelectedGroup(groupId)
    } catch (error) {
      console.error('Erro ao carregar membros:', error)
      toast.error('Erro ao carregar membros')
    }
  }

  // Re-extrair grupos de uma sessão
  const reExtractGroups = async (sessionId) => {
    try {
      setLoading(true)
      await api.post(`/api/grupos/session/${sessionId}/extract-all`)
      toast.success('Extração de grupos iniciada em background')
      setTimeout(() => loadGrupos(), 2000)
    } catch (error) {
      console.error('Erro ao extrair grupos:', error)
      toast.error('Erro ao iniciar extração')
    } finally {
      setLoading(false)
    }
  }

  // Deletar grupo
  const deleteGroup = async (groupId) => {
    if (!confirm('Tem certeza que deseja deletar este grupo?')) return

    try {
      await api.delete(`/api/grupos/${groupId}`)
      toast.success('Grupo deletado com sucesso')
      loadGrupos()
    } catch (error) {
      console.error('Erro ao deletar grupo:', error)
      toast.error('Erro ao deletar grupo')
    }
  }

  // Efeitos
  useEffect(() => {
    loadSessoes()
  }, [])

  useEffect(() => {
    setPage(1)
    if (selectedSession) {
      loadGrupos()
    }
  }, [selectedSession])

  useEffect(() => {
    if (selectedSession) {
      loadGrupos()
    }
  }, [page])

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Grupos do WhatsApp</h2>
        <p className="text-gray-600 mb-4">
          Visualize e gerencie os grupos de WhatsApp que estão sendo monitorados. Quando uma sessão conecta, os grupos são extraídos automaticamente.
        </p>

        {/* Seleção de Sessão */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Selecione uma sessão para ver os grupos
          </label>
          <select
            value={selectedSession || ''}
            onChange={(e) => setSelectedSession(e.target.value ? parseInt(e.target.value) : null)}
            className="block w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">-- Selecione uma sessão --</option>
            {sessoes.map((sessao) => (
              <option key={sessao.id} value={sessao.id}>
                {sessao.name} ({sessao.status})
              </option>
            ))}
          </select>
        </div>

        {/* Botão para força extração */}
        {selectedSession && (
          <button
            onClick={() => reExtractGroups(selectedSession)}
            disabled={loading}
            className="mb-6 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 flex items-center gap-2"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} />
            {loading ? 'Extraindo...' : 'Forçar Extração de Grupos'}
          </button>
        )}
      </div>

      {/* Lista de Grupos */}
      {selectedSession && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold text-gray-900">
              Grupos ({total} encontrados)
            </h3>
          </div>

          {grupos.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <p>Nenhum grupo encontrado. A extração pode levar alguns segundos.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                      Nome
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                      Membros
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                      Última Extração
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {grupos.map((grupo) => (
                    <tr key={grupo.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{grupo.name}</div>
                        {grupo.subject && (
                          <div className="text-sm text-gray-500">{grupo.subject}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                          {grupo.member_count}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {grupo.last_extracted_at
                          ? new Date(grupo.last_extracted_at).toLocaleString('pt-BR')
                          : 'Nunca'}
                      </td>
                      <td className="px-6 py-4 text-sm space-x-2">
                        <button
                          onClick={() => loadMembers(grupo.id)}
                          className="text-blue-500 hover:text-blue-700 font-medium"
                        >
                          Ver Membros
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
          )}

          {/* Paginação */}
          {Math.ceil(total / 20) > 1 && (
            <div className="p-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="py-1">
                Página {page} de {Math.ceil(total / 20)}
              </span>
              <button
                onClick={() => setPage(Math.min(Math.ceil(total / 20), page + 1))}
                disabled={page >= Math.ceil(total / 20)}
                className="px-3 py-1 border border-gray-300 rounded disabled:opacity-50"
              >
                Próxima
              </button>
            </div>
          )}
        </div>
      )}

      {/* Detalhes dos Membros */}
      {selectedGroup && members.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Membros do Grupo
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Telefone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Nome
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                    Admin
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {members.map((member) => (
                  <tr key={member.id}>
                    <td className="px-6 py-4 font-mono text-sm">{member.phone}</td>
                    <td className="px-6 py-4">{member.name || '-'}</td>
                    <td className="px-6 py-4">
                      {member.is_admin ? (
                        <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                          Sim
                        </span>
                      ) : (
                        <span className="text-gray-500">Não</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
