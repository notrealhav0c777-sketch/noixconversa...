export async function api(action, body) {
  try {
    const r = await fetch('/api/room', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return { data: null, error: { message: j.error || 'SERVER' } }
    return { data: j, error: null }
  } catch { return { data: null, error: { message: 'NETWORK' } } }
}
