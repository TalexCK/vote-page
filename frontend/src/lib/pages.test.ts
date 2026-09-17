import { expect, it } from 'vitest'
import { questionPage, questionPages } from './pages'

it('旧接口与空题目仍提供一页', () => {
  expect(questionPages([{ id: 'a' }, { id: 'b' }])).toEqual([{ title: null, question_ids: ['a', 'b'] }])
  expect(questionPages([], [])).toEqual([{ title: null, question_ids: [] }])
})
it('保留服务端分类分页顺序并定位问题', () => {
  const pages = [{ title: '分类', question_ids: ['a'] }, { title: '分类', question_ids: ['b'] }, { title: null, question_ids: ['c'] }]
  expect(questionPages([{ id: 'a' }, { id: 'b' }, { id: 'c' }], pages)).toEqual(pages)
  expect(questionPage(pages, 'b')).toBe(1)
})
