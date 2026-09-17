import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type Condition, type Question } from '@/lib/api'
import { Button } from './ui/button'

export type PageBreak = { type: 'pagebreak'; condition?: Condition | null }
export type Category = { type: 'category'; title: string; condition?: Condition | null; questions: (Question | PageBreak)[] }
export interface PollConfig { id: string; title: string; starts_at: string; ends_at: string; questions: (Question | PageBreak | Category)[] }
type Entry = Question | PageBreak | Category
type Draft = { key: string; entry: Entry; children?: Draft[] }
const input = 'mt-2 block w-full rounded-sm border bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`
const isQuestion = (entry: Entry): entry is Question => entry.type !== 'category' && entry.type !== 'pagebreak'
const flatten = (nodes: Draft[]): Draft[] => nodes.flatMap(node => [node, ...flatten(node.children ?? [])])
function drafts(config?: PollConfig): Draft[] {
  const ids = new Map<string, string>()
  const visit = (entries: Entry[]): Draft[] => entries.map(original => {
    const entry = structuredClone(original)
    if (isQuestion(entry)) {
      const id = uid('question'); ids.set(entry.id, id); entry.id = id
      if (!entry.hidden) delete entry.condition
    }
    return { key: uid('entry'), entry, children: entry.type === 'category' ? visit(entry.questions) : undefined }
  })
  const nodes = visit(config?.questions ?? [])
  flatten(nodes).forEach(({ entry }) => { if (entry.condition) entry.condition.question_id = ids.get(entry.condition.question_id) ?? entry.condition.question_id })
  return nodes
}
function serialize(nodes: Draft[]): Entry[] {
  return nodes.map(({ entry, children }) => entry.type === 'category' ? { ...entry, questions: serialize(children ?? []) as (Question | PageBreak)[] } : entry)
}
function localDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function ConditionEditor({ value, choices, onChange, gate = false }: { value?: Condition | null; choices: Question[]; onChange: (condition?: Condition) => void; gate?: boolean }) {
  const source = choices.find(question => question.id === value?.question_id)
  return <div className="mt-4 border-l-2 pl-4">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!value} onChange={event => onChange(event.target.checked ? { question_id: '', option_labels: [] } : undefined)} />{gate ? '设置翻页条件' : '设置显示条件'}</label>
    {value && <div className="mt-3 space-y-3">
      <label className="block text-xs">依据前面的选择题<select className={input} value={value.question_id} onChange={event => onChange({ question_id: event.target.value, option_labels: [] })}>
        <option value="">请选择题目</option>
        {!source && value.question_id && <option value={value.question_id}>原题目已删除或移到后方，请重新选择</option>}
        {choices.map(question => <option key={question.id} value={question.id}>{question.title || '未命名题目'}</option>)}
      </select></label>
      <p className="text-xs leading-5 text-muted-foreground">选中任一选项时{gate ? '允许翻页' : '显示'}：</p>
      {source?.options.filter((option, index, options) => options.findIndex(item => item.label === option.label) === index).map(option => <label key={option.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.option_labels.includes(option.label)} onChange={event => onChange({ ...value, option_labels: event.target.checked ? [...value.option_labels, option.label] : value.option_labels.filter(label => label !== option.label) })} />{option.label || '未命名选项'}</label>)}
      {source && value.option_labels.some(label => !source.options.some(option => option.label === label)) && <p role="alert" className="text-xs">引用的选项已更改，请重新选择题目和选项。</p>}
    </div>}
  </div>
}

