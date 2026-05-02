import { useState } from 'react'
import { ArrowRight, BarChart3, Briefcase, ChevronRight, Landmark, ShieldCheck, TrendingUp, Wallet } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

const marketCards = [
  { name: 'Renda Fixa', value: '12.4% a.a.', detail: 'Carteiras com foco em previsibilidade e caixa mensal.' },
  { name: 'Fundos Multiestrategia', value: '+18.7%', detail: 'Diversificacao ativa com gestao de risco diaria.' },
  { name: 'Acoes Selecionadas', value: '+24.1%', detail: 'Exposicao tatica para crescimento de longo prazo.' },
]

const pillars = [
  {
    icon: BarChart3,
    title: 'Carteiras orientadas por dados',
    description: 'Modelos de alocacao por perfil, rebalanceamento assistido e leitura de risco em tempo real.',
  },
  {
    icon: ShieldCheck,
    title: 'Governanca e seguranca',
    description: 'Camadas de protecao, trilha de auditoria e monitoramento continuo das operacoes.',
  },
  {
    icon: Briefcase,
    title: 'Experiencia para investidor e assessor',
    description: 'Onboarding claro, jornadas de aporte simplificadas e acompanhamento de performance em um so lugar.',
  },
]

const products = [
  {
    label: 'Conservador',
    title: 'Reserva Estrategica',
    returnLabel: 'Meta anual',
    returnValue: 'CDI + 2.1%',
    description: 'Estrutura para preservar capital, capturar juros e manter liquidez para oportunidades.',
  },
  {
    label: 'Moderado',
    title: 'Crescimento Balanceado',
    returnLabel: 'Volatilidade alvo',
    returnValue: '8.5%',
    description: 'Combina renda fixa, credito e bolsa para buscar crescimento com oscilacao controlada.',
  },
  {
    label: 'Arrojado',
    title: 'Alpha Global',
    returnLabel: 'Janela sugerida',
    returnValue: '36 meses',
    description: 'Exposicao internacional, setores de crescimento e posicoes taticas para ganho de capital.',
  },
]

const steps = [
  'Abra sua conta e responda ao diagnostico de perfil.',
  'Receba uma carteira recomendada com objetivos, horizonte e risco.',
  'Acompanhe aportes, rentabilidade e ajustes pelo painel.',
]

const faqs = [
  {
    question: 'A plataforma serve para quem esta comecando?',
    answer: 'Sim. O fluxo foi desenhado para investidor iniciante e tambem para quem ja possui carteira e quer centralizar gestao, relatorios e acompanhamento.',
  },
  {
    question: 'Existe acompanhamento profissional?',
    answer: 'A proposta do site destaca acompanhamento consultivo, sugestoes de alocacao e visao consolidada da carteira. A modelagem regulatoria final depende da operacao que voce vai estruturar.',
  },
  {
    question: 'Posso oferecer diferentes perfis de investimento?',
    answer: 'Sim. A home ja comunica produtos para perfis conservador, moderado e arrojado, o que facilita depois conectar simuladores e onboarding por perfil.',
  },
  {
    question: 'A rentabilidade exibida e garantida?',
    answer: 'Nao. Os numeros da landing sao demonstrativos de posicionamento comercial. Se voce quiser publicar dados reais, precisa trocar por indicadores auditaveis e incluir os avisos regulatorios adequados.',
  },
]

function FAQItem({ item, open, onToggle }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
      >
        <span className="text-base font-semibold text-white">{item.question}</span>
        <span className={`text-xl text-amber-300 transition-transform ${open ? 'rotate-90' : ''}`}>
          <ChevronRight size={18} />
        </span>
      </button>
      {open && (
        <div className="border-t border-white/10 px-6 py-5 text-sm leading-7 text-slate-300">
          {item.answer}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ eyebrow, title, description }) {
  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">{eyebrow}</p>
      <h2 className="text-3xl font-semibold tracking-tight text-white md:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-300 md:text-lg">{description}</p>
    </div>
  )
}

