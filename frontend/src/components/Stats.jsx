export default function Stats({ title, value, sub, icon: Icon, color = 'green' }) {
  const iconColors = {
    primary: { bg: 'rgba(34,211,238,0.12)', color: '#22D3EE' },
    green:   { bg: 'rgba(34,211,238,0.12)', color: '#22D3EE' },
    blue:    { bg: 'rgba(59,130,246,0.12)',  color: '#60a5fa' },
    yellow:  { bg: 'rgba(245,158,11,0.12)',  color: '#fbbf24' },
    purple:  { bg: 'rgba(34,211,238,0.12)', color: '#22D3EE' },
    red:     { bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
  }

  const ic = iconColors[color] || iconColors.primary

  return (
    <div className="glass-card flex items-start gap-4">
      <div
        className="p-3.5 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: ic.bg, color: ic.color }}
      >
        <Icon className="text-2xl" />
      </div>
      <div className="flex-1 min-w-0 py-1">
        <p className="text-sm text-surface-400 truncate">{title}</p>
        <p className="text-3xl font-bold text-surface-50 mt-1 tracking-tight">{value ?? '–'}</p>
        {sub && <p className="text-xs font-medium text-surface-500 mt-1.5">{sub}</p>}
      </div>
    </div>
  )
}
