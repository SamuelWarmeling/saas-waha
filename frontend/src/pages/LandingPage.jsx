import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// ── FAQ Accordion ─────────────────────────────────────────────────────────────

const faqs = [
  {
    q: 'O sistema tem risco de ban?',
    a: 'Utilizamos inteligência artificial para simular comportamento humano: delays aleatórios entre mensagens, variações de texto e controle de volume diário. O risco é reduzido ao mínimo.',
  },
  {
    q: 'Preciso ter o WhatsApp Business?',
    a: 'Não. O sistema funciona com qualquer número de WhatsApp, seja pessoal ou Business. Basta escanear o QR Code e começar.',
  },
  {
    q: 'Posso cancelar quando quiser?',
    a: 'Sim, sem fidelidade ou multa. Cancele a qualquer momento pelo painel e você não será cobrado no próximo mês.',
  },
  {
    q: 'Quantas mensagens posso enviar por dia?',
    a: 'No plano Pro você pode enviar até 500 mensagens por dia por sessão. Com múltiplas sessões, o volume escala proporcionalmente.',
  },
  {
    q: 'Como funciona o período de 7 dias grátis?',
    a: 'Você cria sua conta, acessa todas as funcionalidades e só é cobrado após 7 dias. Sem precisar de cartão de crédito para começar.',
  },
  {
    q: 'Suportam imagens, vídeos e arquivos?',
    a: 'Sim! Além de texto, você pode disparar imagens, vídeos, documentos e até áudios nas suas campanhas.',
  },
]

