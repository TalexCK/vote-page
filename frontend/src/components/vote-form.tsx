import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Loader2 } from 'lucide-react'
import { api, ApiError, type Answers, type Poll, type VoteResponse } from '@/lib/api'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from './ui/alert-dialog'
import { QuestionHeading } from './question-heading'
import { PageNavigation } from './page-navigation'
import { activePages, matchesCondition, questionPage, questionPages } from '@/lib/pages'

export function VoteForm({ poll, onRefresh, onUnauthorized }: { poll: Poll; onRefresh: () => void; onUnauthorized: () => void }) {
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const [answers, setAnswers] = useState<Answers>(poll.answers)
  const layout = questionPages(poll.questions, poll.pages)
  const { pages, answers: cleanAnswers } = activePages(poll.questions, layout, answers)
  const [page, setPage] = useState(0)
  const current = Math.min(page, pages.length - 1)
  const lastPage = current === pages.length - 1
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
  const activeQuestions = poll.questions.filter(question => question.id in cleanAnswers)
  const missing = activeQuestions.filter(question => question.required && !cleanAnswers[question.id]?.length)
  function checkGates(through: number, submitting = false): boolean {
    for (let index = 0; index <= through; index++) {
      const gates = [...(pages[index].gates ?? []), ...(index < through || submitting ? pages[index].exit_gates ?? [] : [])]
      const failed = gates.find(condition => !matchesCondition(condition, poll.questions, cleanAnswers))
      if (failed) {
        const question = poll.questions.find(question => question.id === failed.question_id)
        setPage(questionPage(pages, failed.question_id))
        setError(`请在「${question?.title ?? failed.question_id}」中选择以下任一选项后继续：${failed.option_labels.join('、')}`)
        return false
      }
    }
    return true
  }
  function changePage(target: number) {
    if (target > current && !checkGates(target)) return
    setPage(target)
    setError('')
  }
  const disabled = busy || (done && !editing) || blockedPoll === poll || poll.status !== 'open'
  const answered = Object.values(cleanAnswers).filter(value => value.length > 0).length
  function setAnswer(id: string, value: string[]) {
    setAnswers(previous => {
      const next = { ...previous, [id]: value }
      const active = activePages(poll.questions, layout, next).answers
      return Object.fromEntries(Object.keys(active).map(key => [key, next[key] ?? []]))
    })
    setError('')
  }
  async function submit() {
    if (disabled || missing.length || !checkGates(pages.length - 1, true)) return
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
      <Button className="mt-6" disabled={!canEdit || busy || blockedPoll === poll} onClick={() => { setAnswers(saved.answers); setEditingAt(saved.submitted_at); setPage(0); setError('') }}>修改答案<ArrowUpRight /></Button>
    </div>
  </div>
  return <>
    {poll.status === 'pending' && <p className="mb-8 border-l-2 border-foreground pl-4 text-sm">投票尚未开始</p>}
    <form onSubmit={event => {
      event.preventDefault()
      if (disabled) return
      if (!lastPage) { changePage(current + 1); return }
      if (!checkGates(pages.length - 1, true)) return
      if (missing.length) {
        const first = missing[0]
        const target = questionPage(pages, first.id)
        setPage(target)
        setError(`请完成第 ${target + 1} 页的第 ${poll.questions.indexOf(first) + 1} 题「${first.title}」（必填），再提交全部答案`)
        return
      }
      setConfirm(true)
    }}>
      <PageNavigation pages={pages} current={current} onChange={changePage} disabled={busy} />
      {error && <p role="alert" className="mb-5 border-l-2 border-foreground pl-3 text-sm">{error}</p>}
      <div className="divide-y border-t">
        {poll.questions.map((question, index) => pages[current].question_ids.includes(question.id) && <section key={question.id} className="py-9 sm:py-12" aria-labelledby={`question-${question.id}`}>
          <QuestionHeading question={question} index={index} />
          <div className="sm:ml-10">
            {question.type === 'text' ? <div>
              <textarea aria-labelledby={`question-${question.id}`} aria-describedby={`text-help-${question.id}`} rows={3} maxLength={2000} disabled={disabled} value={answers[question.id]?.[0] ?? ''} onChange={event => setAnswer(question.id, [event.target.value])} className="w-full resize-y rounded-sm border bg-background px-4 py-3 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
              <p id={`text-help-${question.id}`} className="mt-2 text-xs text-muted-foreground">最多 2000 字{question.pattern ? <> · 须完整匹配格式 <code className="break-all font-mono">{question.pattern}</code>，提交时校验</> : ''}</p>
            </div> : question.type === 'single' ? <RadioGroup aria-labelledby={`question-${question.id}`} value={cleanAnswers[question.id]?.[0] ?? ''} onValueChange={value => setAnswer(question.id, [value])} disabled={disabled}>
              {question.options.map(option => <label key={option.id} className={`option-row ${disabled ? 'cursor-default opacity-60' : ''}`} data-selected={cleanAnswers[question.id]?.includes(option.id)}><RadioGroupItem value={option.id} /><span className="min-w-0 break-words text-sm leading-relaxed">{option.label}</span></label>)}
            </RadioGroup> : <div className="grid gap-2" role="group" aria-labelledby={`question-${question.id}`}>
              {question.options.map(option => <label key={option.id} className={`option-row ${disabled ? 'cursor-default opacity-60' : ''}`} data-selected={cleanAnswers[question.id]?.includes(option.id)}><Checkbox checked={cleanAnswers[question.id]?.includes(option.id) ?? false} disabled={disabled} onCheckedChange={checked => setAnswer(question.id, checked === true ? [...(cleanAnswers[question.id] ?? []), option.id] : (cleanAnswers[question.id] ?? []).filter(id => id !== option.id))} /><span className="min-w-0 break-words text-sm leading-relaxed">{option.label}</span></label>)}
            </div>}
            {question.type === 'single' && !question.required && cleanAnswers[question.id]?.length > 0 && <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setAnswer(question.id, [])} disabled={disabled}>清除选择</Button>}
          </div>
        </section>)}
      </div>
      {!activeQuestions.length && <p className="py-10 text-sm text-muted-foreground">当前没有需要作答的题目</p>}
      <div className="sticky bottom-0 -mx-2 flex flex-wrap items-center justify-between gap-4 border-t bg-background/95 px-2 py-5 backdrop-blur-md">
        <div><p className="text-sm">已选 <span className="font-mono">{answered} / {activeQuestions.length}</span></p><p className="mt-1.5 text-xs text-muted-foreground">{missing.length ? `还有 ${missing.length} 道必填题未选` : '每次提交后需等待 10 分钟才能修改'}</p></div>
        {lastPage ? <Button type="submit" disabled={disabled || !poll.questions.length}>{busy ? <Loader2 className="animate-spin" /> : null}{busy ? '提交中' : editing ? '提交修改' : '提交全部'}{!busy && <ArrowUpRight />}</Button> : <Button type="button" disabled={busy} onClick={() => changePage(current + 1)}>继续下一页<ArrowUpRight /></Button>}
      </div>
    </form>
    <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open) }}>
      <AlertDialogContent><AlertDialogTitle>{editing ? '确认修改？' : '确认提交？'}</AlertDialogTitle><AlertDialogDescription>{editing ? '本次修改将覆盖原答案。' : '全部答案将一次提交。'}每次提交成功后需等待 10 分钟才能再次修改，投票结束后停止修改。</AlertDialogDescription><div className="mt-8 flex justify-end gap-3"><AlertDialogCancel disabled={busy}>返回</AlertDialogCancel><AlertDialogAction disabled={disabled || !!missing.length} onClick={event => { event.preventDefault(); void submit() }}>{busy ? '提交中' : editing ? '确认修改' : '确认提交'}</AlertDialogAction></div></AlertDialogContent>
    </AlertDialog>
  </>
}
