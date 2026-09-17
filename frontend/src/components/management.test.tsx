import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { Management } from './management'
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: vi.fn() }))
const mockApi = vi.mocked(api)
const inventory = { active_poll_id: 'one', polls: [{ id: 'one', title: '第一期', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', question_count: 2, ballot_count: 3 }, { id: 'two', title: '第二期', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', question_count: 1, ballot_count: 0 }] }
beforeEach(() => { mockApi.mockReset() })
it('switches homepage and explicitly deactivates without deleting polls', async () => {
  mockApi.mockImplementation(async path => path === '/management/polls' ? inventory : {})
  const user = userEvent.setup()
  render(<Management onUnauthorized={vi.fn()} />)
  const select = await screen.findByRole('combobox', { name: '首页投票' })
  expect(select).toHaveValue('one')
  await user.selectOptions(select, 'two')
  expect(mockApi).toHaveBeenLastCalledWith('/management/active-poll', expect.objectContaining({ method: 'POST', body: JSON.stringify({ poll_id: 'two' }) }))
  expect(select).toHaveValue('two')
  await user.selectOptions(select, '')
  expect(mockApi).toHaveBeenLastCalledWith('/management/active-poll', expect.objectContaining({ body: JSON.stringify({ poll_id: null }) }))
  expect(await screen.findByText('已停用首页投票')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '复制第一期' })).toBeInTheDocument()
})
it('loads a copy and results from their specific archive endpoints', async () => {
  mockApi.mockImplementation(async path => path === '/management/polls' ? inventory : path.startsWith('/management/results?') ? { id: 'one', title: '第一期', questions: [] } : { id: 'one', title: '第一期', starts_at: inventory.polls[0].starts_at, ends_at: inventory.polls[0].ends_at, questions: [] })
  const user = userEvent.setup()
  render(<Management onUnauthorized={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: '查看第一期结果' }))
  expect(await screen.findByText('暂无题目')).toBeInTheDocument()
  expect(mockApi).toHaveBeenLastCalledWith('/management/results?poll_id=one', expect.anything())
  await user.click(screen.getByRole('button', { name: '复制第一期' }))
  expect(await screen.findByLabelText('投票标题')).toHaveValue('第一期 · 副本')
  expect(mockApi).toHaveBeenLastCalledWith('/management/poll?poll_id=one', expect.anything())
})
it('confirms deletion, cancels safely, and clears the active poll and its results', async () => {
  mockApi.mockImplementation(async path => path === '/management/polls' ? inventory : path.startsWith('/management/results?') ? { id: 'one', title: '第一期', questions: [] } : {})
  const user = userEvent.setup()
  render(<Management onUnauthorized={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: '查看第一期结果' }))
  await user.click(screen.getByRole('button', { name: '删除第一期' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('无法恢复')
  expect(mockApi.mock.calls.some(([path]) => path === '/management/delete-poll')).toBe(false)
  await user.click(screen.getByRole('button', { name: '取消' }))
  expect(screen.getByRole('button', { name: '删除第一期' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '删除第一期' }))
  await user.click(screen.getByRole('button', { name: '确认删除' }))
  expect(mockApi).toHaveBeenLastCalledWith('/management/delete-poll', expect.objectContaining({ method: 'POST', body: JSON.stringify({ poll_id: 'one' }) }))
  expect(screen.queryByRole('button', { name: '删除第一期' })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox')).toHaveValue('')
  expect(screen.queryByText('暂无题目')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '删除第二期' })).toBeInTheDocument()
})

it('aborts pending operations when unmounted', async () => {
  let finish!: (value: unknown) => void
  mockApi.mockImplementation(async path => path === '/management/polls' ? inventory : new Promise(resolve => { finish = resolve }))
  const user = userEvent.setup()
  const view = render(<Management onUnauthorized={vi.fn()} />)
  await user.selectOptions(await screen.findByRole('combobox'), '')
  const signal = mockApi.mock.calls.at(-1)![1]!.signal!
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => finish({}))
})
