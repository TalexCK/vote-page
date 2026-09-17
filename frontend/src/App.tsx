import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Loader2, LogOut } from 'lucide-react'
import { api, ApiError, type User } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Login } from '@/components/login'
import { PollPage } from '@/components/poll-page'
import { Management } from '@/components/management'

export default function App() {
  const management = window.location.pathname.replace(/\/+$/, '') === '/management'
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const unauthorized = useCallback(() => { setUser(null); setError('') }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    api<User>('/me', { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setUser(value) }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) setUser(null)
      else setError(error instanceof Error ? error.message : '加载失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])
  async function logout() {
    setLoggingOut(true)
    setError('')
    try { await api('/logout', { method: 'POST' }); setUser(null) }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null)
      else setError(error instanceof Error ? error.message : '退出失败')
    } finally { setLoggingOut(false) }
  }
  return <div className="flex min-h-svh flex-col">
    <a href="#main-content" className="sr-only z-50 bg-background p-3 focus:not-sr-only focus:fixed">跳至内容</a>
    <header className="border-b">
      <div className="mx-auto flex min-h-20 max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <a href="/" aria-label="投票首页" className="flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span aria-hidden="true" className="grid size-8 grid-cols-2 gap-1 bg-foreground p-2"><span className="bg-background" /><span className="bg-background" /><span className="bg-background" /><span className="border border-background" /></span><span className="text-sm font-semibold tracking-[0.2em]">投票</span></a>
        {user && <nav className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-5" aria-label="用户导航"><span className="max-w-40 truncate font-mono text-xs" title={user.minecraft_id}>{user.minecraft_id}</span>{management ? <Button asChild variant="ghost" size="sm"><a href="/"><ArrowLeft />投票</a></Button> : user.is_admin && <Button asChild variant="ghost" size="sm"><a href="/management">管理<ArrowUpRight /></a></Button>}<Button variant="ghost" size="sm" onClick={() => void logout()} disabled={loggingOut} aria-label="退出登录"><LogOut /><span className="hidden sm:inline">退出</span></Button></nav>}
      </div>
    </header>
    <div id="main-content" className="flex flex-1 flex-col" tabIndex={-1}>
      {error && <div role="alert" className="mx-auto mt-8 flex w-full max-w-3xl items-center justify-between gap-4 px-6 text-sm"><span>{error}</span>{!user && <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>重试</Button>}</div>}
      {loading ? <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20"><p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载中</p></main> : !user ? !error && <Login onLogin={setUser} /> : management && !user.is_admin ? <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20"><h1 className="mb-6 font-display text-3xl">仅管理员可访问</h1><Button asChild variant="outline"><a href="/">返回投票<ArrowUpRight /></a></Button></main> : management ? <Management onUnauthorized={unauthorized} /> : <PollPage onUnauthorized={unauthorized} />}
    </div>
  </div>
}
