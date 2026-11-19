import { Check, ChevronRight, CircleAlert, Cloud, ExternalLink, GitBranch, GitPullRequest, Download, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, cx } from '@scbrowser/ui'
import type { CoderCloudRun, CoderEvent } from '@scbrowser/shared'
import { ReplyMarkdown } from '../../shared/ReplyContent'
import { Spinner, useElapsed } from './CodeParts'
import { applyEvent, emptyState, shortDuration } from './codeState'

const STATE_WORDS: Record<CoderCloudRun['state'], string> = {
  starting: 'Starting in the cloud',
  queued: 'Waiting for GitHub to start it',
  working: 'Working in the cloud',
  done: 'Finished in the cloud',
  failed: 'Stopped in the cloud',
  cancelled: 'Cancelled'
}

export interface CloudCardProps {
  run: CoderCloudRun
  /** What it did, read back from its log once it's finished. Undefined until asked for. */
  events?: CoderEvent[] | null
  onOpen: (url: string) => void
  onCancel: () => void
  onPr: () => void
  onFetch: () => void
  onSteps: () => void
}

/** A task running on GitHub Actions: how it's going, then what it did and where its work is. */
export function CloudCard({ run, events, onOpen, onCancel, onPr, onFetch, onSteps }: CloudCardProps) {
  const [open, setOpen] = useState(false)
  const finished = run.state === 'done' || run.state === 'failed' || run.state === 'cancelled'
  const elapsed = useElapsed(run.startedAt, run.endedAt)
  const steps = useMemo(() => {
    if (!events) return null
    const state = events.reduce(applyEvent, emptyState())
    return state.items.filter((item) => item.kind === 'tool' && item.tool !== 'todo' && !item.agent)
  }, [events])
  const repoUrl = `https://github.com/${run.repo}`
  const branchUrl = `${repoUrl}/tree/${run.branch.split('/').map(encodeURIComponent).join('/')}`
  return (
    <section aria-label="Cloud run" className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex min-w-0 items-start gap-2.5 px-2.5 py-2">
        <span className={cx('mt-px grid size-5 shrink-0 place-items-center rounded-md', finished ? 'bg-surface-hover text-text-muted' : 'bg-accent-soft text-accent')}>
          <Cloud aria-hidden size={12} strokeWidth={1.75} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 text-xs">
            {!finished && <Spinner className="size-2.5 border-[1.5px]" label={STATE_WORDS[run.state]} />}
            {run.state === 'done' && <Check aria-hidden size={12} strokeWidth={2} className="shrink-0 text-success" />}
            {run.state === 'failed' && <CircleAlert aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-danger" />}
            {run.state === 'cancelled' && <X aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
            <span className="shrink-0 font-medium">{STATE_WORDS[run.state]}</span>
            <span aria-hidden className="text-text-faint">·</span>
            <span className="shrink-0 text-text-faint tabular-nums">{shortDuration(elapsed)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-text-faint">
            <GitBranch aria-hidden size={11} strokeWidth={1.75} className="shrink-0" />
            <span className="min-w-0 truncate font-mono">{run.branch}</span>
            <span className="shrink-0">from {run.base}</span>
          </span>
        </span>
        {run.runUrl && (
          <Button variant="ghost" className="h-6.5 px-2 text-xs" onClick={() => onOpen(run.runUrl!)}>
            Log
            <ExternalLink aria-hidden size={11} strokeWidth={1.75} />
          </Button>
        )}
      </div>
      {(run.warning || run.error) && (
        <div className="flex flex-col gap-1 border-t border-border px-2.5 py-2 text-2xs">
          {run.warning && <p className="text-text-muted">{run.warning}</p>}
          {run.error && <p className="text-danger">{run.error}</p>}
        </div>
      )}
      {!finished && <p className="border-t border-border px-2.5 py-2 text-2xs text-text-faint">You can close scTerra or turn this computer off. It carries on, and this shows what it did when you’re back.</p>}
      {run.summary && (
        <div className="sc-scroll-quiet max-h-80 overflow-y-auto border-t border-border px-2.5 py-2 text-sm select-text">
          <ReplyMarkdown text={run.summary} onOpenLink={onOpen} />
        </div>
      )}
      {finished && run.runId && (
        <div className="border-t border-border">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => {
              if (!open && events === undefined) onSteps()
              setOpen(!open)
            }}
            className="flex h-7.5 w-full min-w-0 items-center gap-2 px-2.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-hover"
          >
            <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform', open && 'rotate-90')} />
            <span className="min-w-0 flex-1 truncate">{steps ? `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` : 'Steps it took'}</span>
          </button>
          {open && (
            <div className="sc-scroll-quiet max-h-64 overflow-y-auto px-2.5 pb-2">
              {events === undefined || (events === null && !steps) ? (
                <p className="text-2xs text-text-faint">{events === null ? 'GitHub didn’t give the log back.' : 'Reading the log…'}</p>
              ) : steps && steps.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {steps.map((item) =>
                    item.kind === 'tool' ? (
                      <li key={item.id} className="flex min-w-0 items-center gap-2 text-2xs">
                        {item.ok === false ? <X aria-hidden size={11} strokeWidth={2} className="shrink-0 text-danger" /> : <Check aria-hidden size={11} strokeWidth={2} className="shrink-0 text-text-faint" />}
                        <span className="min-w-0 truncate text-text-muted">{item.summary}</span>
                      </li>
                    ) : null
                  )}
                </ul>
              ) : (
                <p className="text-2xs text-text-faint">No steps were logged.</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border px-2.5 py-2">
        {!finished && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {run.state === 'done' && (
          <>
            <Button variant="ghost" onClick={() => onOpen(branchUrl)}>
              View on GitHub
            </Button>
            <Button variant="ghost" onClick={onFetch} title={`git fetch origin ${run.branch}`}>
              <Download aria-hidden size={12} strokeWidth={1.75} />
              Fetch the branch
            </Button>
            <Button variant="primary" onClick={onPr}>
              <GitPullRequest aria-hidden size={12} strokeWidth={1.75} />
              {run.prUrl ? 'Open pull request' : 'Make a pull request'}
            </Button>
          </>
        )}
        {(run.state === 'failed' || run.state === 'cancelled') && run.runUrl && (
          <Button variant="ghost" onClick={() => onOpen(run.runUrl!)}>
            See why on GitHub
          </Button>
        )}
      </div>
    </section>
  )
}
