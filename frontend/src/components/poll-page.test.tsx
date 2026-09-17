import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PollPage } from './poll-page'
import { api, ApiError, type Poll } from '@/lib/api'

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), api: vi.fn() }))
const mockApi = vi.mocked(api)
const unauthorized = vi.fn()
const poll: Poll = { id: 'one', title: '本次投票', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', status: 'open', submitted: false, questions: [{ id: 'q', title: '选择', type: 'single', required: true, proposer: '', options: [{ id: 'a', label: '选项 A' }] }] }
const config = { id: poll.id, title: poll.title, starts_at: poll.starts_at, ends_at: poll.ends_at, questions: poll.questions }
const results = { id: 'one', title: poll.title, questions: [] }
beforeEach(() => { mockApi.mockReset() })
function mount(management = false) { return render(<PollPage management={management} onUnauthorized={unauthorized} />) }
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
    mockApi.mockImplementation(async path => path === '/poll' ? current : path === '/results' ? results : { ok: true })
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
  it('管理员获取原始 JSON，校验对象，处理重复 ID 并发布', async () => {
    let current: Poll | null = null
    let conflict = true
    mockApi.mockImplementation(async (path, options) => {
      if (path === '/management/poll' && options?.method === 'POST') {
        if (conflict) throw new ApiError('conflict', 409)
        current = poll
        return { ok: true }
      }
      return path === '/management/poll' ? config : path === '/poll' ? current : results
    })
    mount(true)
    const editor = await screen.findByRole('textbox', { name: '投票 JSON' })
    await waitFor(() => expect(editor).toHaveValue(JSON.stringify(config, null, 2)))
    const publish = screen.getByRole('button', { name: '发布投票' })
    fireEvent.change(editor, { target: { value: '[]' } })
    fireEvent.click(publish)
    expect(await screen.findByRole('alert')).toHaveTextContent('请输入有效的 JSON 对象')
    fireEvent.change(editor, { target: { value: JSON.stringify(config) } })
    fireEvent.click(publish)
    expect(await screen.findByRole('alert')).toHaveTextContent('投票 ID 已使用')
    conflict = false
    fireEvent.click(publish)
    expect(await screen.findByText('已发布')).toBeInTheDocument()
    expect(await screen.findByText('暂无题目')).toBeInTheDocument()
    expect(mockApi).toHaveBeenCalledWith('/management/poll', expect.objectContaining({ method: 'POST', body: JSON.stringify({ config }) }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
  it('发布后忽略上一轮未完成的 poll 响应', async () => {
    let finish!: (value: unknown) => void
    let published = false
    mockApi.mockImplementation(async (path, options) => {
      if (path === '/management/poll') {
        if (options?.method === 'POST') { published = true; return { ok: true } }
        return config
      }
      if (path === '/results') return { ...results, id: 'two' }
      return published ? { ...poll, id: 'two', title: '新投票' } : new Promise(resolve => { finish = resolve })
    })
    mount(true)
    await waitFor(() => expect(screen.getByRole('button', { name: '发布投票' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '发布投票' }))
    await screen.findByText('新投票')
    await act(async () => finish(poll))
    expect(screen.getByText('新投票')).toBeInTheDocument()
    expect(screen.queryByText('本次投票')).not.toBeInTheDocument()
  })
})
