import { validAnswers, type Answers, type Condition, type PollPage, type Question } from './api'

/** Older responses have no page metadata: all real questions belong to one page. */
export function questionPages(questions: { id: string }[], pages?: PollPage[]): PollPage[] {
  return pages?.length ? pages : [{ title: null, question_ids: questions.map(question => question.id) }]
}

export function matchesCondition(condition: Condition, questions: Question[], answers: Answers): boolean {
  const question = questions.find(question => question.id === condition.question_id)
  return question?.options.some(option => condition.option_labels.includes(option.label) && answers[question.id]?.includes(option.id)) ?? false
}

/** Evaluate in order so answers in skipped categories cannot activate later categories. */
export function activePages(questions: Question[], layout: PollPage[], answers: Answers) {
  const valid = validAnswers(questions, answers)
  const active: Answers = {}
  const byId = new Map(questions.map(question => [question.id, question]))
  const pages: PollPage[] = []
  for (const page of layout) {
    if (page.condition && !matchesCondition(page.condition, questions, active)) continue
    const ids = page.question_ids.filter(id => {
      const question = byId.get(id)
      if (!question || (question.hidden && (!question.condition || !matchesCondition(question.condition, questions, active)))) return false
      active[id] = valid[id] ?? []
      return true
    })
    pages.push({ ...page, question_ids: ids })
  }
  // Boundary-only gates remain active even if their neighboring category is skipped,
  // but must not create a blank page in the UI.
  const visible: PollPage[] = []
  let pending: Condition[] = []
  for (const page of pages) {
    if (!page.question_ids.length) {
      const gates = [...(page.gates ?? []), ...(page.exit_gates ?? [])]
      const previous = visible[visible.length - 1]
      if (previous) previous.exit_gates = [...(previous.exit_gates ?? []), ...gates]
      else pending.push(...gates)
    } else {
      visible.push({ ...page, gates: [...pending, ...(page.gates ?? [])] })
      pending = []
    }
  }
  return { pages: visible.length ? visible : [{ title: null, question_ids: [], exit_gates: pending }], answers: active }
}

export function questionPage(pages: PollPage[], id: string): number {
  return Math.max(0, pages.findIndex(page => page.question_ids.includes(id)))
}
