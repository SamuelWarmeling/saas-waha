import { useState, useEffect, useCallback } from 'react'
import {
  MdAdd, MdClose, MdPause, MdPlayArrow, MdDelete, MdHistory,
  MdFireplace, MdCheckCircle, MdWarning, MdInfo, MdPhoneAndroid,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import api from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatProximoEnvio(iso) {
  if (!iso) return 'Em breve'
  const diff = Math.ceil((new Date(iso) - Date.now()) / 60000)
  if (diff <= 0) return 'Em breve'
  if (diff < 60) return `em ~${diff} min`
  return `em ~${Math.floor(diff / 60)}h${diff % 60 > 0 ? ` ${diff % 60}min` : ''}`
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function getSaude(aq) {
  if (aq.status === 'cancelado') return { label: 'Cancelado', color: '#ef4444', emoji: '🔴' }
  if (aq.status === 'concluido') return { label: 'Concluído', color: '#22c55e', emoji: '✅' }
  if (aq.status === 'manutencao') return { label: 'Manutenção', color: '#f59e0b', emoji: '🔧' }
  if (aq.session_status !== 'connected') return { label: 'Chip offline', color: '#ef4444', emoji: '🔴' }
  if (aq.status === 'pausado') return { label: 'Pausado', color: '#f59e0b', emoji: '🟡' }
  return { label: 'Ótima', color: '#22c55e', emoji: '🟢' }
}

const PLANOS = [
  {
    dias: 7,
    titulo: '7 dias',
    nivel: '🥉 Básico',
    desc: 'Até 8 msgs/dia no pico',
    risco: 'Médio',
    riscoCor: '#f59e0b',
    detalhes: 'Dias 1-3: 3/dia • Dias 4-7: 8/dia',
  },
  {
    dias: 14,
    titulo: '14 dias',
    nivel: '🥈 Recomendado',
    desc: 'Até 20 msgs/dia no pico',
    risco: 'Baixo',
    riscoCor: '#22c55e',
    detalhes: 'Dias 1-3: 3 • Dias 4-7: 8 • Dias 8-14: 20/dia',
    destacado: true,
  },
  {
    dias: 21,
    titulo: '21 dias',
    nivel: '🥇 Premium',
    desc: 'Até 40 msgs/dia no pico',
    risco: 'Mínimo',
    riscoCor: '#9D4EDD',
    detalhes: 'Dias 1-14: progressivo • Dias 15-21: 40/dia',
  },
]

// ── Modal Iniciar Aquecimento ─────────────────────────────────────────────────

function ModalIniciar({ sessoes, aquecimentos, poolStatus, onSave, onClose }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [diasTotal, setDiasTotal] = useState(14)
  const [usarIa, setUsarIa] = useState(true)
  const [manutencaoAtiva, setManutencaoAtiva] = useState(true)
  const [origemChip, setOrigemChip] = useState('novo')
  const [saving, setSaving] = useState(false)

  // IDs que já têm aquecimento ativo/pausado/manutenção
  const idsComAquecimento = new Set(
    (aquecimentos || [])
      .filter(a => ['ativo', 'pausado', 'manutencao'].includes(a.status))
      .map(a => a.session_id)
  )

  const isVeterano = origemChip === 'pessoal_antigo'
  const isPreAquecido = origemChip === 'pre_aquecido'

  const selectedList = sessoes.filter(s => selectedIds.has(s.id))
  const nFisicos = selectedList.filter(s => s.tipo_chip === 'fisico').length
  const nVirtuais = selectedList.filter(s => s.tipo_chip === 'virtual').length

  function toggleSessao(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function confirmar() {
    if (selectedIds.size === 0) { toast.error('Selecione pelo menos um chip'); return }
    setSaving(true)
    let ok = 0, erros = 0
    for (const id of selectedIds) {
      try {
        await api.post('/aquecimento', {
          session_id: id,
          dias_total: isPreAquecido ? 7 : diasTotal,
          usar_ia: usarIa,
          manutencao_ativa: manutencaoAtiva,
          origem_chip: origemChip,
        })
        ok++
      } catch (e) {
        erros++
        const detail = e.response?.data?.detail || 'Erro'
        const nome = sessoes.find(s => s.id === id)?.name ?? id
        toast.error(`${nome}: ${detail}`)
      }
    }
    setSaving(false)
    if (ok > 0) {
      if (isVeterano) toast.success(`⭐ ${ok} chip(s) marcado(s) como Veterano!`)
      else if (isPreAquecido) toast.success(`🛍️ Adaptação iniciada para ${ok} chip(s)!`)
      else toast.success(`🔥 Aquecimento iniciado para ${ok} chip(s)!`)
      onSave()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg rounded-2xl border border-surface-700/50 shadow-2xl overflow-y-auto" style={{ background: '#120e1e', maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/40">
          <div>
            <h2 className="text-lg font-bold text-surface-50">Iniciar Aquecimento 🔥</h2>
            <p className="text-xs text-surface-500 mt-0.5">Configure o processo anti-ban para seu chip</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 transition-colors">
            <MdClose size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Seleção de chips — checkboxes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider">
                Selecione quais chips vão aquecer
              </label>
              {selectedIds.size > 0 && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(157,78,221,0.2)', color: '#b07de6' }}>
                  {selectedIds.size} selecionado{selectedIds.size > 1 ? 's' : ''}
                  {nFisicos > 0 && ` · ${nFisicos} físico${nFisicos > 1 ? 's' : ''}`}
                  {nVirtuais > 0 && ` · ${nVirtuais} virtual${nVirtuais > 1 ? 'is' : ''}`}
                </span>
              )}
            </div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {sessoes.length === 0 && (
                <p className="text-xs text-surface-500 text-center py-4">Nenhuma sessão cadastrada</p>
              )}
              {sessoes.map(s => {
                const jaAtivo = idsComAquecimento.has(s.id)
                const offline = s.status !== 'connected' && s.status !== 'CONNECTED'
                const disabled = jaAtivo
                const checked = selectedIds.has(s.id)
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-all select-none"
                    style={{
                      borderColor: checked ? '#9D4EDD' : 'rgba(255,255,255,0.07)',
                      background: checked ? 'rgba(157,78,221,0.08)' : disabled ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.02)',
                      opacity: disabled ? 0.5 : 1,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                    onClick={e => { if (!disabled) { e.preventDefault(); toggleSessao(s.id) } }}
                  >
                    <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors"
                      style={{ borderColor: checked ? '#9D4EDD' : 'rgba(255,255,255,0.2)', background: checked ? '#9D4EDD' : 'transparent' }}>
                      {checked && <svg width="12" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </div>
                    <span className="text-lg flex-shrink-0">{s.tipo_chip === 'virtual' ? '💻' : '📱'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-surface-100 truncate">{s.name}</p>
                      <p className="text-xs text-surface-500">
                        {s.phone_number || 'sem phone'} · {s.tipo_chip === 'virtual' ? 'virtual' : 'físico'}
                        {offline && <span className="text-orange-400"> · offline</span>}
                        {jaAtivo && <span className="text-purple-400"> · aquecimento ativo</span>}
                      </p>
                    </div>
                    {!offline && !jaAtivo && <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />}
                    {offline && <div className="w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />}
                  </label>
                )
              })}
            </div>
          </div>

          {/* Origem do chip */}
          <div>
            <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider block mb-3">
              Como este chip chegou até você?
            </label>
            <div className="space-y-2">
              {[
                { value: 'novo', emoji: '🆕', title: 'Chip novo', desc: 'Número novo, nunca usado. Aquecimento completo necessário.' },
                { value: 'pre_aquecido', emoji: '🛍️', title: 'Comprei pré-aquecido', desc: '7 dias de adaptação gradual: dias 1-2 passivos, liberação progressiva.' },
                { value: 'pessoal_antigo', emoji: '📱', title: 'Chip pessoal antigo', desc: 'Chip com histórico pessoal. Vira veterano direto com 150 msgs/dia.' },
              ].map(opt => (
                <label key={opt.value}
                  className="flex items-start gap-3 p-3.5 rounded-xl cursor-pointer border-2 transition-all"
                  style={{
                    borderColor: origemChip === opt.value ? '#9D4EDD' : 'rgba(255,255,255,0.07)',
                    background: origemChip === opt.value ? 'rgba(157,78,221,0.08)' : 'rgba(255,255,255,0.02)',
                  }}>
                  <input type="radio" name="origem" value={opt.value}
                    checked={origemChip === opt.value}
                    onChange={() => setOrigemChip(opt.value)}
                    className="mt-0.5 accent-purple-500" />
                  <div>
                    <p className="text-sm font-bold text-surface-100">{opt.emoji} {opt.title}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Status do pool global */}
          <div className="rounded-xl border border-surface-700/40 p-3 flex items-center gap-6" style={{ background: '#1a1425' }}>
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Pool global</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: (poolStatus?.fisicos ?? 0) > 0 ? '#4ade80' : '#6b7280' }} />
              <span className="text-xs text-surface-300">📱 {poolStatus?.fisicos ?? 0} físico{poolStatus?.fisicos !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: (poolStatus?.virtuais ?? 0) > 0 ? '#60a5fa' : '#6b7280' }} />
              <span className="text-xs text-surface-300">💻 {poolStatus?.virtuais ?? 0} virtual{poolStatus?.virtuais !== 1 ? 'is' : ''}</span>
            </div>
            <span className="text-xs text-surface-500 ml-auto">chips com aquecimento ativo</span>
          </div>

          {/* Info especial para chip veterano */}
          {isVeterano && (
            <div className="rounded-xl border border-yellow-500/30 p-4 flex gap-3" style={{ background: 'rgba(234,179,8,0.07)' }}>
              <span className="text-xl">⭐</span>
              <div>
                <p className="text-sm font-bold text-yellow-300">Chip Veterano — liberação imediata!</p>
                <p className="text-xs text-yellow-400/70 mt-1 leading-relaxed">
                  Sem período de aquecimento. O chip será marcado como veterano com <strong>150 msgs/dia</strong> liberados diretamente.
                  O histórico de uso pessoal já garante boa reputação no WhatsApp.
                </p>
              </div>
            </div>
          )}

          {/* Info especial para chip pré-aquecido */}
          {isPreAquecido && (
            <div className="rounded-xl border border-purple-500/30 p-4 flex gap-3" style={{ background: 'rgba(157,78,221,0.07)' }}>
              <span className="text-xl">🛍️</span>
              <div>
                <p className="text-sm font-bold text-purple-300">Modo Adaptação — 7 dias obrigatórios</p>
                <p className="text-xs text-purple-400/70 mt-1 leading-relaxed">
                  <strong>Dias 1-2:</strong> Apenas recebe mensagens do pool (fase passiva) •{' '}
                  <strong>Dias 3-4:</strong> 5 msgs/dia •{' '}
                  <strong>Dias 5-6:</strong> 15 msgs/dia •{' '}
                  <strong>Dia 7:</strong> 30 msgs/dia. Disparos bloqueados durante adaptação.
                </p>
              </div>
            </div>
          )}

          {/* Seleção de plano (apenas para chips novos) */}
          {!isVeterano && !isPreAquecido && (
          <div>
            <label className="text-xs font-semibold text-surface-400 uppercase tracking-wider block mb-3">
              Plano de aquecimento
            </label>
            <div className="space-y-2.5">
              {PLANOS.map(p => (
                <label
                  key={p.dias}
                  className="flex items-start gap-3 p-4 rounded-xl cursor-pointer border-2 transition-all"
                  style={{
                    borderColor: diasTotal === p.dias ? '#9D4EDD' : 'rgba(255,255,255,0.07)',
                    background: diasTotal === p.dias ? 'rgba(157,78,221,0.08)' : 'rgba(255,255,255,0.02)',
                  }}
                >
                  <input
                    type="radio"
                    name="plano"
                    value={p.dias}
                    checked={diasTotal === p.dias}
                    onChange={() => setDiasTotal(p.dias)}
                    className="mt-0.5 accent-purple-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-surface-100 text-sm">{p.nivel}</span>
                        <span className="text-surface-500 text-xs ml-2">— {p.titulo}</span>
                      </div>
                      {p.destacado && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(157,78,221,0.2)', color: '#b07de6' }}>
                          Mais popular
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-surface-400 mt-0.5">{p.desc}</p>
                    <p className="text-[11px] text-surface-600 mt-0.5">{p.detalhes}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[10px] text-surface-500">Risco de ban:</span>
                      <span className="text-[10px] font-bold" style={{ color: p.riscoCor }}>{p.risco}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          )}

          {/* Checklist informativo */}
          <div className="rounded-xl border border-surface-700/40 p-4" style={{ background: '#1a1425' }}>
            <p className="text-xs font-semibold text-surface-300 mb-3 flex items-center gap-2">
              <MdInfo size={14} className="text-blue-400" /> Checklist antes de aquecer
            </p>
            {[
              'O chip tem foto de perfil configurada?',
              'O nome do WhatsApp está preenchido?',
              'O chip tem pelo menos 7 dias de criação?',
              'O número não foi banido anteriormente?',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 py-1.5">
                <MdCheckCircle size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-surface-400">{item}</span>
              </div>
            ))}
          </div>

          {/* Toggle Manutenção Pós-conclusão — só para chips não-veteranos */}
          {!isVeterano && (
          <div className="rounded-xl border border-surface-700/40 p-4 flex items-center justify-between gap-4" style={{ background: '#1a1425' }}>
            <div className="flex items-start gap-3">
              <span className="text-xl">🔧</span>
              <div>
                <p className="text-sm font-semibold text-surface-200">Manter aquecimento pós-conclusão</p>
                <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">
                  Após concluir, chip continua recebendo 3-5 msgs/dia para manter histórico ativo e score alto no WhatsApp.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setManutencaoAtiva(v => !v)}
              className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200"
              style={{ background: manutencaoAtiva ? '#f59e0b' : '#374151' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: manutencaoAtiva ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
          )}

          {/* Toggle IA Gemini — oculto para veterano */}
          {!isVeterano && (
          <div className="rounded-xl border border-surface-700/40 p-4 flex items-center justify-between gap-4" style={{ background: '#1a1425' }}>
            <div className="flex items-start gap-3">
              <span className="text-xl">✨</span>
              <div>
                <p className="text-sm font-semibold text-surface-200">Usar IA Gemini para mensagens</p>
                <p className="text-xs text-surface-500 mt-0.5 leading-relaxed">
                  Gera mensagens únicas e naturais com IA. Requer chave configurada em <strong>Configurações &gt; IA</strong>.
                  Fallback automático para pool fixo se indisponível.
                </p>
              </div>
            </div>
            <button
              onClick={() => setUsarIa(v => !v)}
              className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200"
              style={{ background: usarIa ? '#9D4EDD' : '#374151' }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
                style={{ transform: usarIa ? 'translateX(20px)' : 'translateX(0)' }}
              />
            </button>
          </div>
          )}

          {/* Aviso — adaptado por origem */}
          {isVeterano ? (
            <div className="rounded-xl border border-yellow-500/20 p-4 flex gap-3" style={{ background: 'rgba(234,179,8,0.06)' }}>
              <span className="text-lg flex-shrink-0 mt-0.5">⭐</span>
              <p className="text-xs text-yellow-300/80 leading-relaxed">
                <strong>Chip Veterano:</strong> Confirme que este número tem histórico real de uso pessoal.
                Chips novos marcados como veteranos correm risco elevado de ban.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-red-500/20 p-4 flex gap-3" style={{ background: 'rgba(239,68,68,0.06)' }}>
              <MdWarning size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/80 leading-relaxed">
                <strong>Atenção:</strong> Não use este chip para disparos em massa durante o período de aquecimento. Isso pode causar banimento imediato.
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-surface-700/40 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={saving || selectedIds.size === 0} className="btn-primary px-6 py-2 text-sm">
            {saving
              ? 'Processando...'
              : isVeterano
                ? `⭐ Marcar ${selectedIds.size} chip(s) como Veterano`
                : isPreAquecido
                  ? `🛍️ Iniciar Adaptação (${selectedIds.size} chip${selectedIds.size !== 1 ? 's' : ''})`
                  : `🔥 Iniciar Aquecimento (${selectedIds.size} chip${selectedIds.size !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Modal Logs ────────────────────────────────────────────────────────────────

function ModalLogs({ aq, onClose }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/aquecimento/${aq.id}/logs`)
      .then(r => setLogs(r.data))
      .catch(() => toast.error('Erro ao carregar logs'))
      .finally(() => setLoading(false))
  }, [aq.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-2xl rounded-2xl border border-surface-700/50 shadow-2xl flex flex-col" style={{ background: '#120e1e', maxHeight: '85vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700/40 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-surface-50">Logs — {aq.session_name}</h2>
            <p className="text-xs text-surface-500 mt-0.5">Histórico de envios do aquecimento</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 transition-colors">
            <MdClose size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="py-10 text-center text-surface-500 text-sm">Carregando...</div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-surface-500 text-sm">Nenhum envio registrado ainda</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-surface-500 border-b border-surface-700/40">
                  <th className="pb-2 font-medium">Horário</th>
                  <th className="pb-2 font-medium px-3">Destino</th>
                  <th className="pb-2 font-medium">Mensagem</th>
                  <th className="pb-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/40">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-surface-800/20 transition-colors">
                    <td className="py-2.5 text-surface-500 whitespace-nowrap">{formatDateTime(l.criado_em)}</td>
                    <td className="py-2.5 px-3 font-mono text-surface-400">{l.telefone_destino}</td>
                    <td className="py-2.5 text-surface-300 max-w-[220px] truncate">{l.mensagem}</td>
                    <td className="py-2.5 text-center">
                      {l.status === 'enviado_ia' ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(157,78,221,0.2)', color: '#b07de6', border: '1px solid rgba(157,78,221,0.3)' }}>✨ IA</span>
                      ) : l.status === 'enviado' ? (
                        <span className="badge-green">✓ pool</span>
                      ) : l.status === 'respondido' ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>💬 resposta</span>
                      ) : l.status === 'aguardando' ? (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>⏳ aguardando</span>
                      ) : (
                        <span className="badge-red">✗ erro</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Card de Aquecimento ───────────────────────────────────────────────────────

function CardAquecimento({ aq, onPausar, onRetomar, onLogs, onCancelar, onToggleManutencao }) {
  const saude = getSaude(aq)
  const progressoDia = aq.dias_total > 0 ? Math.min(100, Math.round((aq.dia_atual - 1) / aq.dias_total * 100)) : 0
  const progressoMsgs = aq.meta_hoje > 0 ? Math.min(100, Math.round(aq.msgs_hoje / aq.meta_hoje * 100)) : 0
  const isAtivo = aq.status === 'ativo'
  const isPausado = aq.status === 'pausado'
  const isManutencao = aq.status === 'manutencao'
  const isFinalizado = ['concluido', 'cancelado'].includes(aq.status)

  return (
    <div className="glass-card flex flex-col gap-4" style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
            style={{
              background: aq.tipo_chip === 'virtual' ? 'rgba(59,130,246,0.15)' : 'rgba(157,78,221,0.15)',
              border: aq.tipo_chip === 'virtual' ? '1px solid rgba(59,130,246,0.25)' : '1px solid rgba(157,78,221,0.25)',
            }}>
            {aq.tipo_chip === 'virtual' ? '💻' : '📱'}
          </div>
          <div>
            <p className="font-bold text-surface-100 text-sm">{aq.session_name}</p>
            {aq.session_phone && <p className="text-[11px] text-surface-500 font-mono">{aq.session_phone}</p>}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md mt-0.5 inline-block" style={
              aq.tipo_chip === 'virtual'
                ? { background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)' }
                : { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }
            }>
              {aq.tipo_chip === 'virtual' ? '💻 Virtual' : '📱 Físico'}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isAtivo && <span className="badge-green text-[10px]">🔥 Aquecendo</span>}
          {isPausado && <span className="badge-yellow text-[10px]">⏸ Pausado</span>}
          {isManutencao && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' }}>
              🔧 Manutenção
            </span>
          )}
          {aq.status === 'concluido' && <span className="badge-primary text-[10px]">✅ Concluído</span>}
          {aq.status === 'cancelado' && <span className="badge-red text-[10px]">❌ Cancelado</span>}
          {(aq.session_is_aquecido || isManutencao) && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(234,179,8,0.12)', color: '#f59e0b', border: '1px solid rgba(234,179,8,0.25)' }}>
              🔥 Chip aquecido
            </span>
          )}
          {aq.usar_ia && isAtivo && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(157,78,221,0.2)', color: '#b07de6', border: '1px solid rgba(157,78,221,0.3)' }}>
              ✨ Gemini IA
            </span>
          )}
        </div>
      </div>

      {/* Progresso dias */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-surface-400 font-medium">Progresso</span>
          <span className="text-xs font-bold text-primary-300">Dia {aq.dia_atual} de {aq.dias_total}</span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-800/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressoDia}%`,
              background: 'linear-gradient(90deg, #9D4EDD, #6A0DAD)',
            }}
          />
        </div>
        <p className="text-[10px] text-surface-600 mt-1">{progressoDia}% concluído</p>
      </div>

      {/* Mensagens hoje */}
      <div>
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-xs text-surface-400 font-medium">Mensagens hoje</span>
          <span className="text-xs font-bold text-emerald-400">{aq.msgs_hoje} / {aq.meta_hoje}</span>
        </div>
        <div className="h-2 rounded-full bg-surface-800/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progressoMsgs}%`,
              background: 'linear-gradient(90deg, #10b981, #059669)',
            }}
          />
        </div>
      </div>

      {/* Virtual chip stats */}
      {aq.tipo_chip === 'virtual' && (
        <div className="rounded-xl border border-blue-500/20 p-3 flex items-center justify-around text-xs" style={{ background: 'rgba(59,130,246,0.06)' }}>
          <div className="text-center">
            <p className="font-bold text-blue-400 text-base">{aq.msgs_recebidas ?? 0}</p>
            <p className="text-surface-500">📨 recebidas</p>
          </div>
          <div className="w-px h-8 bg-surface-700/50" />
          <div className="text-center">
            <p className="font-bold text-emerald-400 text-base">{aq.respostas_enviadas ?? 0}</p>
            <p className="text-surface-500">✉️ respostas</p>
          </div>
          <div className="w-px h-8 bg-surface-700/50" />
          <div className="text-center">
            <p className="font-bold text-amber-400 text-base">{aq.fisicos_disponiveis ?? 0}</p>
            <p className="text-surface-500">🌐 físicos</p>
          </div>
        </div>
      )}
      {aq.tipo_chip === 'virtual' && isAtivo && (aq.fisicos_disponiveis ?? 0) === 0 && (
        <div className="rounded-lg border border-amber-500/20 p-2.5 text-xs text-amber-300/80 flex items-center gap-2" style={{ background: 'rgba(245,158,11,0.06)' }}>
          ⏸ Aguardando chip físico no pool (0 disponíveis)
        </div>
      )}

      {/* Fase de adaptação */}
      {aq.is_adaptacao && isAtivo && (
        <div className="rounded-xl border border-purple-500/20 p-3" style={{ background: 'rgba(157,78,221,0.06)' }}>
          <p className="text-xs font-bold text-purple-300 mb-1">🛍️ Modo Adaptação</p>
          {aq.fase_adaptacao === 'passiva' && (
            <p className="text-xs text-surface-500">📭 Dias 1-2: fase passiva — recebendo mensagens, sem enviar</p>
          )}
          {aq.fase_adaptacao === 'gradual_leve' && (
            <p className="text-xs text-surface-500">📈 Dias 3-4: fase gradual — meta 5 msgs/dia</p>
          )}
          {aq.fase_adaptacao === 'gradual_media' && (
            <p className="text-xs text-surface-500">📈 Dias 5-6: fase gradual — meta 15 msgs/dia</p>
          )}
          {aq.fase_adaptacao === 'pre_liberacao' && (
            <p className="text-xs text-surface-500">🚀 Dia 7: pré-liberação — meta 30 msgs/dia</p>
          )}
          {(aq.dias_adaptacao_restantes ?? 0) > 0 && (
            <p className="text-[11px] text-purple-400 mt-1.5">⏳ {aq.dias_adaptacao_restantes} dia(s) restantes para liberação</p>
          )}
        </div>
      )}

      {/* Info row */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          <span style={{ color: saude.color }}>{saude.emoji}</span>
          <span className="text-surface-400">Saúde: <span className="font-semibold" style={{ color: saude.color }}>{saude.label}</span></span>
        </div>
        {isAtivo && aq.tipo_chip !== 'virtual' && (
          <div className="text-surface-500">
            Próximo: <span className="font-medium text-surface-300">{formatProximoEnvio(aq.proximo_envio)}</span>
          </div>
        )}
      </div>

      {/* Ações */}
      {!isFinalizado && (
        <div className="flex items-center gap-2 pt-1 border-t border-surface-700/30">
          {isAtivo && (
            <button
              onClick={() => onPausar(aq)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-yellow-300 bg-yellow-500/10 border border-yellow-500/25 hover:bg-yellow-500/20 transition-colors"
            >
              <MdPause size={14} /> Pausar
            </button>
          )}
          {isPausado && (
            <button
              onClick={() => onRetomar(aq)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 transition-colors"
            >
              <MdPlayArrow size={14} /> Retomar
            </button>
          )}
          <button
            onClick={() => onLogs(aq)}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-surface-400 bg-surface-800/40 border border-surface-700/40 hover:text-surface-200 hover:bg-surface-700/40 transition-colors flex items-center gap-1.5"
          >
            <MdHistory size={14} /> Logs
          </button>
          <button
            onClick={() => onCancelar(aq)}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-red-400/60 bg-red-900/10 border border-red-500/15 hover:text-red-400 hover:bg-red-900/25 transition-colors"
          >
            <MdDelete size={14} />
          </button>
        </div>
      )}
      {isFinalizado && (
        <div className="flex gap-2 pt-1 border-t border-surface-700/30">
          <button
            onClick={() => onLogs(aq)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-surface-400 bg-surface-800/40 border border-surface-700/40 hover:text-surface-200 hover:bg-surface-700/40 transition-colors"
          >
            <MdHistory size={14} /> Ver histórico
          </button>
          {aq.status === 'concluido' && (
            <button
              onClick={() => onToggleManutencao(aq)}
              title="Ativar manutenção: chip continua recebendo 3-5 msgs/dia"
              className="px-3 py-2 rounded-xl text-xs font-semibold text-yellow-400/70 bg-yellow-900/10 border border-yellow-500/20 hover:text-yellow-400 hover:bg-yellow-900/20 transition-colors"
            >
              🔧 Manutenção
            </button>
          )}
        </div>
      )}
      {isManutencao && (
        <div className="flex gap-2 pt-1 border-t border-surface-700/30">
          <button
            onClick={() => onLogs(aq)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-surface-400 bg-surface-800/40 border border-surface-700/40 hover:text-surface-200 hover:bg-surface-700/40 transition-colors"
          >
            <MdHistory size={14} /> Logs
          </button>
          <button
            onClick={() => onToggleManutencao(aq)}
            title="Desativar manutenção contínua"
            className="px-3 py-2 rounded-xl text-xs font-semibold text-yellow-400 bg-yellow-900/15 border border-yellow-500/30 hover:bg-yellow-900/25 transition-colors flex items-center gap-1"
          >
            ⏹ Parar manutenção
          </button>
        </div>
      )}
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────────

export default function Aquecimento() {
  const [aquecimentos, setAquecimentos] = useState([])
  const [sessoes, setSessoes] = useState([])
  const [stats, setStats] = useState(null)
  const [poolStatus, setPoolStatus] = useState({ fisicos: 0, virtuais: 0 })
  const [loading, setLoading] = useState(true)
  const [modalIniciar, setModalIniciar] = useState(false)
  const [modalLogs, setModalLogs] = useState(null)

  const carregar = useCallback(async () => {
    try {
      const [aqR, sessR, statsR, poolR] = await Promise.all([
        api.get('/aquecimento'),
        api.get('/sessoes'),
        api.get('/aquecimento/stats'),
        api.get('/aquecimento/pool-status'),
      ])
      setAquecimentos(Array.isArray(aqR.data) ? aqR.data : (aqR.data?.items ?? []))
      setSessoes(Array.isArray(sessR.data) ? sessR.data : (sessR.data.items ?? []))
      setStats(statsR.data)
      setPoolStatus(poolR.data)
    } catch {
      toast.error('Erro ao carregar dados de aquecimento')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    carregar()
    const interval = setInterval(carregar, 30000)
    return () => clearInterval(interval)
  }, [carregar])

  async function pausar(aq) {
    try {
      await api.put(`/aquecimento/${aq.id}/pausar`)
      toast.success('Aquecimento pausado')
      carregar()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao pausar')
    }
  }

  async function retomar(aq) {
    try {
      await api.put(`/aquecimento/${aq.id}/retomar`)
      toast.success('Aquecimento retomado!')
      carregar()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao retomar')
    }
  }

  async function toggleManutencao(aq) {
    const acao = aq.status === 'manutencao' ? 'Desativar' : 'Ativar'
    try {
      await api.put(`/aquecimento/${aq.id}/manutencao`)
      toast.success(`${acao} manutenção — ${aq.session_name}`)
      carregar()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao alterar manutenção')
    }
  }

  async function cancelar(aq) {
    if (!window.confirm(`Cancelar aquecimento do chip "${aq.session_name}"?`)) return
    try {
      await api.delete(`/aquecimento/${aq.id}`)
      toast.success('Aquecimento cancelado')
      carregar()
    } catch {
      toast.error('Erro ao cancelar')
    }
  }

  const ativos = aquecimentos.filter(a => a.status === 'ativo')
  const pausados = aquecimentos.filter(a => a.status === 'pausado')
  const emManutencao = aquecimentos.filter(a => a.status === 'manutencao')
  const finalizados = aquecimentos.filter(a => ['concluido', 'cancelado'].includes(a.status))
  const sessoesConectadas = sessoes.filter(s => s.status === 'connected' || s.status === 'CONNECTED')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 tracking-tight">Aquecimento de Chip 🔥</h1>
          <p className="text-sm text-surface-400 mt-1">Prepare seus chips com segurança antes de disparar</p>
        </div>
        <button
          onClick={() => setModalIniciar(true)}
          className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm"
        >
          <MdAdd size={18} /> Iniciar Aquecimento
        </button>
      </div>

      {/* Banner de aviso */}
      <div className="rounded-2xl border border-orange-500/30 bg-orange-950/20 px-5 py-4 flex items-start gap-3">
        <MdWarning size={20} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-orange-300">
            ⚠️ Durante o aquecimento, evite disparos em massa neste chip
          </p>
          <p className="text-xs text-orange-400/70 mt-0.5 leading-relaxed">
            O aquecimento envia mensagens naturais com delays aleatórios de 10-40 min para construir reputação gradualmente.
            Disparos em massa simultâneos podem comprometer o processo e levar ao ban.
          </p>
        </div>
      </div>

      {/* Pool Status */}
      <div className="rounded-xl border border-surface-700/40 p-4 flex flex-wrap items-center gap-6" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">🌐 Pool Colaborativo</span>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: poolStatus.fisicos > 0 ? '#4ade80' : '#6b7280' }} />
          <span className="text-sm font-bold text-emerald-400">{poolStatus.fisicos}</span>
          <span className="text-xs text-surface-400">📱 Chips físicos conectados</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: poolStatus.virtuais > 0 ? '#60a5fa' : '#6b7280' }} />
          <span className="text-sm font-bold text-blue-400">{poolStatus.virtuais}</span>
          <span className="text-xs text-surface-400">💻 Chips virtuais conectados</span>
        </div>
        <p className="text-xs text-surface-600 ml-auto hidden sm:block">Físicos enviam → Virtuais respondem → Conversa natural!</p>
      </div>

      {/* Stats globais */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Chips Aquecendo', value: stats.total_ativos, color: '#f97316', emoji: '🔥' },
            { label: 'Concluídos', value: stats.total_concluidos, color: '#22c55e', emoji: '✅' },
            { label: 'Progresso médio', value: `${stats.progresso_medio}%`, color: '#9D4EDD', emoji: '📈' },
          ].map(s => (
            <div key={s.label} className="glass-card">
              <div className="text-2xl mb-1">{s.emoji}</div>
              <div className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-xs text-surface-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Aviso sem chips */}
      {sessoesConectadas.length === 0 && (
        <div className="rounded-xl border border-red-500/20 bg-red-950/15 px-4 py-3 flex items-center gap-2.5">
          <span className="text-red-400">⚠️</span>
          <p className="text-xs text-red-300">Nenhum chip WhatsApp conectado. Conecte um chip em <strong>Sessões</strong> para poder iniciar o aquecimento.</p>
        </div>
      )}

      {/* Carregando */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : aquecimentos.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl mb-4">🔥</div>
          <h3 className="text-lg font-bold text-surface-200 mb-2">Nenhum aquecimento iniciado</h3>
          <p className="text-sm text-surface-500 max-w-sm mb-5">
            Aqueça seus chips gradualmente para aumentar a reputação e evitar banimentos durante disparos em massa.
          </p>
          <button onClick={() => setModalIniciar(true)} className="btn-primary flex items-center gap-2 px-5 py-2.5">
            <MdAdd size={18} /> Iniciar primeiro aquecimento
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Ativos e pausados */}
          {(ativos.length > 0 || pausados.length > 0) && (
            <div>
              <h2 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-3">Em andamento</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {[...ativos, ...pausados].map(aq => (
                  <CardAquecimento
                    key={aq.id}
                    aq={aq}
                    onPausar={pausar}
                    onRetomar={retomar}
                    onLogs={setModalLogs}
                    onCancelar={cancelar}
                    onToggleManutencao={toggleManutencao}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Em manutenção */}
          {emManutencao.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                🔧 Manutenção contínua
                <span className="text-xs font-normal text-surface-500 normal-case tracking-normal">(3-5 msgs/dia para manter score ativo)</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {emManutencao.map(aq => (
                  <CardAquecimento
                    key={aq.id}
                    aq={aq}
                    onPausar={pausar}
                    onRetomar={retomar}
                    onLogs={setModalLogs}
                    onCancelar={cancelar}
                    onToggleManutencao={toggleManutencao}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Finalizados */}
          {finalizados.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-surface-400 uppercase tracking-wider mb-3">Histórico</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {finalizados.map(aq => (
                  <CardAquecimento
                    key={aq.id}
                    aq={aq}
                    onPausar={pausar}
                    onRetomar={retomar}
                    onLogs={setModalLogs}
                    onCancelar={cancelar}
                    onToggleManutencao={toggleManutencao}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Guia anti-ban */}
      <div className="glass-card">
        <h3 className="text-sm font-semibold text-surface-200 mb-4 flex items-center gap-2">
          <MdInfo size={16} className="text-blue-400" /> Como funciona o aquecimento anti-ban
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { emoji: '📈', title: 'Progressão gradual', desc: 'Dias 1-3: 3 msgs • Dias 4-7: 8 msgs • Dias 8-14: 20 msgs • Dias 15-21: 40 msgs/dia' },
            { emoji: '⏱️', title: 'Delays aleatórios', desc: 'Entre 10-40 minutos entre mensagens. Após 3 msgs seguidas: pausa de 45-90 min' },
            { emoji: '🕗', title: 'Horário humanizado', desc: 'Envios apenas entre 08h e 20h, horário de Brasília. Nunca envia de madrugada' },
            { emoji: '💬', title: 'Mensagens naturais', desc: '60+ mensagens variadas: saudações, perguntas, comentários. Nunca repete a mesma em sequência' },
          ].map(item => (
            <div key={item.title} className="flex gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.025)' }}>
              <span className="text-xl flex-shrink-0">{item.emoji}</span>
              <div>
                <p className="text-xs font-semibold text-surface-300">{item.title}</p>
                <p className="text-[11px] text-surface-500 mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modais */}
      {modalIniciar && (
        <ModalIniciar
          sessoes={sessoes}
          aquecimentos={aquecimentos}
          poolStatus={poolStatus}
          onSave={() => { setModalIniciar(false); carregar() }}
          onClose={() => setModalIniciar(false)}
        />
      )}
      {modalLogs && (
        <ModalLogs aq={modalLogs} onClose={() => setModalLogs(null)} />
      )}
    </div>
  )
}
