import { useEffect, useRef } from 'react'
import type { PollPage } from '@/lib/api'
import { Button } from './ui/button'

export function PageNavigation({ pages, current, onChange, disabled = false }: {
  pages: PollPage[]; current: number; onChange: (page: number) => void; disabled?: boolean
}) {
  const heading = useRef<HTMLDivElement>(null)
  const previous = useRef(current)
  useEffect(() => {
    if (previous.current !== current) heading.current?.focus()
    previous.current = current
  }, [current])
  return <div className="mb-6 border-t pt-6">
    <div ref={heading} tabIndex={-1} className="focus-visible:outline-none" aria-live="polite">
      {pages[current].title && <h2 className="mb-4 break-words font-display text-2xl">{pages[current].title}</h2>}
      <p className="font-mono text-xs text-muted-foreground">第 {current + 1} / {pages.length} 页</p>
    </div>
    {pages.length > 1 && <nav aria-label="分页" className="mt-4 flex justify-between gap-4">
      <Button type="button" variant="outline" size="sm" disabled={disabled || current === 0} onClick={() => onChange(current - 1)}>上一页</Button>
      <Button type="button" variant="outline" size="sm" disabled={disabled || current === pages.length - 1} onClick={() => onChange(current + 1)}>下一页</Button>
    </nav>}
  </div>
}
