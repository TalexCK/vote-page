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
