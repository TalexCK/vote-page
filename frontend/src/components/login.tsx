import { useState, type FormEvent } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { api, type User } from '@/lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const user = await api<User>('/login', { method: 'POST', body: JSON.stringify({ minecraft_id: id.trim(), secret }) })
      onLogin(user)
    } catch (error) { setError(error instanceof Error ? error.message : '登录失败') }
    finally { setBusy(false) }
  }
  return <main className="page-enter mx-auto grid w-full max-w-5xl flex-1 items-center px-6 py-16 md:grid-cols-2 md:gap-24 md:py-28">
    <div className="mb-12 self-start md:mb-0 md:pt-3">
      <div className="mb-8 h-1 w-10 bg-foreground" />
      <h1 className="font-display text-5xl leading-tight tracking-tight md:text-6xl">登录</h1>
    </div>
    <form onSubmit={submit} className="w-full max-w-sm space-y-6 self-start" aria-label="登录">
      <div className="space-y-2.5"><label htmlFor="minecraft-id" className="text-sm">MUA Minecraft ID</label><Input id="minecraft-id" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={id} onChange={event => setId(event.target.value)} disabled={busy} className="font-mono" /></div>
      <div className="space-y-2.5"><label htmlFor="secret" className="text-sm">Secret</label><Input id="secret" name="password" type="password" autoComplete="current-password" required value={secret} onChange={event => setSecret(event.target.value)} disabled={busy} /></div>
      {error && <p role="alert" className="border-l-2 border-foreground pl-3 text-sm">{error}</p>}
      <Button type="submit" disabled={busy || !id.trim() || !secret} className="!mt-9 w-full justify-between">{busy ? '登录中' : '登录'}{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}</Button>
    </form>
  </main>
}
