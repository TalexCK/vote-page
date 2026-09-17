import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PollPage } from './poll-page'
import { api, type Poll } from '@/lib/api'

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: vi.fn() }))
const mockApi = vi.mocked(api)
const unauthorized = vi.fn()
const poll: Poll = { id: 'one', title: '本次投票', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', status: 'open', submitted: false, answers: {}, submitted_at: null, editable_at: null, can_edit: false, server_time: '2026-01-01T00:00:00Z', questions: [{ id: 'q', title: '选择', type: 'single', required: true, proposer: '', options: [{ id: 'a', label: '选项 A' }] }] }
const results = { id: 'one', title: poll.title, questions: [] }
beforeEach(() => { mockApi.mockReset() })
function mount() { return render(<PollPage onUnauthorized={unauthorized} />) }
async function focusRefresh() { await act(async () => { window.dispatchEvent(new Event('focus')) }) }

describe('投票页面', () => {
  it('未配置显示暂无投票，不请求结果', async () => {
    mockApi.mockResolvedValue(null)
    mount()
    expect(await screen.findByText('暂无投票')).toBeInTheDocument()
    expect(mockApi).toHaveBeenCalledTimes(1)
  })
  it('提交绑定 poll_id，投票结束自动显示结果', async () => {
    let current = poll
    mockApi.mockImplementation(async path => path === '/poll' ? current : path === '/results' ? results : { ok: true, submitted_at: '2026-01-01T00:00:00Z', editable_at: '2026-01-01T00:10:00Z' })
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio'))
    await user.click(screen.getByRole('button', { name: '提交全部' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    await screen.findByText('已提交')
    expect(mockApi).toHaveBeenCalledWith('/vote', expect.objectContaining({ method: 'POST', body: JSON.stringify({ poll_id: 'one', answers: { q: ['a'] } }) }))
    expect(mockApi.mock.calls.some(([path]) => path === '/results')).toBe(false)
    current = { ...poll, status: 'ended' }
    await focusRefresh()
    expect(await screen.findByText('暂无题目')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
  it('切换 ID 清空选项并忽略旧提交响应', async () => {
    let current = poll
    let finish!: (value: unknown) => void
    mockApi.mockImplementation(async path => path === '/poll' ? current : new Promise(resolve => { finish = resolve }))
    mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio'))
    await user.click(screen.getByRole('button', { name: '提交全部' }))
    await user.click(screen.getByRole('button', { name: '确认提交' }))
    current = { ...poll, id: 'two' }
    await focusRefresh()
    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'false')
    const count = mockApi.mock.calls.length
    await act(async () => finish({ ok: true }))
    expect(mockApi).toHaveBeenCalledTimes(count)
    expect(screen.queryByText('已提交')).not.toBeInTheDocument()
  })
  it('主页停用投票后移除旧表单', async () => {
    let current: Poll | null = poll
    mockApi.mockImplementation(async () => current)
    mount()
    expect(await screen.findByRole('radio')).toBeInTheDocument()
    current = null
    await focusRefresh()
    expect(await screen.findByText('暂无投票')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
