import { useEffect, useState } from 'react'
import { Button, Switch } from '@scbrowser/ui'
import { BROWSER_FLAGS } from '@scbrowser/shared'
import { api } from '../api'

export function FlagsPage() {
  const [flags, setFlags] = useState<string[]>([])
  const [changed, setChanged] = useState(false)

  useEffect(() => void api().invoke('flags:get').then(setFlags), [])

  const toggle = (id: string, enabled: boolean) => {
    void api().invoke('flags:set', id, enabled)
    setFlags(enabled ? [...flags, id] : flags.filter((flag) => flag !== id))
    setChanged(true)
  }

  const list = (flagsToShow: typeof BROWSER_FLAGS) => (
    <ul className="flex flex-col rounded-lg shadow-1">
      {flagsToShow.map((flag) => (
        <li key={flag.id} className="flex min-h-12 items-center justify-between gap-6 border-b border-border px-3 py-2 last:border-b-0">
          <div className="min-w-0">
            <div>{flag.name}</div>
            <div className="text-xs text-text-faint">{flag.description}</div>
          </div>
          <Switch label={flag.name} checked={flags.includes(flag.id)} onChange={(enabled) => toggle(flag.id, enabled)} />
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <p className="text-text-muted">Experimental switches. They may cause problems, and take effect after a restart.</p>
      {list(BROWSER_FLAGS.filter((flag) => !flag.fun))}
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Just for fun</h2>
      {list(BROWSER_FLAGS.filter((flag) => flag.fun))}
      {changed && (
        <div className="sticky bottom-4">
          <Button variant="primary" onClick={() => void api().invoke('browser:restart')}>
            Restart now
          </Button>
        </div>
      )}
    </>
  )
}
