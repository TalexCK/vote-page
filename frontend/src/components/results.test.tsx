import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import type { Results as ResultsData } from '@/lib/api'
import { Results } from './results'

const results: ResultsData = {
  id: 'one', title: '结果',
  questions: ['a', 'b', 'c'].map(id => ({ id, title: `问题${id}`, type: 'single', required: true, proposer: '', total_votes: 1, options: [{ id: 'yes', label: '赞成', count: 1, voters: ['player'] }] })),
  pages: [{ title: null, question_ids: ['a'] }, { title: '分类', question_ids: ['b'] }, { title: '分类', question_ids: ['c'] }],
}
it('结果分页只显示当前问题，分类内分页保持标题和全局编号', async () => {
  const user = userEvent.setup()
  const view = render(<Results key={results.id} results={results} />)
  expect(screen.getByText('问题a')).toBeInTheDocument()
  expect(screen.queryByText('问题b')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('分类')).toBeInTheDocument()
  expect(screen.getByText('02')).toBeInTheDocument()
  expect(screen.queryByText('问题a')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByText('分类')).toBeInTheDocument()
  expect(screen.getByText('03')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '上一页' }))
  expect(screen.getByText('问题b')).toBeInTheDocument()
  view.rerender(<Results key="new" results={{ ...results, id: 'new' }} />)
  expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument()
})
it('填空结果按原文显示提交者，不渲染回答中的 HTML', () => {
  render(<Results results={{ id: 'text', title: '结果', questions: [{
    id: 'q', title: '留言', type: 'text', required: false, description: '请勿填写个人信息。', options: [], total_votes: 1,
    responses: [{ player_id: 'Player', text: '<script>alert(1)</script>' }],
  }] }} />)
  expect(screen.getByText('填空')).toBeInTheDocument()
  expect(screen.getByText('请勿填写个人信息。')).toHaveClass('text-muted-foreground', 'border-l-2')
  expect(screen.queryByText('提出者')).not.toBeInTheDocument()
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
  expect(screen.getByText('Player')).toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
})

it('没有 pages 的旧结果一次显示全部问题', () => {
  render(<Results results={{ ...results, pages: undefined }} />)
  for (const id of ['a', 'b', 'c']) expect(screen.getByText(`问题${id}`)).toBeInTheDocument()
  expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument()
})
