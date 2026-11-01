import { useEffect, useRef, useState } from 'react'
import { api } from './api'

const MIN = +import.meta.env.VITE_MIN_PEOPLE || 2
const MAX = +import.meta.env.VITE_MAX_PEOPLE || 50
const MAX_FILE = 5 * 1024 * 1024
const TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ERR = {
  ROOM_NOT_FOUND: 'Sala não encontrada. Confira o código.',
  ROOM_FULL: 'Esta sala já atingiu o limite de participantes.',
  INVALID_LIMIT: `O limite deve ficar entre ${MIN} e ${MAX} pessoas.`,
  NOT_MEMBER: 'Você não faz mais parte desta sala.',
  NO_DB: 'O banco de dados (Upstash Redis) ainda não foi conectado ao projeto na Vercel.',
  NETWORK: 'Sem conexão com o servidor.',
}
const errText = (e) => {
  const m = e?.message || ''
  for (const k in ERR) if (m.includes(k)) return ERR[k]
  return 'Algo deu errado. Verifique sua conexão e tente novamente.'
}
const load = () => { try { return JSON.parse(localStorage.getItem('nc') || '{}') } catch { return {} } }
const save = (p) => localStorage.setItem('nc', JSON.stringify(p))

// Recorte "cover": preenche o tamanho alvo sem deformar a imagem
function cover(img, w, h, q = 0.85) {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const s = Math.max(w / img.width, h / img.height)
  const dw = img.width * s, dh = img.height * s
  c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  return c.toDataURL('image/jpeg', q)
}

function Avatar({ src, name, size = 36 }) {
  return src
    ? <img className="avatar" style={{ width: size, height: size }} src={src} alt="" />
    : <span className="avatar ph" style={{ width: size, height: size, fontSize: size * 0.42 }}>{(name || '?')[0].toUpperCase()}</span>
}

export default function App() {
  const [profile, setProfile] = useState(() => {
    const p = load(); return { id: p.id || crypto.randomUUID(), name: p.name || '', avatar: p.avatar || '' }
  })
  const [view, setView] = useState('home')
  const [room, setRoom] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => save(profile), [profile])


  async function enter(code) {
    if (!profile.name.trim()) { setView('home'); return setError('Defina um nome ou apelido antes de continuar.') }
    setBusy(true); setError('')
    const { data, error } = await api('join', { code, id: profile.id, name: profile.name, avatar: profile.avatar || '' })
    setBusy(false)
    if (error) { setView('home'); return setError(errText(error)) }
    setRoom(data); setView('room')
  }
  async function leave() {
    await api('leave', { code: room.code, id: profile.id }); setRoom(null); setView('home')
  }

  if (view === 'room' && room) return <Room room={room} me={profile} onLeave={leave} />
  return (
    <main className="home">
      <header className="brand"><img src="/logo.png" alt="NoixConversa" /><h1>NoixConversa</h1></header>
      <p className="sub">Salas privadas, entrada por código.</p>
      <ProfileCard profile={profile} setProfile={setProfile} />
      {error && <div className="error" role="alert">{error}</div>}
      <div className="actions">
        <section className="panel">
          <h2>Criar sala</h2>
          <p>Defina o limite de pessoas e receba um código para compartilhar.</p>
          <button className="btn primary" onClick={() => {
            if (!profile.name.trim()) return setError('Defina um nome ou apelido antes de criar uma sala.')
            setError(''); setView('create')
          }}>Criar sala</button>
        </section>
        <JoinPanel busy={busy} onJoin={enter} />
      </div>
      {view === 'create' && <CreateModal onClose={() => setView('home')} onCreated={enter} />}
    </main>
  )
}

