/**
 * Converte qualquer valor em array de forma segura.
 * Uso: safeArray(response.data).map(...)
 */
export function safeArray(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.items))   return data.items
  if (data && Array.isArray(data.results)) return data.results
  if (data && Array.isArray(data.data))    return data.data
  return []
}