export default function LandingPageInvestimento() {
  const navigate = useNavigate()
  const [openFaq, setOpenFaq] = useState(0)

  return (
    <div className="min-h-screen overflow-hidden bg-[#07111f] text-white">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_28%),radial-gradient(circle_at_80%_20%,_rgba(14,165,233,0.18),_transparent_24%),linear-gradient(180deg,_#07111f_0%,_#081a2f_52%,_#06101d_100%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:72px_72px]" />
      </div>

      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#07111f]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-8">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-[#07111f] shadow-[0_10px_30px_rgba(251,191,36,0.3)]">
              <Landmark size={20} />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-400">AUREA</p>
              <p className="text-sm text-slate-300">Invest Platform</p>
            </div>
          </button>

          <div className="hidden items-center gap-8 text-sm text-slate-300 md:flex">
            <a href="#solucoes" className="transition-colors hover:text-white">Solucoes</a>
            <a href="#produtos" className="transition-colors hover:text-white">Produtos</a>
            <a href="#seguranca" className="transition-colors hover:text-white">Seguranca</a>
            <a href="#faq" className="transition-colors hover:text-white">FAQ</a>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="hidden rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition-colors hover:border-white/20 hover:text-white md:block"
            >
              Entrar
            </button>
            <a
              href="#planos"
              className="rounded-full bg-gradient-to-r from-amber-300 to-orange-500 px-5 py-2.5 text-sm font-semibold text-[#07111f] transition-transform hover:-translate-y-0.5"
            >
              Abrir conta
            </a>
          </div>
        </div>
      </nav>

      <main>
        <section className="px-4 pb-20 pt-10 md:px-8 md:pb-28 md:pt-16">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                Visao consolidada de patrimonio, risco e oportunidades
              </div>

              <h1 className="mt-8 max-w-4xl text-5xl font-semibold leading-[0.95] tracking-tight text-white md:text-7xl">
                Plataforma de investimento com visual premium e decisao orientada por dados.
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
                Estruture uma experiencia digital para captar investidores, apresentar produtos e acompanhar a carteira com uma narrativa de confianca, sofisticao e resultado.
              </p>

              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <a
                  href="#planos"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-300 to-orange-500 px-7 py-4 text-base font-semibold text-[#07111f] transition-transform hover:-translate-y-0.5"
                >
                  Ver estrutura da plataforma
                  <ArrowRight size={18} />
                </a>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-7 py-4 text-base font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/10"
                >
                  Acessar area interna
                </button>
              </div>

              <div className="mt-14 grid gap-4 sm:grid-cols-3">
                {[
                  ['R$ 184 mi', 'Patrimonio monitorado'],
                  ['+3.200', 'Investidores ativos'],
                  ['94 NPS', 'Satisfacao da jornada'],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
                    <p className="text-3xl font-semibold text-white">{value}</p>
                    <p className="mt-2 text-sm text-slate-400">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-6 top-10 h-40 w-40 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="absolute right-0 top-0 h-44 w-44 rounded-full bg-amber-400/20 blur-3xl" />

              <div className="relative rounded-[36px] border border-white/10 bg-white/8 p-5 shadow-2xl backdrop-blur-xl">
                <div className="rounded-[28px] border border-white/10 bg-[#0b1728] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Painel executivo</p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">Wealth Overview</h3>
                    </div>
                    <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                      Mercado aberto
                    </div>
                  </div>

                  <div className="mt-8 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
                      <p className="text-sm text-slate-400">Rentabilidade acumulada</p>
                      <div className="mt-3 flex items-end gap-2">
                        <span className="text-4xl font-semibold text-white">+17.8%</span>
                        <span className="mb-1 text-sm text-emerald-300">12 meses</span>
                      </div>
                      <div className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
                        <TrendingUp size={16} />
                        acima do benchmark em 4.2 p.p.
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-gradient-to-br from-cyan-400/10 to-transparent p-5">
                      <p className="text-sm text-slate-400">Alocacao recomendada</p>
                      <div className="mt-5 space-y-3">
                        {[
                          ['Renda fixa', '45%'],
                          ['Multimercado', '30%'],
                          ['Internacional', '25%'],
                        ].map(([name, share]) => (
                          <div key={name}>
                            <div className="mb-1 flex items-center justify-between text-sm text-slate-300">
                              <span>{name}</span>
                              <span>{share}</span>
                            </div>
                            <div className="h-2 rounded-full bg-white/10">
                              <div className="h-2 rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width: share }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4">
                    {marketCards.map((card) => (
                      <div key={card.name} className="flex items-center justify-between rounded-[22px] border border-white/10 bg-white/5 p-4">
                        <div>
                          <p className="text-sm text-slate-400">{card.name}</p>
                          <p className="mt-1 text-base font-medium text-white">{card.detail}</p>
                        </div>
                        <div className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-amber-200">
                          {card.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="solucoes" className="px-4 py-20 md:px-8">
          <div className="mx-auto max-w-7xl">
            <SectionTitle
              eyebrow="Solucoes"
              title="Uma narrativa institucional forte para captar confianca antes do primeiro aporte."
              description="A home combina posicionamento, clareza comercial e visual de alta credibilidade. Isso cria base para depois integrar onboarding, simulador, CRM do assessor e area logada."
            />

            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              {pillars.map((pillar) => {
                const Icon = pillar.icon
                return (
                  <article key={pillar.title} className="rounded-[32px] border border-white/10 bg-white/5 p-7 backdrop-blur-sm">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300 to-orange-500 text-[#07111f]">
                      <Icon size={24} />
                    </div>
                    <h3 className="mt-6 text-2xl font-semibold text-white">{pillar.title}</h3>
                    <p className="mt-4 text-base leading-7 text-slate-300">{pillar.description}</p>
                  </article>
                )
              })}
            </div>
          </div>
        </section>

        <section id="produtos" className="px-4 py-20 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-[0.9fr_1.1fr]">
            <SectionTitle
              eyebrow="Produtos"
              title="Estruture ofertas por perfil e conduza o investidor para a carteira certa."
              description="A pagina deixa claro como apresentar trilhas de investimento diferentes sem perder consistencia visual. Isso ajuda conversao, atendimento e educacao financeira."
            />

            <div className="grid gap-5">
              {products.map((product) => (
                <article key={product.title} className="rounded-[30px] border border-white/10 bg-[#0b1728]/90 p-6 shadow-xl">
                  <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">{product.label}</p>
                      <h3 className="mt-3 text-2xl font-semibold text-white">{product.title}</h3>
                      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300">{product.description}</p>
                    </div>
                    <div className="rounded-[24px] border border-emerald-400/20 bg-emerald-400/10 px-5 py-4">
                      <p className="text-sm text-emerald-200">{product.returnLabel}</p>
                      <p className="mt-1 text-2xl font-semibold text-white">{product.returnValue}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="planos" className="px-4 py-20 md:px-8">
          <div className="mx-auto max-w-7xl rounded-[40px] border border-white/10 bg-white/5 p-8 backdrop-blur-xl md:p-12">
            <div className="grid gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Jornada</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                  O site pode vender sofisticacao sem parecer distante.
                </h2>
                <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">
                  A estrutura abaixo foi pensada para plataforma de investimento: entrada institucional, explicacao objetiva da oferta, provas de credibilidade e CTA para abertura de conta.
                </p>

                <div className="mt-8 space-y-4">
                  {steps.map((step, index) => (
                    <div key={step} className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 font-semibold text-[#07111f]">
                        {index + 1}
                      </div>
                      <p className="pt-1 text-base leading-7 text-slate-200">{step}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="rounded-[30px] border border-white/10 bg-[#0b1728] p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
                    <Wallet size={24} />
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold text-white">Onboarding premium</h3>
                  <p className="mt-3 text-base leading-7 text-slate-300">
                    Diagnostico de perfil, captura de objetivo financeiro e recomendacao inicial em poucos passos.
                  </p>
                </div>

                <div className="rounded-[30px] border border-white/10 bg-[#0b1728] p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                    <TrendingUp size={24} />
                  </div>
                  <h3 className="mt-5 text-2xl font-semibold text-white">Painel de performance</h3>
                  <p className="mt-3 text-base leading-7 text-slate-300">
                    Graficos de rentabilidade, comparativos e leitura simples da evolucao patrimonial.
                  </p>
                </div>

                <div className="rounded-[30px] border border-white/10 bg-[#0b1728] p-6 md:col-span-2">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500">CTA principal</p>
                      <h3 className="mt-3 text-2xl font-semibold text-white">Abrir conta e falar com especialista</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/login')}
                      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-amber-300 to-orange-500 px-5 py-3 font-semibold text-[#07111f]"
                    >
                      Entrar agora
                      <ArrowRight size={18} />
                    </button>
                  </div>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">
                    Mantive a navegacao para a area autenticada atual. Se voce quiser, no proximo passo eu conecto essa home com cadastro de investidor, simulador e dashboard financeiro de verdade.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="seguranca" className="px-4 py-20 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <SectionTitle
              eyebrow="Seguranca"
              title="Confianca precisa ser visivel em cada bloco da pagina."
              description="A comunicacao destaca protecao, rastreabilidade e clareza operacional. Isso e especialmente importante para um produto financeiro, onde credibilidade vale tanto quanto design."
            />

            <div className="grid gap-5 md:grid-cols-2">
              {[
                ['Monitoramento 24/7', 'Eventos, acessos e alteracoes relevantes registrados em trilha auditavel.'],
                ['Camadas de permissao', 'Perfis para investidor, assessor e operacao com controles distintos.'],
                ['Compliance-ready', 'Espaco para disclaimers, documentos, politicas e evidencias regulatarias.'],
                ['Relatorio executivo', 'Resumo de carteira, risco e rentabilidade com leitura simples.'],
              ].map(([title, description]) => (
                <article key={title} className="rounded-[30px] border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                  <h3 className="text-xl font-semibold text-white">{title}</h3>
                  <p className="mt-3 text-base leading-7 text-slate-300">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="px-4 py-20 md:px-8">
          <div className="mx-auto max-w-4xl">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">FAQ</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                Perguntas que normalmente aparecem em projetos desse tipo.
              </h2>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-300">
                O foco aqui foi transformar sua home em uma proposta forte de plataforma de investimento. A proxima etapa e alinhar regras de negocio, compliance e operacao real.
              </p>
            </div>

            <div className="mt-12 space-y-4">
              {faqs.map((item, index) => (
                <FAQItem
                  key={item.question}
                  item={item}
                  open={openFaq === index}
                  onToggle={() => setOpenFaq(openFaq === index ? null : index)}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-24 pt-6 md:px-8">
          <div className="mx-auto max-w-7xl rounded-[40px] border border-amber-300/20 bg-gradient-to-br from-amber-300/10 via-white/5 to-cyan-400/10 p-8 md:p-12">
            <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-amber-300">Proximo passo</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                  A base visual da sua plataforma de investimento ja pode nascer com cara de produto premium.
                </h2>
                <p className="mt-5 text-base leading-8 text-slate-300">
                  A home foi reposicionada para o nicho financeiro. Se voce quiser continuar, eu posso transformar o restante do sistema em uma plataforma coerente com esse mercado.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href="#solucoes"
                  className="inline-flex items-center justify-center rounded-full border border-white/10 px-6 py-3.5 font-semibold text-white transition-colors hover:border-white/20 hover:bg-white/10"
                >
                  Revisar secoes
                </a>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-amber-300 to-orange-500 px-6 py-3.5 font-semibold text-[#07111f]"
                >
                  Continuar no sistema
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
