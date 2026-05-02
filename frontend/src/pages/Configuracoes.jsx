import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { User, CreditCard, Bell, Smartphone, Brain, Sliders, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../api'

const sections = [
  { id: 'perfil',        label: 'Perfil',              icon: User },
  { id: 'plano',         label: 'Plano & Uso',          icon: CreditCard },
  { id: 'notificacoes',  label: 'Notificações',         icon: Bell },
  { id: 'seguranca',     label: 'Segurança',            icon: Smartphone },
]

export default function Configuracoes() {
  const [active, setActive] = useState('perfil')
  const [user, setUser] = useState(null)
  const [plano, setPlano] = useState(null)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', email: '' })
  const [pwForm, setPwForm] = useState({ senha_atual: '', nova_senha: '', confirmar: '' })
  const [savingPerfil, setSavingPerfil] = useState(false)
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    Promise.all([
      api.get('/usuarios/me').catch(() => ({ data: null })),
      api.get('/usuarios/plano-info').catch(() => ({ data: null })),
    ]).then(([meRes, planoRes]) => {
      if (meRes.data) {
        setUser(meRes.data)
        setForm({ name: meRes.data.name || '', email: meRes.data.email || '' })
      }
      if (planoRes.data) setPlano(planoRes.data)
      setLoading(false)
    })
  }, [])

  async function savePerfil() {
    setSavingPerfil(true)
    try {
      const { data } = await api.put('/usuarios/me', { name: form.name })
      setUser(data)
      // update localStorage
      try {
        const u = JSON.parse(localStorage.getItem('user') || '{}')
        localStorage.setItem('user', JSON.stringify({ ...u, name: data.name }))
      } catch {}
      toast.success('Perfil atualizado!')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao salvar')
    }
    setSavingPerfil(false)
  }

  async function changePw() {
    if (pwForm.nova_senha !== pwForm.confirmar) { toast.error('Senhas não conferem'); return }
    if (pwForm.nova_senha.length < 6) { toast.error('Mínimo 6 caracteres'); return }
    setSavingPw(true)
    try {
      await api.post('/usuarios/alterar-senha', {
        senha_atual: pwForm.senha_atual,
        nova_senha: pwForm.nova_senha,
      })
      toast.success('Senha alterada!')
      setPwForm({ senha_atual: '', nova_senha: '', confirmar: '' })
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Erro ao alterar senha')
    }
    setSavingPw(false)
  }

  const PLAN_LABELS = { starter: 'Starter', pro: 'Pro', business: 'Business' }
  const PLAN_COLORS = { starter: 'bg-blue-500/10 text-blue-400 border-blue-500/20', pro: 'bg-primary/10 text-primary border-primary/20', business: 'bg-amber-500/10 text-amber-400 border-amber-500/20' }

  return (
    <div className="flex gap-6">
      {/* Sidebar de seções */}
      <div className="w-56 shrink-0 space-y-1">
        {sections.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
              active === s.id ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/20'
            }`}>
            <s.icon className="h-4 w-4" /> {s.label}
          </button>
        ))}
      </div>

      {/* Conteúdo */}
      <motion.div key={active} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}
        className="flex-1 glass-card p-6 space-y-6">

        {active === 'perfil' && (
          <>
            <h2 className="text-lg font-semibold text-foreground/90">Perfil</h2>
            {loading ? (
              <p className="text-muted-foreground text-sm">Carregando...</p>
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Nome</label>
                  <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full max-w-md bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">E-mail</label>
                  <input type="email" value={form.email} disabled
                    className="w-full max-w-md bg-muted/20 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-muted-foreground cursor-not-allowed" />
                  <p className="text-xs text-muted-foreground mt-1">O e-mail não pode ser alterado</p>
                </div>
                <button onClick={savePerfil} disabled={savingPerfil}
                  className="flex items-center gap-2 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                  <Save className="h-4 w-4" /> {savingPerfil ? 'Salvando...' : 'Salvar Perfil'}
                </button>
              </>
            )}
          </>
        )}

        {active === 'plano' && (
          <>
            <h2 className="text-lg font-semibold text-foreground/90">Plano & Uso</h2>
            {loading ? (
              <p className="text-muted-foreground text-sm">Carregando...</p>
            ) : (
              <>
                {user && (
                  <div className={`p-4 rounded-xl border ${PLAN_COLORS[user.plan] || 'bg-muted border-white/10'}`}>
                    <p className="text-sm font-medium">{PLAN_LABELS[user.plan] || user.plan}</p>
                    {user.trial_ativo && (
                      <p className="text-xs mt-1 opacity-80">Trial ativo — {user.trial_dias_restantes ?? '?'} dia(s) restante(s)</p>
                    )}
                    {user.plan_expires_at && !user.trial_ativo && (
                      <p className="text-xs mt-1 opacity-80">
                        Vence em {new Date(user.plan_expires_at).toLocaleDateString('pt-BR')}
                      </p>
                    )}
                  </div>
                )}
                {plano && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Sessões em uso</span>
                        <span className="font-mono-data text-foreground/80">{plano.sessoes_usadas ?? '?'} / {plano.limite_sessoes ?? '?'}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full"
                          style={{ width: `${plano.limite_sessoes ? Math.round((plano.sessoes_usadas / plano.limite_sessoes) * 100) : 0}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Disparos hoje</span>
                        <span className="font-mono-data text-foreground/80">{plano.disparos_hoje ?? '?'} / {plano.limite_diario ?? '?'}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-success rounded-full"
                          style={{ width: `${plano.limite_diario ? Math.round((plano.disparos_hoje / plano.limite_diario) * 100) : 0}%` }} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {active === 'seguranca' && (
          <>
            <h2 className="text-lg font-semibold text-foreground/90">Segurança</h2>
            <div className="space-y-4 max-w-md">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Senha atual</label>
                <input type="password" value={pwForm.senha_atual}
                  onChange={e => setPwForm(f => ({ ...f, senha_atual: e.target.value }))}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nova senha</label>
                <input type="password" value={pwForm.nova_senha}
                  onChange={e => setPwForm(f => ({ ...f, nova_senha: e.target.value }))}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Confirmar nova senha</label>
                <input type="password" value={pwForm.confirmar}
                  onChange={e => setPwForm(f => ({ ...f, confirmar: e.target.value }))}
                  className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              </div>
              <button onClick={changePw} disabled={savingPw || !pwForm.senha_atual || !pwForm.nova_senha}
                className="flex items-center gap-2 px-6 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
                <Save className="h-4 w-4" /> {savingPw ? 'Salvando...' : 'Alterar Senha'}
              </button>
            </div>
          </>
        )}

        {active === 'notificacoes' && (
          <>
            <h2 className="text-lg font-semibold text-foreground/90">Notificações</h2>
            {['Chip offline', 'Campanha concluída', 'Fuzzy Score baixo', 'Limite diário atingido', 'Novo contato extraído'].map((n, i) => (
              <div key={i} className="flex justify-between items-center py-3 border-b border-white/5">
                <span className="text-sm text-foreground/80">{n}</span>
                <label className="relative inline-flex cursor-pointer">
                  <input type="checkbox" defaultChecked={i < 3} className="sr-only peer" />
                  <div className="w-9 h-5 rounded-full bg-muted peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-foreground after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">As configurações de notificação serão aplicadas às notificações do sistema.</p>
          </>
        )}
      </motion.div>
    </div>
  )
}
