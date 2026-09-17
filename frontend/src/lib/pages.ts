import type { PollPage } from './api'

/** Older responses have no page metadata: all real questions belong to one page. */
export function questionPages(questions: { id: string }[], pages?: PollPage[]): PollPage[] {
  return pages?.length ? pages : [{ title: null, question_ids: questions.map(question => question.id) }]
}

export function questionPage(pages: PollPage[], id: string): number {
  return Math.max(0, pages.findIndex(page => page.question_ids.includes(id)))
}
