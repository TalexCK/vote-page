export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: { ...(options.body || options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('连接失败，请重试')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail)
      ? body.detail.map((issue: { loc?: (string | number)[]; msg?: string }) => `${issue.loc?.filter(part => part !== 'body' && part !== 'config').join(' / ') ?? ''}：${issue.msg ?? '配置无效'}`).join('；')
      : '请求失败，请重试'
    throw new ApiError(detail, response.status)
  }
  if (response.status === 204) return undefined as T
  const text = await response.text()
  return text ? JSON.parse(text) as T : undefined as T
}

export interface User { minecraft_id: string; is_admin: boolean }
export interface Question {
  id: string
  title: string
  type: 'single' | 'multiple' | 'text'
  required: boolean
  proposer: string
  options: { id: string; label: string }[]
  pattern?: string | null
  hidden?: boolean
  condition?: Condition | null
}
export interface Condition { question_id: string; option_labels: string[] }
export interface PollPage {
  title: string | null
  question_ids: string[]
  condition?: Condition
  gates?: Condition[]
  exit_gates?: Condition[]
}
export interface Poll {
  id: string
  title: string
  starts_at: string
  ends_at: string
  status: 'pending' | 'open' | 'ended'
  submitted: boolean
  answers: Answers
  submitted_at: string | null
  editable_at: string | null
  can_edit: boolean
  server_time: string
  questions: Question[]
  pages?: PollPage[]
}
export interface Results {
  id: string
  title: string
  pages?: PollPage[]
  questions: (Omit<Question, 'options'> & {
    total_votes: number
    responses?: { player_id: string; text: string }[]
    options: { id: string; label: string; count: number; voters: string[] }[]
  })[]
}
export type Answers = Record<string, string[]>
export interface VoteResponse { ok: true; submitted_at: string; editable_at: string }

export function validAnswers(questions: Question[], answers: Answers): Answers {
  return Object.fromEntries(questions.map(question => {
    if (question.type === 'text') {
      const value = answers[question.id]?.[0] ?? ''
      return [question.id, value.trim() ? [value] : []]
    }
    const selected = (answers[question.id] ?? []).filter(id => question.options.some(option => option.id === id))
    return [question.id, question.type === 'single' ? selected.slice(0, 1) : selected]
  }))
}
