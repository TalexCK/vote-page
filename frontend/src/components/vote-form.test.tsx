import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError, type Poll } from '@/lib/api'
import { VoteForm } from './vote-form'

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: vi.fn() }))
const mockApi = vi.mocked(api)
const poll: Poll = {
  id: 'one', title: '投票', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', status: 'open',
  submitted: true, answers: { q: ['a'] }, submitted_at: '2026-01-01T00:00:00Z', editable_at: '2026-01-01T00:10:00Z',
  can_edit: false, server_time: '2026-01-01T00:05:00Z',
  questions: [{ id: 'q', title: '选择', type: 'single', required: true, proposer: '', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
}
const refresh = vi.fn()
function form(value: Poll) { return <VoteForm poll={value} onRefresh={refresh} onUnauthorized={vi.fn()} /> }
beforeEach(() => { mockApi.mockReset(); refresh.mockReset() })

it('仅服务端解锁；编辑预填且刷新不覆盖草稿，确认成功后重新锁定', async () => {
  const user = userEvent.setup()
  const view = render(form(poll))
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
  expect(screen.getByText(/可修改时间/)).toBeInTheDocument()
  const unlocked = { ...poll, can_edit: true }
  view.rerender(form(unlocked))
  await user.click(screen.getByRole('button', { name: '修改答案' }))
  expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('radio', { name: 'B' }))
  view.rerender(form({ ...unlocked, answers: { q: ['a'] }, server_time: '2026-01-01T00:11:00Z' }))
  expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
  expect(mockApi).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '提交修改' }))
  expect(mockApi).not.toHaveBeenCalled()
  mockApi.mockResolvedValue({ ok: true, submitted_at: '2026-01-01T00:12:00Z', editable_at: '2026-01-01T00:22:00Z' })
  await user.click(screen.getByRole('button', { name: '确认修改' }))
  expect(await screen.findByText('已提交')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
  expect(mockApi).toHaveBeenCalledWith('/vote', expect.objectContaining({ body: JSON.stringify({ poll_id: 'one', answers: { q: ['b'] } }) }))
  view.rerender(form({ ...unlocked }))
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
})

it('其他标签页提交后关闭编辑与确认，下一次编辑使用最新答案', async () => {
  const view = render(form({ ...poll, can_edit: true }))
  fireEvent.click(screen.getByRole('button', { name: '修改答案' }))
  fireEvent.click(screen.getByRole('button', { name: '提交修改' }))
  const updated = { ...poll, submitted_at: '2026-01-01T00:15:00Z', editable_at: '2026-01-01T00:25:00Z', answers: { q: ['b'] } }
  view.rerender(form(updated))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
  view.rerender(form({ ...updated, can_edit: true }))
  fireEvent.click(screen.getByRole('button', { name: '修改答案' }))
  expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
  view.rerender(form({ ...updated, can_edit: true, status: 'ended' }))
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
})

it('冷却冲突显示服务端错误并刷新，不视为成功', async () => {
  mockApi.mockRejectedValue(new ApiError('每次提交后需等待 10 分钟才能修改', 409))
  const user = userEvent.setup()
  render(form({ ...poll, can_edit: true }))
  await user.click(screen.getByRole('button', { name: '修改答案' }))
  await user.click(screen.getByRole('button', { name: '提交修改' }))
  await user.click(screen.getByRole('button', { name: '确认修改' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('每次提交后需等待 10 分钟才能修改')
  expect(refresh).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: '修改答案' })).toBeDisabled()
})

const paged: Poll = {
  ...poll, submitted: false, submitted_at: null, editable_at: null, answers: {},
  questions: [...poll.questions, { ...poll.questions[0], id: 'q2', title: '第二题', options: [{ id: 'c', label: 'C' }] }],
  pages: [{ title: '分类一', question_ids: ['q'] }, { title: '分类二', question_ids: ['q2'] }],
}

