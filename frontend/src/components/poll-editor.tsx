import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { Button } from './ui/button'

export function PollEditor({ onPublished, onUnauthorized }: { onPublished: () => void; onUnauthorized: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [revision, setRevision] = useState(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    api<Record<string, unknown> | null>('/management/poll', { signal: controller.signal }).then(config => {
      if (!controller.signal.aborted) setText(config ? JSON.stringify(config, null, 2) : '')
    }).catch(error => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setError(error instanceof Error ? error.message : '加载失败')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [onUnauthorized, revision])

  async function publish() {
    if (busy || loading) return
    setError('')
    setSuccess(false)
    let config: unknown
    try {
      config = JSON.parse(text)
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error()
    } catch { setError('请输入有效的 JSON 对象'); return }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      await api('/management/poll', { method: 'POST', body: JSON.stringify({ config }), signal: controller.signal })
      if (controller.signal.aborted) return
      setSuccess(true)
      onPublished()
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else setError(error instanceof ApiError && error.status === 409 ? '投票 ID 已使用，请更换 ID' : error instanceof Error ? error.message : '发布失败')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="mb-12 border-b pb-10" aria-labelledby="poll-config-label">
    <form onSubmit={event => { event.preventDefault(); void publish() }}>
      <label id="poll-config-label" htmlFor="poll-config" className="mb-3 block text-sm font-medium">投票 JSON</label>
      <textarea id="poll-config" value={text} onChange={event => { setText(event.target.value); setSuccess(false) }} disabled={loading || busy} spellCheck={false} rows={12} className="w-full resize-y rounded-sm border bg-background p-4 font-mono text-xs leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4"><p className="text-xs text-muted-foreground">新投票须使用不同 ID</p><Button type="submit" disabled={loading || busy || !text.trim()}>{loading ? '加载中' : busy ? '发布中' : '发布投票'}</Button></div>
      {error && <div className="mt-4 flex items-center gap-4"><p role="alert" className="text-sm">{error}</p><Button type="button" variant="ghost" size="sm" disabled={busy || loading} onClick={() => setRevision(value => value + 1)}>重新加载配置</Button></div>}
      {success && <p role="status" className="mt-4 text-sm">已发布</p>}
    </form>
  </section>
}
