import { Download, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, Switch } from '@scbrowser/ui'
import { api } from './api'
import { ConfirmButton } from './ConfirmButton'

/** Fired on the page after "Remove VPN" or "Install VPN", so the sidebar can follow without a reload. */
export const VPN_INSTALLED_EVENT = 'sc-vpn-installed'

export function setVpnInstalled(installed: boolean, forget = false): Promise<void> {
  const done = installed ? api().invoke('vpn:install') : api().invoke('vpn:uninstall', forget)
  return done.then(() => {
    window.dispatchEvent(new CustomEvent(VPN_INSTALLED_EVENT, { detail: installed }))
  })
}

/** Whether the VPN is installed, following "Remove VPN" and "Install VPN" on this page. Null while unknown. */
export function useVpnInstalled(): boolean | null {
  const [installed, setInstalled] = useState<boolean | null>(null)
  useEffect(() => {
    void api()
      .invoke('settings:get')
      .then(({ vpnInstalled }) => setInstalled(vpnInstalled))
    const follow = (event: Event) => setInstalled((event as CustomEvent<boolean>).detail)
    window.addEventListener(VPN_INSTALLED_EVENT, follow)
    return () => window.removeEventListener(VPN_INSTALLED_EVENT, follow)
  }, [])
  return installed
}

/** What sc://vpn shows once the VPN is removed. */
export function VpnRemoved({ onInstalled }: { onInstalled: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-label="VPN removed" className="flex flex-col items-start gap-3 rounded-lg bg-surface p-4 shadow-1">
      <Globe aria-hidden size={20} strokeWidth={1.5} className="text-text-faint" />
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">The VPN is removed</h2>
        <p className="text-sm text-text-muted">Its button, menu rows and Xray core are switched off, and nothing goes through it. Install it again to bring it all back, with any connections you kept.</p>
      </div>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void setVpnInstalled(true)
            .then(onInstalled)
            .finally(() => setBusy(false))
        }}
      >
        <Download aria-hidden size={13} strokeWidth={1.75} />
        {busy ? 'Installing…' : 'Install VPN'}
      </Button>
    </section>
  )
}

/** The end of sc://vpn: takes the VPN away entirely, for anyone who doesn't want it. */
export function RemoveVpn({ onRemoved }: { onRemoved: () => void }) {
  const [forget, setForget] = useState(false)
  return (
    <section aria-label="Remove VPN" className="flex flex-col gap-3 rounded-lg bg-surface p-3 shadow-1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div>Remove VPN</div>
          <div className="text-xs text-text-faint">Turns it off, stops Xray, and hides the VPN button, menu rows and this page’s settings. Install VPN brings it back.</div>
        </div>
        <ConfirmButton confirmLabel="Remove the VPN?" onConfirm={() => void setVpnInstalled(false, forget).then(onRemoved)}>
          Remove VPN
        </ConfirmButton>
      </div>
      <label className="flex items-center justify-between gap-3 text-xs text-text-muted">
        Also delete my saved connections
        <Switch label="Also delete my saved connections" checked={forget} onChange={setForget} />
      </label>
    </section>
  )
}
