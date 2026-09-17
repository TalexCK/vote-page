import { useState } from 'react'
import { questionPages } from '@/lib/pages'
import { PageNavigation } from './page-navigation'
import type { Results as ResultsData } from '@/lib/api'
import { QuestionHeading } from './question-heading'

export function Results({ results }: { results: ResultsData }) {
  const pages = questionPages(results.questions, results.pages)
  const [page, setPage] = useState(0)
  const current = Math.min(page, pages.length - 1)
  return <>
    <PageNavigation pages={pages} current={current} onChange={setPage} />
    <div className="divide-y border-t">
    {results.questions.map((question, index) => pages[current].question_ids.includes(question.id) && <section key={question.id} className="py-9 sm:py-12" aria-labelledby={`question-${question.id}`}>
      <QuestionHeading question={question} index={index} />
      <div className="sm:ml-10">
        <p className="mb-5 text-xs text-muted-foreground">本题总票数 <span className="ml-2 font-mono text-base text-foreground">{question.total_votes}</span></p>
        <div className="space-y-6">
          {question.options.map(option => {
            const max = Math.max(1, ...question.options.map(item => item.count))
            return <div key={option.id}>
              <div className="mb-2 flex items-start justify-between gap-4 text-sm"><span className="break-words">{option.label}</span><span className="shrink-0 font-mono">{option.count} <span className="font-sans text-xs text-muted-foreground">票</span></span></div>
              <div className="h-1 bg-neutral-200" aria-hidden="true"><div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${option.count / max * 100}%` }} /></div>
              <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5" aria-label={`${option.label}的投票玩家`}>
                {option.voters.length ? option.voters.map(voter => <span key={voter} className="break-all font-mono text-xs leading-5 text-muted-foreground">{voter}</span>) : <span className="text-xs text-muted-foreground">暂无投票</span>}
              </div>
            </div>
          })}
        </div>
      </div>
    </section>)}
    {!results.questions.length && <p className="py-12 text-sm text-muted-foreground">暂无题目</p>}
    </div>
  </>
}
