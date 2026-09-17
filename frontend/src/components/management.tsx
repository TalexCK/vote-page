import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Results as ResultsData } from '@/lib/api'
import { PollEditor, type PollConfig } from './poll-editor'
import { Results } from './results'
import { Button } from './ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog'

interface PollSummary { id: string; title: string; starts_at: string; ends_at: string; question_count: number; ballot_count: number }
interface Inventory { active_poll_id: string | null; polls: PollSummary[] }
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export function Management({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [editor, setEditor] = useState<{ config?: PollConfig; key: number } | null>(null)
  const [results, setResults] = useState<ResultsData | null>(null)
  const [deleting, setDeleting] = useState<PollSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    api<Inventory>('/management/polls', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setInventory(data) }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setError(error instanceof Error ? error.message : '加载失败')
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); request.current = null } })
    return () => { controller.abort(); request.current?.abort() }
  }, [onUnauthorized, revision])

  async function action(work: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setNotice('')
    try { await work(controller.signal) } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setError(error instanceof Error ? error.message : '操作失败，请重试')
    } finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  return <main className="page-enter mx-auto w-full max-w-5xl flex-1 px-6 pb-16 pt-12 sm:pt-20">
    <header className="mb-8 border-b pb-6"><h1 className="text-3xl font-semibold">投票管理</h1></header>
    {loading && <p role="status" className="py-8 text-sm text-muted-foreground">加载中…</p>}
    {error && <div className="my-5 flex flex-wrap items-center gap-3 border-l-2 border-foreground pl-4"><p role="alert" className="text-sm">{error}</p><Button variant="ghost" size="sm" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>重新加载</Button></div>}
    {notice && <p role="status" className="mb-5 text-sm">{notice}</p>}
    {inventory && <>
      <section className="mb-12 grid gap-5 sm:grid-cols-[1fr_2fr]" aria-labelledby="homepage-heading">
        <h2 id="homepage-heading" className="text-lg font-medium">首页投票</h2>
        <div><select aria-labelledby="homepage-heading" disabled={busy || loading} value={inventory.active_poll_id ?? ''} className="block w-full rounded-sm border bg-background px-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onChange={event => { const poll_id = event.target.value || null; void action(async signal => {
          await api('/management/active-poll', { method: 'POST', body: JSON.stringify({ poll_id }), signal })
          if (!signal.aborted) { setInventory(previous => previous ? { ...previous, active_poll_id: poll_id } : previous); setNotice(poll_id ? '首页投票已更新' : '已停用首页投票') }
        }) }}><option value="">不展示投票</option>{inventory.polls.map(poll => <option key={poll.id} value={poll.id}>{poll.title}</option>)}</select></div>
      </section>
      <section aria-labelledby="archive-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-4"><h2 id="archive-heading" className="text-lg font-medium">投票列表 <span className="ml-2 font-mono text-xs text-muted-foreground">{String(inventory.polls.length).padStart(2, '0')}</span></h2><Button disabled={busy || loading || !!editor} onClick={() => { setEditor({ key: Date.now() }); setResults(null) }}>＋ 新建投票</Button></div>
        <div className="divide-y border-y">{inventory.polls.map((poll, index) => <article key={poll.id} className="flex flex-wrap items-center justify-between gap-5 py-6"><div className="flex min-w-0 gap-4"><span className="pt-1 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><div className="min-w-0"><h3 className="break-words text-base font-medium">{poll.title}{inventory.active_poll_id === poll.id && <span className="ml-3 inline-block border px-2 py-0.5 align-middle text-[10px] font-normal tracking-wider">首页展示</span>}</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">{date(poll.starts_at)} — {date(poll.ends_at)}</p><p className="mt-1 text-xs text-muted-foreground">{poll.question_count} 道题目 <span className="mx-2">/</span> {poll.ballot_count} 份选票</p></div></div>
          <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy || loading || !!editor} aria-label={`查看${poll.title}结果`} onClick={() => void action(async signal => { const data = await api<ResultsData>(`/management/results?poll_id=${encodeURIComponent(poll.id)}`, { signal }); if (!signal.aborted) setResults(data) })}>查看结果 ↗</Button><Button variant="outline" size="sm" disabled={busy || loading || !!editor} aria-label={`复制${poll.title}`} onClick={() => void action(async signal => { const config = await api<PollConfig>(`/management/poll?poll_id=${encodeURIComponent(poll.id)}`, { signal }); if (!signal.aborted) { setEditor({ config, key: Date.now() }); setResults(null) } })}>复制新建</Button><Button variant="ghost" size="sm" disabled={busy || loading || !!editor} aria-label={`删除${poll.title}`} onClick={() => { setError(''); setDeleting(poll) }}>删除</Button></div>
        </article>)}{!inventory.polls.length && <p className="py-12 text-center text-sm text-muted-foreground">暂无投票</p>}</div>
      </section>
    </>}
    {busy && <p role="status" className="mt-4 text-xs text-muted-foreground">正在处理…</p>}
    {editor && <PollEditor key={editor.key} initialConfig={editor.config} onUnauthorized={onUnauthorized} onCancel={() => setEditor(null)} onPublished={() => { setEditor(null); setNotice('已创建，请在顶部选择首页投票。'); setRevision(value => value + 1) }} />}
    {results && <section className="mt-12" aria-labelledby="results-heading"><div className="mb-6 flex items-center justify-between gap-4"><div><p className="mb-2 text-xs text-muted-foreground">投票结果</p><h2 id="results-heading" className="text-2xl font-medium">{results.title}</h2></div><Button variant="ghost" size="sm" onClick={() => setResults(null)}>收起结果</Button></div><Results key={results.id} results={results} /></section>}
    <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !busy) setDeleting(null) }}>
      <AlertDialogContent>
        <AlertDialogTitle>删除「{deleting?.title}」？</AlertDialogTitle>
        <AlertDialogDescription>投票及其全部选票将永久删除，无法恢复。{deleting?.id === inventory?.active_poll_id ? '首页将停止展示此投票。' : ''}</AlertDialogDescription>
        {error && <p role="alert" className="text-sm">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={event => {
            event.preventDefault()
            if (!deleting) return
            const id = deleting.id
            void action(async signal => {
              await api('/management/delete-poll', { method: 'POST', body: JSON.stringify({ poll_id: id }), signal })
              if (signal.aborted) return
              setInventory(previous => previous ? { ...previous, active_poll_id: previous.active_poll_id === id ? null : previous.active_poll_id, polls: previous.polls.filter(poll => poll.id !== id) } : previous)
              setResults(previous => previous?.id === id ? null : previous)
              setDeleting(null)
              setNotice('已删除投票')
            })
          }}>{busy ? '删除中…' : '确认删除'}</AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </main>
}
