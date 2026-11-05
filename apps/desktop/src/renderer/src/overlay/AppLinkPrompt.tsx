import { ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import { APP_LINK_POPUP, type AppLinkPromptState } from '@scbrowser/shared'

/** Long enough that a click meant for the page underneath can't land on Open. */
const ARM_DELAY_MS = 500

/** Everything but the app's name comes from the link, so it's only ever shown as text. */
export function AppLinkPrompt({ prompt, x, y }: { prompt: AppLinkPromptState; x: number; y: number }) {
  const [always, setAlways] = useState(false)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  const answer = (choice: 'open' | 'always' | 'cancel') => void window.scbOverlay.invoke('overlay:app-link-answer', choice)
  return (
    <div
      role="alertdialog"
      aria-label="Open in another app"
      className="sc-glass-strong sc-tooltip absolute flex flex-col justify-between gap-2 rounded-lg p-3 shadow-3"
      style={{ left: x, top: y, width: APP_LINK_POPUP.width, height: APP_LINK_POPUP.height }}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <ExternalLink aria-hidden size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="truncate font-medium">{prompt.host ? `${prompt.host} wants to open ${prompt.appName}` : `Open ${prompt.appName}?`}</div>
          <div className="truncate text-xs text-text-muted" title={prompt.url}>
            {prompt.url}
          </div>
        </div>
      </div>
      {prompt.host && (
        <label className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          <span className="truncate">Always allow {prompt.scheme}: links from this site</span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={() => answer('cancel')}>Cancel</Button>
        <Button variant="primary" disabled={!armed} onClick={() => answer(always ? 'always' : 'open')}>
          Open
        </Button>
      </div>
    </div>
  )
}
