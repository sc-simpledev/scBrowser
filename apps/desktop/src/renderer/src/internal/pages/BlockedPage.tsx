import { useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import { api } from '../api'

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
          <Button onClick={() => void api().invoke('blocker:proceed', url)}>Continue to the site</Button>
        </div>
      </div>
    </main>
  )
}
