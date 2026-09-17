import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { api, ApiError } from '@/lib/api'
import { PollEditor, type PollConfig } from './poll-editor'
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(), api: vi.fn() }))
const mockApi = vi.mocked(api)
const config: PollConfig = { id: 'old', title: '原投票', starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-12-01T00:00:00Z', questions: [{ id: 'q1', title: '选择', proposer: 'Admin', type: 'single', required: true, options: [{ id: 'a', label: '是' }, { id: 'b', label: '否' }] }, { id: 'q2', title: '说明', proposer: 'Admin', type: 'text', required: false, options: [], hidden: true, condition: { question_id: 'q1', option_labels: ['是'] } }] }
beforeEach(() => { mockApi.mockReset() })
it('visually creates a category with text and a pagebreak without activating it', async () => {
  const user = userEvent.setup()
  const published = vi.fn()
  mockApi.mockResolvedValue({})
  render(<PollEditor onPublished={published} onUnauthorized={vi.fn()} />)
  await user.type(screen.getByLabelText('投票标题'), '新的讨论')
  fireEvent.change(screen.getByLabelText('开始时间（本地时间）'), { target: { value: '2026-01-01T12:00' } })
  fireEvent.change(screen.getByLabelText('结束时间（本地时间）'), { target: { value: '2026-12-01T12:00' } })
  await user.click(screen.getByRole('button', { name: '＋ 分类' }))
  await user.type(screen.getByLabelText('分类标题'), '建议')
  const category = within(screen.getByRole('region', { name: '建议编辑' }))
  await user.click(category.getByRole('button', { name: '＋ 填空题' }))
  await user.type(screen.getByLabelText('题目标题'), '你的建议')
  await user.type(screen.getByLabelText('提案人 Minecraft ID'), 'Admin')
  await user.click(category.getByRole('button', { name: '＋ 分页' }))
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  expect(published).toHaveBeenCalledOnce()
  expect(mockApi).toHaveBeenCalledTimes(1)
  const [path, options] = mockApi.mock.calls[0]
  expect(path).toBe('/management/polls')
  const body = JSON.parse(options!.body as string).config
  expect(body.questions[0]).toMatchObject({ type: 'category', title: '建议', questions: [{ type: 'text', title: '你的建议', options: [] }, { type: 'pagebreak' }] })
  expect(JSON.stringify(body)).not.toContain('"key"')
  expect(document.querySelector('textarea')).toBeNull()
})
it('copies with fresh IDs and remapped conditions, and rejects dangling references', async () => {
  const user = userEvent.setup()
  const view = render(<PollEditor initialConfig={config} onPublished={vi.fn()} onUnauthorized={vi.fn()} />)
  mockApi.mockResolvedValue({})
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  const copy = JSON.parse(mockApi.mock.calls[0][1]!.body as string).config
  expect(copy.id).not.toBe(config.id)
  expect(copy.questions[0].id).not.toBe('q1')
  expect(copy.questions[1].condition.question_id).toBe(copy.questions[0].id)
  view.unmount()
  mockApi.mockClear()
  render(<PollEditor initialConfig={config} onPublished={vi.fn()} onUnauthorized={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '删除选择' }))
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('显示条件引用无效')
  expect(mockApi).not.toHaveBeenCalled()
})
it('shows backend errors and reports unauthorized', async () => {
  const user = userEvent.setup()
  const unauthorized = vi.fn()
  mockApi.mockRejectedValueOnce(new Error('格式规则无效')).mockRejectedValueOnce(new ApiError('登录过期', 401))
  render(<PollEditor initialConfig={config} onPublished={vi.fn()} onUnauthorized={unauthorized} />)
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('格式规则无效')
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  expect(unauthorized).toHaveBeenCalledOnce()
})
it('disables duplicate publishing and aborts on unmount', async () => {
  let finish!: (value: unknown) => void
  mockApi.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const published = vi.fn()
  const user = userEvent.setup()
  const view = render(<PollEditor initialConfig={config} onPublished={published} onUnauthorized={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: '创建投票' }))
  expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
  const signal = mockApi.mock.calls[0][1]!.signal!
  view.unmount()
  expect(signal.aborted).toBe(true)
  await act(async () => finish({}))
  expect(published).not.toHaveBeenCalled()
})