it('分页保留选择，全局必填漏选跳回对应页，统一提交所有答案', async () => {
  const user = userEvent.setup()
  render(form(paged))
  expect(screen.getByText('分类一')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '提交全部' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.queryByRole('radio', { name: 'A' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'C' }))
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  expect(screen.getByRole('alert')).toHaveTextContent('第 1 页的第 1 题「选择」（必填）')
  expect(screen.getByText('分类一')).toBeInTheDocument()
  expect(mockApi).not.toHaveBeenCalled()
  await user.click(screen.getByRole('radio', { name: 'B' }))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('button', { name: '上一页' }))
  expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('button', { name: '下一页' }))
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  mockApi.mockResolvedValue({ ok: true, submitted_at: poll.submitted_at, editable_at: poll.editable_at })
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  expect(mockApi).toHaveBeenCalledWith('/vote', expect.objectContaining({ body: JSON.stringify({ poll_id: 'one', answers: { q: ['b'], q2: ['c'] } }) }))
})

it('条件分页拦截两个翻页入口，分类跳过后清除旧答案且不校验隐藏必填题', async () => {
  const user = userEvent.setup()
  const condition = { question_id: 'q', option_labels: ['A'] }
  const value: Poll = {
    ...paged,
    questions: [...paged.questions, { ...paged.questions[1], id: 'q3', title: '最后一题', required: false }],
    pages: [
      { title: null, question_ids: ['q'], exit_gates: [{ question_id: 'q', option_labels: ['A', 'B'] }] },
      { title: '条件分类', question_ids: ['q2'], condition },
      { title: '最后一页', question_ids: ['q3'] },
    ],
  }
  render(form(value))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('alert')).toHaveTextContent('A、B')
  await user.click(screen.getByRole('button', { name: '继续下一页' }))
  expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'A' }))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('条件分类')).toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'C' }))
  await user.click(screen.getByRole('button', { name: '上一页' }))
  await user.click(screen.getByRole('radio', { name: 'B' }))
  await user.click(screen.getByRole('radio', { name: 'A' }))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'false')
  await user.click(screen.getByRole('button', { name: '上一页' }))
  await user.click(screen.getByRole('radio', { name: 'B' }))
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('最后一页')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  mockApi.mockResolvedValue({ ok: true, submitted_at: poll.submitted_at, editable_at: poll.editable_at })
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  expect(mockApi).toHaveBeenCalledWith('/vote', expect.objectContaining({ body: JSON.stringify({ poll_id: 'one', answers: { q: ['b'], q3: [] } }) }))
})

it('条件填空题随选择显示，必填与服务端格式校验生效，隐藏时清除答案', async () => {
  const user = userEvent.setup()
  const value: Poll = {
    ...paged,
    questions: [paged.questions[0], {
      id: 'text', title: '联系编号', type: 'text', options: [], required: true, proposer: 'Player',
      hidden: true, condition: { question_id: 'q', option_labels: ['A'] }, pattern: '[0-9]{4}',
    }],
    pages: [{ title: null, question_ids: ['q', 'text'] }],
  }
  render(form(value))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'A' }))
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  expect(screen.getByRole('alert')).toHaveTextContent('联系编号')
  const input = screen.getByRole('textbox', { name: '联系编号' })
  await user.type(input, 'bad')
  mockApi.mockRejectedValueOnce(new ApiError('联系编号：填写内容不符合格式', 422))
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('填写内容不符合格式')
  expect(input).toHaveValue('bad')
  await user.click(screen.getByRole('radio', { name: 'B' }))
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('radio', { name: 'A' }))
  expect(screen.getByRole('textbox')).toHaveValue('')
  await user.type(screen.getByRole('textbox'), '1234')
  mockApi.mockResolvedValue({ ok: true, submitted_at: poll.submitted_at, editable_at: poll.editable_at })
  await user.click(screen.getByRole('button', { name: '提交全部' }))
  await user.click(screen.getByRole('button', { name: '确认提交' }))
  expect(mockApi).toHaveBeenLastCalledWith('/vote', expect.objectContaining({ body: JSON.stringify({ poll_id: 'one', answers: { q: ['a'], text: ['1234'] } }) }))
})

it('修改回填所有页，新投票 key 重置页和答案', async () => {
  const user = userEvent.setup()
  const value = { ...paged, submitted: true, submitted_at: poll.submitted_at, can_edit: true, answers: { q: ['b'], q2: ['c'] } }
  const view = render(<VoteForm key={value.id} poll={value} onRefresh={refresh} onUnauthorized={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '修改答案' }))
  expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('aria-checked', 'true')
  view.rerender(<VoteForm key="new" poll={{ ...paged, id: 'new' }} onRefresh={refresh} onUnauthorized={vi.fn()} />)
  expect(screen.getByText('第 1 / 2 页')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'false')
})