function FAQItem({ item, open, onToggle }) {
  return (
    <div className="border border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 text-left bg-gray-800 hover:bg-gray-750 transition-colors"
      >
        <span className="font-semibold text-white">{item.q}</span>
        <span className={`text-purple-400 text-xl transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-3 bg-gray-800 border-t border-gray-700 text-gray-300 text-sm leading-relaxed">
          {item.a}
        </div>
      )}
    </div>
  )
}

// ── Testimonials ──────────────────────────────────────────────────────────────

const testimonials = [
  {
    name: 'Carlos Mendes',
    role: 'Dono de imobiliária',
    avatar: 'CM',
    text: 'Antes eu perdia 3 horas por dia mandando mensagem manualmente. Agora disparo para 400 leads em 15 minutos e minha taxa de resposta triplicou.',
    stars: 5,
  },
  {
    name: 'Juliana Ferreira',
    role: 'Gestora de tráfego',
    avatar: 'JF',
    text: 'Testei várias ferramentas e o WahaSaaS é o único que não tomei ban em 4 meses de uso. A IA de anti-ban é incrível.',
    stars: 5,
  },
  {
    name: 'Ricardo Alves',
    role: 'E-commerce de moda',
    avatar: 'RA',
    text: 'Fiz R$12.000 em vendas no primeiro mês usando o sistema para disparar promoções. ROI absurdo comparado ao valor da ferramenta.',
    stars: 5,
  },
]

// ── Features ──────────────────────────────────────────────────────────────────

const features = [
  { icon: '🤖', title: 'IA Anti-Ban', desc: 'Delays humanizados, variação de mensagem e controle inteligente de volume para proteger seu número.' },
  { icon: '📊', title: 'Dashboard Completo', desc: 'Acompanhe taxa de entrega, leitura e resposta em tempo real com gráficos detalhados.' },
  { icon: '📋', title: 'Gestão de Contatos', desc: 'Importe via Excel/CSV, organize por listas, tags e filtros avançados por DDD e status.' },
  { icon: '📅', title: 'Agendamento', desc: 'Programe campanhas para horários específicos e dias da semana com recorrência.' },
  { icon: '🔄', title: 'Múltiplas Sessões', desc: 'Conecte vários números e dispare de múltiplas contas simultaneamente.' },
  { icon: '📎', title: 'Mídias Ricas', desc: 'Envie imagens, vídeos, documentos, áudios e stickers nas suas campanhas.' },
]

// ── Main Component ─────────────────────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate()
  const [openFaq, setOpenFaq] = useState(null)

  const goToCheckout = () => navigate('/checkout')

  return (
    <div className="min-h-screen bg-gray-900 text-white">

      {/* ── Navbar ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/90 backdrop-blur border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-violet-500 rounded-lg flex items-center justify-center text-sm font-bold">W</div>
            <span className="font-bold text-lg">WahaSaaS</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-gray-400">
            <a href="#funcionalidades" className="hover:text-white transition-colors">Funcionalidades</a>
            <a href="#precos" className="hover:text-white transition-colors">Preços</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/login')} className="text-sm text-gray-400 hover:text-white transition-colors hidden md:block">
              Entrar
            </button>
            <button onClick={goToCheckout} className="bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              Começar grátis
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-32 pb-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-purple-600/20 border border-purple-500/40 rounded-full px-4 py-2 text-sm text-purple-300 mb-6">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            IA Anti-Ban ativa · 47 pessoas usando agora
          </div>

          <h1 className="text-4xl md:text-6xl font-extrabold leading-tight mb-6">
            Dispare no WhatsApp em massa{' '}
            <span className="bg-gradient-to-r from-purple-400 to-violet-400 bg-clip-text text-transparent">
              sem tomar ban
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            A única plataforma com IA Anti-Ban que humaniza seus disparos automaticamente.
            Conecte seus números, importe seus contatos e dispare em minutos.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={goToCheckout}
              className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all shadow-lg shadow-purple-900/50 hover:shadow-purple-700/50 hover:-translate-y-0.5"
            >
              Começar 7 dias grátis →
            </button>
            <p className="text-sm text-gray-500">Sem cartão de crédito · Cancele quando quiser</p>
          </div>

          <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto text-center">
            {[['500+', 'Clientes ativos'], ['2M+', 'Msgs disparadas'], ['99.2%', 'Uptime']].map(([v, l]) => (
              <div key={l}>
                <p className="text-2xl font-bold text-purple-400">{v}</p>
                <p className="text-xs text-gray-500 mt-1">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problems ── */}
      <section className="py-20 px-4 bg-gray-800/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Você sofre com isso?</h2>
            <p className="text-gray-400">Problemas que impedem seu crescimento no WhatsApp</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: 'Ban constante', desc: 'Seu número é banido com frequência e você perde toda sua base de contatos.' },
              { title: 'Processo manual lento', desc: 'Você passa horas enviando mensagens uma a uma, desperdiçando tempo valioso.' },
              { title: 'Sem métricas', desc: 'Você não sabe quantas mensagens chegaram, foram lidas ou geraram resposta.' },
              { title: 'Ferramentas caras', desc: 'Plataformas concorrentes cobram R$500+ por mês com recursos limitados.' },
              { title: 'Contatos desorganizados', desc: 'Sua lista de contatos está espalhada em planilhas sem segmentação.' },
              { title: 'Sem agendamento', desc: 'Você precisa estar online para disparar, sem opção de programar para depois.' },
            ].map((p) => (
              <div key={p.title} className="bg-red-900/10 border border-red-800/40 rounded-xl p-5">
                <p className="text-red-400 text-xl mb-2">❌</p>
                <h3 className="font-semibold text-white mb-1">{p.title}</h3>
                <p className="text-sm text-gray-400">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Solution ── */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              WahaSaaS resolve tudo isso
            </h2>
            <p className="text-gray-400">Funcionalidades pensadas para quem quer resultado de verdade</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { title: 'IA Anti-Ban avançada', desc: 'Algoritmos que simulam comportamento humano com delays aleatórios e variação automática.' },
              { title: 'Disparo em massa rápido', desc: 'Envie para milhares de contatos em minutos com apenas alguns cliques.' },
              { title: 'Dashboard com métricas', desc: 'Acompanhe entrega, leitura e resposta em tempo real. Tome decisões com dados.' },
              { title: 'Plano acessível', desc: 'A partir de R$97/mês com todas as funcionalidades. Sem surpresas na cobrança.' },
              { title: 'Gestão de contatos', desc: 'Importe Excel/CSV, organize por listas e tags, filtre por DDD ou status.' },
              { title: 'Agendamento inteligente', desc: 'Configure campanhas para disparar automaticamente no horário ideal para seu público.' },
            ].map((s) => (
              <div key={s.title} className="bg-purple-900/10 border border-purple-700/30 rounded-xl p-5">
                <p className="text-green-400 text-xl mb-2">✅</p>
                <h3 className="font-semibold text-white mb-1">{s.title}</h3>
                <p className="text-sm text-gray-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20 px-4 bg-gray-800/50">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Como funciona</h2>
            <p className="text-gray-400">Comece a disparar em menos de 5 minutos</p>
          </div>
          <div className="space-y-6">
            {[
              { n: '1', title: 'Crie sua conta', desc: 'Cadastre-se gratuitamente em menos de 1 minuto. Sem cartão de crédito.' },
              { n: '2', title: 'Conecte seu WhatsApp', desc: 'Escaneie o QR Code com seu celular e seu número estará conectado.' },
              { n: '3', title: 'Importe seus contatos', desc: 'Faça upload de uma planilha Excel ou CSV com sua lista de clientes.' },
              { n: '4', title: 'Crie sua campanha', desc: 'Escreva a mensagem, adicione mídias e configure os disparos.' },
              { n: '5', title: 'Dispare e acompanhe', desc: 'Inicie o disparo e acompanhe os resultados em tempo real no dashboard.' },
            ].map((step) => (
              <div key={step.n} className="flex gap-5 items-start">
                <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                  {step.n}
                </div>
                <div className="pt-1">
                  <h3 className="font-semibold text-white mb-1">{step.title}</h3>
                  <p className="text-sm text-gray-400">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="funcionalidades" className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Tudo que você precisa</h2>
            <p className="text-gray-400">Uma plataforma completa, sem precisar de nada mais</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-gray-800 border border-gray-700 rounded-xl p-6 hover:border-purple-600/50 transition-colors">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="py-20 px-4 bg-gray-800/50">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">O que nossos clientes dizem</h2>
            <p className="text-gray-400">Mais de 500 empreendedores já usam o WahaSaaS</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div key={t.name} className="bg-gray-800 border border-gray-700 rounded-xl p-6">
                <div className="flex items-center gap-1 text-yellow-400 mb-4 text-sm">
                  {'★'.repeat(t.stars)}
                </div>
                <p className="text-gray-300 text-sm leading-relaxed mb-5">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-purple-700 rounded-full flex items-center justify-center text-sm font-bold">
                    {t.avatar}
                  </div>
                  <div>
                    <p className="font-semibold text-white text-sm">{t.name}</p>
                    <p className="text-gray-500 text-xs">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="precos" className="py-20 px-4">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Investimento único</h2>
            <p className="text-gray-400">Um plano completo, sem limitações escondidas</p>
          </div>

          <div className="bg-gray-800 border-2 border-purple-600 rounded-2xl p-8 text-center relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-green-500 text-white text-xs font-bold px-3 py-1 rounded-full">
              7 DIAS GRÁTIS
            </div>
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-600/10 rounded-full blur-2xl"></div>

            <h3 className="text-xl font-bold text-white mb-2">Plano Pro</h3>
            <div className="mb-1">
              <span className="text-gray-500 line-through text-lg">R$197</span>
            </div>
            <div className="flex items-end justify-center gap-1 mb-6">
              <span className="text-gray-400 text-lg">R$</span>
              <span className="text-6xl font-extrabold text-white">97</span>
              <span className="text-gray-400 mb-2">/mês</span>
            </div>

            <ul className="text-left space-y-3 mb-8">
              {[
                '5 sessões WhatsApp',
                '500 disparos por dia',
                'IA Anti-Ban ativa',
                'Agendamento de campanhas',
                'Importação Excel/CSV',
                'Dashboard com métricas',
                'Suporte via WhatsApp',
                'Atualizações incluídas',
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-gray-300">
                  <span className="text-green-400 font-bold">✓</span>
                  {item}
                </li>
              ))}
            </ul>

            <button
              onClick={goToCheckout}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-4 rounded-xl text-lg transition-all shadow-lg shadow-purple-900/50 hover:-translate-y-0.5"
            >
              Começar 7 dias grátis →
            </button>
            <p className="text-gray-500 text-xs mt-3">Sem cartão de crédito · Cancele quando quiser</p>
          </div>
        </div>
      </section>

      {/* ── Guarantee ── */}
      <section className="py-16 px-4 bg-gray-800/50">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-6xl mb-4">🛡️</div>
          <h2 className="text-2xl md:text-3xl font-bold mb-3">Garantia de 7 dias</h2>
          <p className="text-gray-400 leading-relaxed">
            Teste o WahaSaaS por 7 dias completamente grátis. Se não gostar por qualquer motivo,
            basta cancelar e não será cobrado nada. Sem perguntas, sem burocracia.
          </p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Perguntas frequentes</h2>
            <p className="text-gray-400">Tire suas dúvidas antes de começar</p>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <FAQItem
                key={i}
                item={faq}
                open={openFaq === i}
                onToggle={() => setOpenFaq(openFaq === i ? null : i)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Final ── */}
      <section className="py-24 px-4 bg-gradient-to-br from-purple-900/40 to-violet-900/20 border-y border-purple-800/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-extrabold mb-6 leading-tight">
            Pronto para disparar sem ban?
          </h2>
          <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
            Junte-se a mais de 500 empreendedores que já escalam suas vendas com o WahaSaaS.
            Comece hoje, sem riscos.
          </p>
          <button
            onClick={goToCheckout}
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold px-10 py-5 rounded-xl text-xl transition-all shadow-xl shadow-purple-900/50 hover:shadow-purple-700/50 hover:-translate-y-1"
          >
            Criar conta grátis agora →
          </button>
          <p className="text-gray-600 text-sm mt-4">7 dias grátis · Sem cartão · Cancele a qualquer momento</p>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 px-4 border-t border-gray-800">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-purple-600 to-violet-500 rounded flex items-center justify-center text-xs font-bold text-white">W</div>
            <span className="text-gray-500">WahaSaaS © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-400 transition-colors">Termos de uso</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Privacidade</a>
            <button onClick={() => navigate('/login')} className="hover:text-gray-400 transition-colors">Login</button>
          </div>
        </div>
      </footer>

    </div>
  )
}
