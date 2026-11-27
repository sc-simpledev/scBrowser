import { SearchX, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@scbrowser/ui'

/**
 * What a list shows with nothing in it: what will be here, and how to put something there. One voice
 * on every page: an icon, a short title, and a line of help. `compact` sits inside a card or panel.
 */
export function EmptyState({ icon: Icon, title, children, compact }: { icon: LucideIcon; title: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div role="status" className={cx('flex flex-col items-center gap-2 text-center', compact ? 'px-4 py-6' : 'rounded-lg border border-dashed border-border px-6 py-10')}>
      <Icon aria-hidden size={18} strokeWidth={1.5} className="text-text-faint" />
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-96 text-xs text-text-muted">{children}</p>}
    </div>
  )
}

/** A search on a list page that found nothing. */
export function NoMatches({ children = 'Try fewer or different words.' }: { children?: ReactNode }) {
  return (
    <EmptyState icon={SearchX} title="Nothing matches that search">
      {children}
    </EmptyState>
  )
}
