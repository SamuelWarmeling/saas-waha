export default function Stats({ title, value, sub, icon: Icon, color = 'green' }) {
  const colors = {
    primary: 'bg-primary-900/30 text-primary-400 border border-primary-500/20 shadow-[0_0_15px_theme(colors.primary.900/20)]',
    green: 'bg-primary-900/30 text-primary-400 border border-primary-500/20 shadow-[0_0_15px_theme(colors.primary.900/20)]',
    blue: 'bg-blue-900/30 text-blue-400 border border-blue-500/20 shadow-[0_0_15px_theme(colors.blue.900/20)]',
    yellow: 'bg-amber-900/30 text-amber-400 border border-amber-500/20 shadow-[0_0_15px_theme(colors.amber.900/20)]',
    purple: 'bg-primary-900/30 text-primary-400 border border-primary-500/20 shadow-[0_0_15px_theme(colors.primary.900/20)]',
    red: 'bg-red-900/30 text-red-400 border border-red-500/20 shadow-[0_0_15px_theme(colors.red.900/20)]',
  }

  return (
    <div className="glass-card flex items-start gap-4">
      <div className={`p-3.5 rounded-2xl ${colors[color] || colors.primary} flex items-center justify-center`}>
        <Icon className="text-2xl" />
      </div>
      <div className="flex-1 min-w-0 py-1">
        <p className="text-sm font-medium text-surface-400 truncate tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-surface-50 mt-1 tracking-tight">{value ?? '–'}</p>
        {sub && <p className="text-xs font-medium text-surface-500 mt-1.5">{sub}</p>}
      </div>
    </div>
  )
}