export function PollEditor({ initialConfig, onPublished, onUnauthorized, onCancel }: { initialConfig?: PollConfig; onPublished: () => void; onUnauthorized: () => void; onCancel?: () => void }) {
  const [id] = useState(() => uid('poll'))
  const [title, setTitle] = useState(initialConfig ? `${initialConfig.title} · 副本` : '')
  const [startsAt, setStartsAt] = useState(() => localDate(initialConfig?.starts_at))
  const [endsAt, setEndsAt] = useState(() => localDate(initialConfig?.ends_at))
  const [nodes, setNodes] = useState(() => drafts(initialConfig))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const all = flatten(nodes)
  function update(key: string, change: (node: Draft) => Draft) {
    const walk = (items: Draft[]): Draft[] => items.map(node => node.key === key ? change(node) : { ...node, children: node.children ? walk(node.children) : undefined })
    setNodes(previous => walk(previous))
  }
  function listChange(parent: string | undefined, change: (items: Draft[]) => Draft[]) {
    if (parent) update(parent, node => ({ ...node, children: change(node.children ?? []) }))
    else setNodes(change)
  }
  function add(type: Entry['type'], parent?: string) {
    const entry: Entry = type === 'category' ? { type, title: '', questions: [] } : type === 'pagebreak' ? { type } : { id: uid('question'), type, title: '', proposer: '', required: false, options: type === 'text' ? [] : [{ id: uid('option'), label: '' }, { id: uid('option'), label: '' }] }
    listChange(parent, items => [...items, { key: uid('entry'), entry, children: type === 'category' ? [] : undefined }])
  }
  function addButtons(parent?: string) {
    return <div className="flex flex-wrap gap-2 border-t border-dashed pt-4" aria-label={parent ? '分类内添加内容' : '添加内容'}>
      {(['single', 'multiple', 'text', 'pagebreak', ...(!parent ? ['category'] : [])] as Entry['type'][]).map(type => <Button key={type} type="button" variant="outline" size="sm" onClick={() => add(type, parent)}>＋ {({ single: '单选题', multiple: '多选题', text: '填空题', pagebreak: '分页', category: '分类' })[type]}</Button>)}
    </div>
  }
  function renderList(items: Draft[], parent?: string) {
    return items.map((node, index) => {
      const { entry, key } = node
      const patch = (values: Partial<Entry>) => update(key, old => ({ ...old, entry: { ...old.entry, ...values } as Entry }))
      const choices = all.slice(0, all.findIndex(item => item.key === key)).map(item => item.entry).filter((item): item is Question => isQuestion(item) && item.type !== 'text')
      const name = entry.type === 'pagebreak' ? '分页' : entry.title || '未命名'
      return <section key={key} className={entry.type === 'pagebreak' ? 'my-5 border-y border-dashed py-5' : 'my-6 border p-4 sm:p-6'} aria-label={`${name}编辑`}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs tracking-widest text-muted-foreground"><span className="mr-3 font-mono">{String(index + 1).padStart(2, '0')}</span>{({ single: '单选题', multiple: '多选题', text: '填空题', category: '分类', pagebreak: '分页' })[entry.type]}</p>
          <div className="flex gap-1">{([-1, 1] as const).map(direction => <Button key={direction} type="button" variant="ghost" size="sm" aria-label={`${direction === -1 ? '上移' : '下移'}${name}`} disabled={index + direction < 0 || index + direction >= items.length} onClick={() => listChange(parent, list => { const next = [...list]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next })}>{direction === -1 ? '↑' : '↓'}</Button>)}<Button type="button" variant="ghost" size="sm" aria-label={`删除${name}`} onClick={() => listChange(parent, list => list.filter(item => item.key !== key))}>删除</Button></div>
        </div>
        {entry.type !== 'pagebreak' && <label className="block text-xs">{entry.type === 'category' ? '分类标题' : '题目标题'}<input required className={input} value={entry.title} onChange={event => patch({ title: event.target.value })} /></label>}
        {isQuestion(entry) && <>
          <div className="mt-4 flex flex-wrap items-end gap-5"><label className="min-w-0 flex-1 text-xs">提案人 Minecraft ID<input required pattern="[A-Za-z0-9_]{1,16}" title="1–16 位字母、数字或下划线" className={input} value={entry.proposer} onChange={event => patch({ proposer: event.target.value })} /></label><label className="flex items-center gap-2 pb-3 text-sm"><input type="checkbox" checked={entry.required} onChange={event => patch({ required: event.target.checked })} />必答</label></div>
          {entry.type === 'text' ? <label className="mt-4 block text-xs">格式规则（正则表达式，可选）<input maxLength={500} className={`${input} font-mono`} value={entry.pattern ?? ''} onChange={event => patch({ pattern: event.target.value || null })} /><span className="mt-2 block leading-5 text-muted-foreground">完整匹配答案，留空不限制格式。</span></label> : <div className="mt-5 space-y-2">
            {entry.options.map((option, optionIndex) => <div key={option.id} className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs">选项 {optionIndex + 1}<input required className={input} value={option.label} onChange={event => patch({ options: entry.options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} /></label><Button type="button" variant="ghost" size="sm" aria-label={`删除选项 ${optionIndex + 1}`} onClick={() => patch({ options: entry.options.filter(item => item.id !== option.id) })}>移除</Button></div>)}
            <Button type="button" variant="ghost" size="sm" onClick={() => patch({ options: [...entry.options, { id: uid('option'), label: '' }] })}>＋ 添加选项</Button>
          </div>}
          <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!entry.hidden} onChange={event => patch({ hidden: event.target.checked, condition: event.target.checked ? entry.condition : undefined })} />默认隐藏此题</label>
          {entry.hidden && <p className="mt-2 text-xs text-muted-foreground">设置条件后可显示；否则始终隐藏。</p>}
        </>}
        {(!isQuestion(entry) || entry.hidden) && <ConditionEditor value={entry.condition} choices={choices} gate={entry.type === 'pagebreak'} onChange={condition => patch({ condition })} />}
        {entry.type === 'pagebreak' && entry.condition && <p className="mt-3 text-xs leading-5 text-muted-foreground">条件不满足时不能翻页。</p>}
        {entry.type === 'category' && <div className="mt-6">{renderList(node.children ?? [], key)}{addButtons(key)}</div>}
      </section>
    })
  }
  async function publish() {
    if (request.current && !request.current.signal.aborted) return
    setError('')
    if (new Date(endsAt) <= new Date(startsAt)) { setError('结束时间必须晚于开始时间'); return }
    if (!all.some(node => isQuestion(node.entry))) { setError('请至少添加一道题目'); return }
    for (const [index, { entry }] of all.entries()) {
      if (isQuestion(entry) && entry.type !== 'text' && entry.options.length < 2) { setError('选择题至少需要两个选项'); return }
      if (entry.condition) {
        const condition = entry.condition
        const source = all.slice(0, index).map(node => node.entry).find((item): item is Question => isQuestion(item) && item.type !== 'text' && item.id === condition.question_id)
        if (!source || !condition.option_labels.length || condition.option_labels.some(label => !source.options.some(option => option.label === label))) { setError('显示条件引用无效，请重新选择题目和选项。'); return }
      }
    }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      await api('/management/polls', { method: 'POST', body: JSON.stringify({ config: { id, title, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(), questions: serialize(nodes) } }), signal: controller.signal })
      if (!controller.signal.aborted) onPublished()
    } catch (error) {
      if (!controller.signal.aborted) { if (error instanceof ApiError && error.status === 401) onUnauthorized(); else setError(error instanceof Error ? error.message : '创建失败') }
    } finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  return <section className="mt-10 border-t pt-8" aria-labelledby="editor-title">
    <h2 id="editor-title" className="text-2xl font-semibold">{initialConfig ? '复制新建' : '新建投票'}</h2>
    <p className="mt-2 text-xs text-muted-foreground">创建后不可修改，可复制新建。</p>
    <form className="mt-8" onSubmit={event => { event.preventDefault(); void publish() }}>
      <fieldset disabled={busy} className="min-w-0">
        <label className="block text-xs">投票标题<input required className={input} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="mt-5 grid gap-5 sm:grid-cols-2"><label className="text-xs">开始时间（本地时间）<input required type="datetime-local" className={input} value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label className="text-xs">结束时间（本地时间）<input required type="datetime-local" className={input} value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div>
        <div className="my-8">{renderList(nodes)}{!nodes.length && <p className="py-8 text-sm text-muted-foreground">请添加题目</p>}{addButtons()}</div>
        <div className="flex items-center justify-end gap-3 border-t pt-5">{onCancel && <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>}<Button type="submit">{busy ? '创建中…' : '创建投票'}</Button></div>
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm leading-6">{error}</p>}
    </form>
  </section>
}
