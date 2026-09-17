import { expect, it } from 'vitest'
import { activePages, questionPage, questionPages } from './pages'
import type { Question } from './api'

it('旧接口与空题目仍提供一页', () => {
  expect(questionPages([{ id: 'a' }, { id: 'b' }])).toEqual([{ title: null, question_ids: ['a', 'b'] }])
  expect(questionPages([], [])).toEqual([{ title: null, question_ids: [] }])
})
it('保留服务端分类分页顺序并定位问题', () => {
  const pages = [{ title: '分类', question_ids: ['a'] }, { title: '分类', question_ids: ['b'] }, { title: null, question_ids: ['c'] }]
  expect(questionPages([{ id: 'a' }, { id: 'b' }, { id: 'c' }], pages)).toEqual(pages)
  expect(questionPage(pages, 'b')).toBe(1)
})

it('按顺序隐藏依赖题并删除空页，全部隐藏仍安全显示一页', () => {
  const question: Question = { id: 'q1', title: 'Q', type: 'single', required: true, proposer: 'Player', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
  const questions: Question[] = [question,
    { ...question, id: 'q2', hidden: true, condition: { question_id: 'q1', option_labels: ['B'] } },
    { ...question, id: 'q3', hidden: true, condition: { question_id: 'q2', option_labels: ['B'] } },
  ]
  const layout = questionPages(questions, questions.map(q => ({ title: null, question_ids: [q.id] })))
  expect(activePages(questions, layout, { q1: ['a'], q2: ['b'], q3: ['b'] })).toMatchObject({
    pages: [{ question_ids: ['q1'] }], answers: { q1: ['a'] },
  })
  const hidden = activePages([{ ...question, hidden: true }], [{ title: null, question_ids: ['q1'] }], { q1: ['a'] })
  expect(hidden.pages).toHaveLength(1)
  expect(hidden.pages[0].question_ids).toEqual([])
  expect(hidden.answers).toEqual({})
})

it('保留分类外的独立分页条件，但不显示空白页', () => {
  const question: Question = { id: 'q1', title: 'Q', type: 'single', required: true, proposer: 'Player', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
  const condition = { question_id: 'q1', option_labels: ['B'] }
  const layout = [
    { title: null, question_ids: ['q1'] },
    { title: 'Skipped', question_ids: ['q2'], condition },
    { title: null, question_ids: [], exit_gates: [condition] },
    { title: null, question_ids: ['q3'] },
  ]
  const result = activePages([question, { ...question, id: 'q2' }, { ...question, id: 'q3' }], layout, { q1: ['a'], q2: ['b'] })
  expect(result.pages.map(page => page.question_ids)).toEqual([['q1'], ['q3']])
  expect(result.pages[0].exit_gates).toEqual([condition])
  expect(result.answers).toEqual({ q1: ['a'], q3: [] })
  expect(layout[0]).not.toHaveProperty('exit_gates')
})
