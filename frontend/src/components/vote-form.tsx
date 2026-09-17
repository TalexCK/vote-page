import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Loader2 } from 'lucide-react'
import { api, ApiError, validAnswers, type Answers, type Poll, type VoteResponse } from '@/lib/api'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog'
import { QuestionHeading } from './question-heading'

export function VoteForm({ poll, onRefresh, onUnauthorized }: { poll: Poll; onRefresh: () => void; onUnauthorized: () => void }) {
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const [answers, setAnswers] = useState<Answers>(poll.answers)
  // Keep a successful submission locked even before the next poll response arrives.
  const [receipt, setReceipt] = useState<(VoteResponse & { answers: Answers }) | null>(null)
  const awaitingPoll = receipt !== null && (!poll.submitted_at || Date.parse(poll.submitted_at) < Date.parse(receipt.submitted_at))
  const saved = awaitingPoll ? receipt : poll
  const done = awaitingPoll || poll.submitted
  const canEdit = done && !awaitingPoll && poll.can_edit && poll.status === 'open'
  const [editingAt, setEditingAt] = useState<string | null>(null)
  const editing = canEdit && editingAt !== null && editingAt === saved.submitted_at
  const [blockedPoll, setBlockedPoll] = useState<Poll | null>(null)
  useEffect(() => {
    setEditingAt(null)
    setConfirm(false)
  }, [saved.submitted_at, canEdit])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState('')
  const cleanAnswers = validAnswers(poll.questions, answers)
  const missing = poll.questions.filter(question => question.required && !cleanAnswers[question.id]?.length)
  const disabled = busy || (done && !editing) || blockedPoll === poll || poll.status !== 'open'
  const answered = Object.values(cleanAnswers).filter(value => value.length > 0).length
  function setAnswer(id: string, value: string[]) { setAnswers(previous => ({ ...previous, [id]: value })); setError('') }
  async function submit() {
    if (disabled || missing.length) return
    setBusy(true)
    setError('')
    const controller = new AbortController()
    request.current = controller
    try {
      const result = await api<VoteResponse>('/vote', { method: 'POST', body: JSON.stringify({ poll_id: poll.id, answers: cleanAnswers }), signal: controller.signal })
      if (controller.signal.aborted) return
      setReceipt({ ...result, answers: cleanAnswers })
      setEditingAt(null)
      onRefresh()
    } catch (error) {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) onUnauthorized()
      else {
        if (error instanceof ApiError && error.status === 409) { setBlockedPoll(poll); setEditingAt(null) }
        setError(error instanceof Error ? error.message : '提交失败')
        onRefresh()
      }
    } finally { if (!controller.signal.aborted) { setBusy(false); setConfirm(false) } }
  }
  if (done && !editing) return <div className="flex items-start gap-4 border-y py-10">
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background"><Check className="size-4" /></span>
    <div className="min-w-0 flex-1">
      <div role="status"><h2 className="text-lg font-medium">已提交</h2>
        <p className="mt-2 text-sm text-muted-foreground">{poll.status === 'ended' ? '投票已结束' : canEdit ? '现在可以修改自己的答案' : '每次提交后需等待 10 分钟才能修改'}</p>
        {saved.editable_at && poll.status === 'open' && <p className="mt-2 text-xs text-muted-foreground">可修改时间 <time dateTime={saved.editable_at} className="font-mono">{new Date(saved.editable_at).toLocaleString('zh-CN', { hour12: false })}</time></p>}
        <p className="mt-2 text-xs text-muted-foreground">投票结束后显示结果</p>
      </div>
      {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
      <Button className="mt-6" disabled={!canEdit || busy || blockedPoll === poll} onClick={() => { setAnswers(saved.answers); setEditingAt(saved.submitted_at); setError('') }}>修改答案<ArrowUpRight /></Button>
    </div>
  </div>
  return <>
    {poll.status === 'pending' && <p className="mb-8 border-l-2 border-foreground pl-4 text-sm">投票尚未开始</p>}
    <form onSubmit={event => { event.preventDefault(); if (!disabled && !missing.length) setConfirm(true) }}>
      <div className="divide-y border-t">
        {poll.questions.map((question, index) => <section key={question.id} className="py-9 sm:py-12" aria-labelledby={`question-${question.id}`}>
          <QuestionHeading question={question} index={index} />
          <div className="sm:ml-10">
            {question.type === 'single' ? <RadioGroup aria-labelledby={`question-${question.id}`} value={cleanAnswers[question.id]?.[0] ?? ''} onValueChange={value => setAnswer(question.id, [value])} disabled={disabled}>
              {question.options.map(option => <label key={option.id} className={`option-row ${disabled ? 'cursor-default opacity-60' : ''}`} data-selected={cleanAnswers[question.id]?.includes(option.id)}><RadioGroupItem value={option.id} /><span className="min-w-0 break-words text-sm leading-relaxed">{option.label}</span></label>)}
            </RadioGroup> : <div className="grid gap-2" role="group" aria-labelledby={`question-${question.id}`}>
              {question.options.map(option => <label key={option.id} className={`option-row ${disabled ? 'cursor-default opacity-60' : ''}`} data-selected={cleanAnswers[question.id]?.includes(option.id)}><Checkbox checked={cleanAnswers[question.id]?.includes(option.id) ?? false} disabled={disabled} onCheckedChange={checked => setAnswer(question.id, checked === true ? [...(cleanAnswers[question.id] ?? []), option.id] : (cleanAnswers[question.id] ?? []).filter(id => id !== option.id))} /><span className="min-w-0 break-words text-sm leading-relaxed">{option.label}</span></label>)}
            </div>}
            {question.type === 'single' && !question.required && cleanAnswers[question.id]?.length > 0 && <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setAnswer(question.id, [])} disabled={disabled}>清除选择</Button>}
          </div>
        </section>)}
      </div>
      {!poll.questions.length && <p className="py-10 text-sm text-muted-foreground">暂无题目</p>}
      {error && <p role="alert" className="mb-5 border-l-2 border-foreground pl-3 text-sm">{error}</p>}
      <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-4 border-t bg-background/95 px-2 py-5 backdrop-blur-md">
        <div><p className="text-sm">已选 <span className="font-mono">{answered} / {poll.questions.length}</span></p><p className="mt-1.5 text-xs text-muted-foreground">{missing.length ? `还有 ${missing.length} 道必填题未选` : '每次提交后需等待 10 分钟才能修改'}</p></div>
        <Button type="submit" disabled={disabled || !!missing.length || !poll.questions.length}>{busy ? <Loader2 className="animate-spin" /> : null}{busy ? '提交中' : editing ? '提交修改' : '提交全部'}{!busy && <ArrowUpRight />}</Button>
      </div>
    </form>
    <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open) }}>
      <AlertDialogContent><AlertDialogTitle>{editing ? '确认修改？' : '确认提交？'}</AlertDialogTitle><AlertDialogDescription>{editing ? '本次修改将覆盖原答案。' : '全部答案将一次提交。'}每次提交成功后需等待 10 分钟才能再次修改，投票结束后停止修改。</AlertDialogDescription><div className="mt-8 flex justify-end gap-3"><AlertDialogCancel disabled={busy}>返回</AlertDialogCancel><AlertDialogAction disabled={disabled || !!missing.length} onClick={event => { event.preventDefault(); void submit() }}>{busy ? '提交中' : editing ? '确认修改' : '确认提交'}</AlertDialogAction></div></AlertDialogContent>
    </AlertDialog>
  </>
}
