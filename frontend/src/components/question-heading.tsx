import type { Question } from '@/lib/api'

export function QuestionHeading({ question, index }: { question: Question; index: number }) {
  const description = question.description ?? question.proposer ?? ''
  return <div className="mb-6 flex gap-4 sm:gap-6">
    <span className="pt-1 font-mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
    <div className="min-w-0 flex-1">
      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs"><span>{{ single: '单选', multiple: '多选', text: '填空' }[question.type]}</span><span className="text-neutral-300">/</span><span className={question.required ? 'font-medium' : 'text-muted-foreground'}>{question.required ? '必填' : '选填'}</span></div>
      <h2 id={`question-${question.id}`} className="break-words text-xl font-medium leading-relaxed sm:text-2xl">{question.title}</h2>
      {description && <p className="mt-3 whitespace-pre-wrap break-words border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </div>
  </div>
}
