import { useEffect, useState } from 'react'
import type { UpdateState } from '@scbrowser/shared'

/**
 * Installing can hold up the main process until the app restarts. This page's own process carries
 * on, so the window shows what's happening rather than looking frozen.
 */
export function UpdatingScreen() {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.scb.invoke('updates:state').then(setUpdate)
    return window.scb.on('updates:changed', setUpdate)
  }, [])
  if (update?.phase !== 'installing') return null
  return (
    <div role="status" className="sc-drag absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-surface text-center">
      <span aria-hidden className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-accent motion-reduce:animate-none" />
      <p className="font-medium">Updating scTerra{update.version ? ` to ${update.version}` : ''}</p>
      <p className="text-xs text-text-muted">It reopens by itself when it's finished.</p>
    </div>
  )
}
