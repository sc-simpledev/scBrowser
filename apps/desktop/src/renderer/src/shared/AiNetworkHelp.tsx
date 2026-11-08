import { ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@scbrowser/ui'
import { STARTING_VPN_NOTE, type VpnSummary } from '@scbrowser/shared'

export interface AiNetworkHelpProps {
  message: string
  /** Whether the person has VPN connections of their own; null while unknown. */
  loadHasVpn: () => Promise<boolean>
  /** Turns the VPN on: theirs, or the starting (Default) one when they have none. */
  useVpn: () => Promise<VpnSummary>
  onRetry: () => void
  onOpenVpn: () => void
  compact?: boolean
}

/**
 * Shown when AI couldn't be reached at all. Some networks (schools, workplaces, some countries)
 * block Cloudflare Workers, where scTerra AI runs, and a VPN usually gets around that.
 */
export function AiNetworkHelp({ message, loadHasVpn, useVpn, onRetry, onOpenVpn, compact }: AiNetworkHelpProps) {
  const [hasVpn, setHasVpn] = useState<boolean | null>(null)
  const [state, setState] = useState<'idle' | 'connecting' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadHasVpn().then(setHasVpn, () => setHasVpn(false))
  }, [loadHasVpn])

  const turnOn = () => {
    setState('connecting')
    setError(null)
    void useVpn()
      .then((summary) => {
        if (summary.enabled) {
          setState('idle')
          onRetry()
        } else {
          setState('failed')
          setError(summary.error ?? "The VPN didn't connect.")
        }
      })
      .catch((reason: Error) => {
        setState('failed')
        setError(reason.message.replace(/^.*Error: /, ''))
      })
  }

  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
      <div className="flex items-start gap-2.5">
        <ShieldCheck aria-hidden size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="font-medium text-text">{message}</div>
          <div className="text-text-muted">Some networks block AI services. Turn on a VPN to use AI?</div>
          {hasVpn === false && <div className="text-2xs text-text-faint">You haven’t added a VPN, so scTerra will use its starting connection, called Default. {STARTING_VPN_NOTE}</div>}
          {error && <div className="text-danger">{error}</div>}
        </div>
      </div>
      <div className={compact ? 'flex flex-wrap gap-1.5' : 'flex flex-wrap justify-end gap-1.5'}>
        <Button variant="ghost" onClick={onOpenVpn}>
          VPN settings
        </Button>
        <Button variant="ghost" onClick={onRetry} disabled={state === 'connecting'}>
          Try again
        </Button>
        <Button variant="primary" onClick={turnOn} disabled={state === 'connecting' || hasVpn === null}>
          {state === 'connecting' ? 'Connecting…' : hasVpn === false ? 'Use starting VPN connection' : 'Turn on VPN and try again'}
        </Button>
      </div>
    </div>
  )
}
