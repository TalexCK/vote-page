import { useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { api, ApiError, type Poll, type Results as ResultsData } from '@/lib/api'
import { Button } from './ui/button'
import { Results } from './results'
import { VoteForm } from './vote-form'
import { PollEditor } from './poll-editor'

function date(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed)
}

export function PollPage({ management, onUnauthorized }: { management: boolean; onUnauthorized: () => void }) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [results, setResults] = useState<ResultsData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const activeRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    activeRequest.current = controller
    let running = false
    async function refresh() {
      if (running || controller.signal.aborted) return
      running = true
      try {
        const nextPoll = await api<Poll | null>('/poll', { signal: controller.signal })
        if (controller.signal.aborted) return
        setPoll(nextPoll)
        setResults(previous => previous?.id === nextPoll?.id ? previous : null)
        if (nextPoll && (management || nextPoll.status === 'ended')) {
          const nextResults = await api<ResultsData>('/results', { signal: controller.signal })
          if (controller.signal.aborted) return
          if (nextResults.id === nextPoll.id) setResults(nextResults)
        } else setResults(null)
        setError('')
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) onUnauthorized()
        else {
          if (error instanceof ApiError && error.status === 403) setResults(null)
          setError(error instanceof Error ? error.message : '加载失败')
        }
      } finally {
        running = false
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void refresh()
    const interval = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh() }, 10000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => { controller.abort(); window.clearInterval(interval); window.removeEventListener('focus', onVisible); document.removeEventListener('visibilitychange', onVisible) }
  }, [management, onUnauthorized, revision])

  const showResults = management || poll?.status === 'ended'
  const refresh = () => { activeRequest.current?.abort(); setRevision(value => value + 1) }
  const published = () => { setPoll(null); setResults(null); setLoading(true); refresh() }
  return <main className="page-enter mx-auto w-full max-w-3xl flex-1 px-6 pb-12 pt-12 sm:pt-20">
    {management && <PollEditor onPublished={published} onUnauthorized={onUnauthorized} />}
    {!loading && !poll && !error && <p role="status" className="py-10 text-sm text-muted-foreground">暂无投票</p>}
    {loading && !poll ? <div className="flex items-center gap-3 py-12 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />加载中</div> : null}
    {poll && <>
      <div className="mb-10 sm:mb-14">
        <div className="mb-6 flex items-center justify-between gap-4"><p className="eyebrow">{management ? '管理 / 当前结果' : showResults ? '投票结果' : '投票'}</p><span className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs"><span className={`size-1.5 rounded-full ${poll.status === 'open' ? 'bg-foreground' : 'bg-neutral-400'}`} />{{ pending: '未开始', open: '进行中', ended: '已结束' }[poll.status]}</span></div>
        <h1 className="break-words font-display text-4xl leading-snug tracking-tight sm:text-5xl">{poll.title}</h1>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground"><p>开始 <time dateTime={poll.starts_at} className="ml-2 font-mono">{date(poll.starts_at)}</time></p><p>结束 <time dateTime={poll.ends_at} className="ml-2 font-mono">{date(poll.ends_at)}</time></p></div>
      </div>
    </>}
    {error && <div role="alert" className="mb-8 flex items-center justify-between gap-4 border-y py-4"><p className="text-sm">{error}</p><Button variant="ghost" size="sm" onClick={refresh}><RefreshCw />重试</Button></div>}
    {poll && (showResults ? results && results.id === poll.id ? <Results key={poll.id} results={results} /> : !error && <p role="status" className="border-t py-10 text-sm text-muted-foreground">正在加载结果</p> : <VoteForm key={poll.id} poll={poll} onRefresh={refresh} onUnauthorized={onUnauthorized} />)}
  </main>
}
