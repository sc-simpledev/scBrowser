import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** What a list page shows with nothing in it: what will be here, and how to put something there. */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span aria-hidden className="grid size-9 place-items-center rounded-md bg-surface-hover text-text-muted">
        <Icon size={16} strokeWidth={1.75} />
      </span>
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-96 text-xs text-text-muted">{children}</p>}
    </div>
  )
}
