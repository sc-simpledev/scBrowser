import { useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import { api } from '../api'

/**
 * A minute on the site, after a short wait that doubles each time today. Waiting a few seconds is
 * often enough to remember why the site was blocked.
 */
function OneMoreMinute({ url }: { url: string }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (left === null || left <= 0) return
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  if (left === null)
    return <Button onClick={() => void api().invoke('blocker:grace-wait', url).then(setLeft)}>One more minute</Button>
  if (left > 0)
    return (
      <Button disabled aria-live="polite" className="tabular-nums">
        Wait {left} s…
      </Button>
    )
  return (
    <Button variant="primary" onClick={() => void api().invoke('blocker:grace', url)}>
      Open for one minute
    </Button>
  )
}

/** Shown instead of a blocked site. Leaving or continuing is always the person's choice. */
export function BlockedPage() {
  const params = new URLSearchParams(location.search)
  const url = params.get('url') ?? ''
  const reason = params.get('reason') ?? ''
  const [message, setMessage] = useState<string | null>(null)
  const host = URL.canParse(url) ? new URL(url).hostname : url

  useEffect(() => {
    document.title = 'Site blocked'
    void api().invoke('blocker:message').then(setMessage)
    void api()
      .invoke('settings:get')
      .then(({ accent }) => {
        document.documentElement.dataset.accent = accent
      })
  }, [])

  return (
    <main className="grid h-full place-items-center p-8">
      <div className="flex max-w-120 flex-col gap-4 text-center">
        <p className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">{host}</p>
        <h1 className="text-xl font-semibold tracking-[-0.03em]">{message}</h1>
        <p className="text-text-muted">{reason}</p>
        <div className="mt-2 flex justify-center gap-2">
          <Button variant="primary" onClick={() => void api().invoke('blocker:leave')}>
            Go to a new tab
          </Button>
          <OneMoreMinute url={url} />
          <Button variant="ghost" onClick={() => void api().invoke('blocker:proceed', url)}>
            Continue for 15 minutes
          </Button>
        </div>
      </div>
    </main>
  )
}
