import { Redis } from '@upstash/redis'
import { randomInt } from 'node:crypto'

const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
const redis = URL && TOKEN ? new Redis({ url: URL, token: TOKEN }) : null
const TTL = 86400      // salas inativas expiram em 24h
const STALE = 30000    // participante sem sinal por 30s libera a vaga
const MAX_LIMIT = 50
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const J = (v) => (typeof v === 'string' ? JSON.parse(v) : v)
class E extends Error {}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD' })
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    res.status(200).json(await run(b))
  } catch (e) {
    res.status(e instanceof E ? 400 : 500).json({ error: e instanceof E ? e.message : 'SERVER' })
  }
}

async function run(b) {
  if (!redis) throw new E('NO_DB')
  if (b.action === 'create') {
    const max = Math.floor(+b.max)
    if (!(max >= 2 && max <= MAX_LIMIT)) throw new E('INVALID_LIMIT')
    for (let i = 0; i < 8; i++) {
      const code = Array.from({ length: 6 }, () => ALPH[randomInt(ALPH.length)]).join('')
      if (await redis.set('room:' + code, JSON.stringify({ max }), { nx: true, ex: TTL })) return { code }
    }
    throw new Error('code')
  }

  const code = String(b.code || '').toUpperCase().trim()
  const id = String(b.id || '').slice(0, 64)
  const room = await redis.get('room:' + code)
  if (!room) throw new E('ROOM_NOT_FOUND')
  const { max } = J(room)
  const mem = 'mem:' + code, av = 'av:' + code, msgs = 'msgs:' + code

  if (b.action === 'join') {
    const name = String(b.name || '').trim().slice(0, 24)
    if (!name || !id) throw new E('BAD')
    const all = (await redis.hgetall(mem)) || {}
    const now = Date.now()
    const stale = []
    let n = 0
    for (const [k, v] of Object.entries(all)) {
      if (k === id) continue
      if (now - J(v).seen > STALE) stale.push(k); else n++
    }
    if (stale.length) { await redis.hdel(mem, ...stale); await redis.hdel(av, ...stale) }
    if (!(id in all) && n >= max) throw new E('ROOM_FULL')
    const pic = typeof b.avatar === 'string' && b.avatar.startsWith('data:image/') && b.avatar.length < 60000 ? b.avatar : ''
    const p = redis.pipeline()
    p.hset(mem, { [id]: JSON.stringify({ name, seen: now, av: !!pic }) })
    if (pic) p.hset(av, { [id]: pic }); else p.hdel(av, id)
    p.expire(mem, TTL); p.expire('room:' + code, TTL)
    await p.exec()
    return { code, max }
  }

  if (b.action === 'poll') {
    const since = Math.max(0, +b.since || 0)
    const p = redis.pipeline()
    p.hgetall(mem)
    p.zrange(msgs, since + 1, '+inf', { byScore: true })
    const [all, ms] = await p.exec()
    if (!all || !all[id]) throw new E('NOT_MEMBER')
    const now = Date.now()
    await redis.hset(mem, { [id]: JSON.stringify({ ...J(all[id]), seen: now }) })
    const members = Object.entries(all)
      .map(([k, v]) => ({ id: k, ...J(v) }))
      .filter((m) => now - m.seen < STALE || m.id === id)
      .map(({ id, name, av }) => ({ id, name, hasAvatar: !!av }))
    return { members, msgs: (ms || []).map(J), max }
  }

  if (b.action === 'avatars') {
    const ids = (Array.isArray(b.ids) ? b.ids : []).slice(0, 60).map(String)
    if (!ids.length) return { avatars: {} }
    return { avatars: (await redis.hmget(av, ...ids)) || {} }
  }

  if (b.action === 'send') {
    const m = await redis.hget(mem, id)
    if (!m) throw new E('NOT_MEMBER')
    const body = String(b.body || '').trim().slice(0, 2000)
    if (!body) throw new E('BAD')
    const mid = await redis.incr('mid:' + code)
    const msg = { id: mid, member_id: id, name: J(m).name, body, created_at: new Date().toISOString() }
    const p = redis.pipeline()
    p.zadd(msgs, { score: mid, member: JSON.stringify(msg) })
    p.zremrangebyrank(msgs, 0, -201)
    p.expire(msgs, TTL); p.expire('mid:' + code, TTL)
    await p.exec()
    return { msg }
  }

  if (b.action === 'leave') {
    await redis.hdel(mem, id); await redis.hdel(av, id)
    return { ok: true }
  }
  throw new E('BAD')
}
