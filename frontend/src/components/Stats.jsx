export default function Stats({ title, value, sub, icon: Icon, color = 'green' }) {
  const colors = {
    green:  'bg-green-900/30 text-green-400',
    blue:   'bg-blue-900/30 text-blue-400',
    yellow: 'bg-yellow-900/30 text-yellow-400',
    purple: 'bg-purple-900/30 text-purple-400',
    red:    'bg-red-900/30 text-red-400',
  }

  return (
    <div className="card flex items-start gap-4">
      <div className={`p-3 rounded-xl ${colors[color]}`}>
        <Icon className="text-2xl" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 truncate">{title}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value ?? '–'}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  )
}