function ProfileCard({ profile, setProfile }) {
  const [pending, setPending] = useState(null)
  const [err, setErr] = useState('')
  const input = useRef()
  function pick(e) {
    const f = e.target.files[0]; e.target.value = ''
    if (!f) return
    if (!TYPES.includes(f.type)) return setErr('Use uma imagem JPG, JPEG, PNG ou WebP.')
    if (f.size > MAX_FILE) return setErr('A imagem deve ter no máximo 5 MB.')
    setErr('')
    const img = new Image()
    img.onload = () => {
      setPending({ preview: cover(img, 1350, 1028, 0.8), thumb: cover(img, 128, 128, 0.7) })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => setErr('Não foi possível ler essa imagem.')
    img.src = URL.createObjectURL(f)
  }
  return (
    <section className="panel profile">
      <button className="avatar-btn" onClick={() => input.current.click()} aria-label="Escolher foto">
        <Avatar src={profile.avatar} name={profile.name} size={64} />
      </button>
      <div className="grow">
        <label htmlFor="nick">Seu nome ou apelido</label>
        <input id="nick" maxLength={24} value={profile.name} placeholder="Como você quer aparecer"
          onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        <div className="row small">
          <button className="link" onClick={() => input.current.click()}>{profile.avatar ? 'Trocar foto' : 'Adicionar foto'}</button>
          {profile.avatar && <button className="link danger" onClick={() => setProfile({ ...profile, avatar: '' })}>Remover</button>}
        </div>
        {err && <div className="hint err">{err}</div>}
      </div>
      <input ref={input} type="file" accept=".jpg,.jpeg,.png,.webp" hidden onChange={pick} />
      {pending && (
        <div className="overlay" onClick={() => setPending(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Prévia da foto</h2>
            <img className="preview" src={pending.preview} alt="Prévia" />
            <p className="hint">Recorte automático a partir de 1350 × 1028 px.</p>
            <div className="row end">
              <button className="btn ghost" onClick={() => setPending(null)}>Cancelar</button>
              <button className="btn primary" onClick={() => { setProfile({ ...profile, avatar: pending.thumb }); setPending(null) }}>Usar foto</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function JoinPanel({ onJoin, busy }) {
  const [code, setCode] = useState('')
  return (
    <section className="panel">
      <h2>Entrar em uma sala</h2>
      <p>Digite o código que você recebeu.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); code.trim() && onJoin(code) }}>
        <input className="code" maxLength={6} value={code} placeholder="CÓDIGO"
          onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Código da sala" />
        <button className="btn primary" disabled={busy || code.trim().length < 6}>Entrar</button>
      </form>
    </section>
  )
}

function CreateModal({ onClose, onCreated }) {
  const [n, setN] = useState(10)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function create(e) {
    e.preventDefault()
    if (!Number.isInteger(+n) || n < MIN || n > MAX) return setErr(`Informe um número inteiro entre ${MIN} e ${MAX}.`)
    setBusy(true)
    const { data, error } = await api('create', { max: +n })
    setBusy(false)
    if (error) return setErr(errText(error))
    onCreated(data.code)
  }
  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={create}>
        <h2>Nova sala</h2>
        <label htmlFor="max">Quantas pessoas poderão participar desta sala?</label>
        <input id="max" type="number" min={MIN} max={MAX} value={n} onChange={(e) => setN(e.target.value)} />
        <div className="hint">Mínimo {MIN}, máximo {MAX}.</div>
        {err && <div className="error">{err}</div>}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>Gerar código</button>
        </div>
      </form>
    </div>
  )
}

function Room({ room, me, onLeave }) {
  const [members, setMembers] = useState([])
  const [avatars, setAvatars] = useState({})
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [side, setSide] = useState(false)
  const end = useRef()
  const since = useRef(0)
  const asked = useRef(new Set())
  const code = room.code

  const merge = (list) => setMsgs((cur) => {
    const ids = new Set(cur.map((x) => x.id))
    const add = list.filter((x) => !ids.has(x.id))
    return add.length ? [...cur, ...add].sort((a, b) => a.id - b.id) : cur
  })

  useEffect(() => {
    let stop = false, timer
    const tick = async () => {
      const { data, error } = await api('poll', { code, id: me.id, since: since.current })
      if (stop) return
      if (error) {
        if (error.message === 'NOT_MEMBER') {
          const r = await api('join', { code, id: me.id, name: me.name, avatar: me.avatar || '' })
          if (r.error) setErr(errText(r.error))
        }
      } else {
        setErr('')
        setMembers(data.members)
        if (data.msgs.length) { since.current = data.msgs[data.msgs.length - 1].id; merge(data.msgs) }
        const need = data.members.filter((m) => m.hasAvatar && !asked.current.has(m.id)).map((m) => m.id)
        if (need.length) {
          need.forEach((i) => asked.current.add(i))
          api('avatars', { code, ids: need }).then((r) => r.data && setAvatars((a) => ({ ...a, ...r.data.avatars })))
        }
      }
      timer = setTimeout(tick, document.hidden ? 6000 : 2000)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [code])
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [msgs])

  async function send(e) {
    e.preventDefault()
    const body = text.trim(); if (!body) return
    setText('')
    const { data, error } = await api('send', { code, id: me.id, body })
    if (error) { setErr(errText(error)); setText(body) } else { setErr(''); merge([data.msg]) }
  }
  const copy = () => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  return (
    <div className="room">
      <aside className={'side' + (side ? ' open' : '')}>
        <div className="side-head"><img src="/logo.png" alt="" /><b>NoixConversa</b></div>
        <div className="side-title">Participantes · {members.length}/{room.max}</div>
        <ul>{members.map((m) => (
          <li key={m.id}><Avatar src={avatars[m.id]} name={m.name} size={32} /><span>{m.name}{m.id === me.id && ' (você)'}</span></li>
        ))}</ul>
        <button className="btn ghost" onClick={onLeave}>Sair da sala</button>
      </aside>
      <section className="chat">
        <header className="chat-head">
          <button className="icon menu" onClick={() => setSide(!side)} aria-label="Participantes">☰</button>
          <div className="grow"><b>Sala</b> <span className="codechip">{code}</span></div>
          <button className="btn small ghost" onClick={copy}>{copied ? 'Copiado' : 'Copiar código'}</button>
        </header>
        <div className="feed" onClick={() => setSide(false)}>
          {msgs.length === 0 && <div className="empty">Compartilhe o código <b>{code}</b> para convidar pessoas.</div>}
          {msgs.map((m, i) => {
            const mine = m.member_id === me.id
            const first = msgs[i - 1]?.member_id !== m.member_id
            return (
              <div key={m.id} className={'msg' + (mine ? ' mine' : '')}>
                {!mine && (first ? <Avatar src={avatars[m.member_id]} name={m.name} size={34} /> : <span style={{ width: 34 }} />)}
                <div className="bubble">
                  {!mine && first && <div className="who">{m.name}</div>}
                  <span>{m.body}</span>
                  <time>{new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
              </div>
            )
          })}
          <div ref={end} />
        </div>
        {err && <div className="error bar">{err}</div>}
        <form className="composer" onSubmit={send}>
          <input value={text} maxLength={2000} placeholder="Escreva uma mensagem" onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" disabled={!text.trim()}>Enviar</button>
        </form>
      </section>
    </div>
  )
}
