import { ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, cx, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import {
  CONTAINERS, STARTING_VPN_NOTE, byPing, parseBypassList, type Settings, type VpnAddResult, type VpnConnection, type VpnGroup, type VpnMethod, type VpnPingProgress, type VpnPings, type VpnScope, type VpnState } from '@scbrowser/shared'
import { api } from '../api'

/** Subscriptions can hold thousands, and the fastest are what matter. */
const VISIBLE_ROWS = 100
const PING_REFRESH_MS = 500
const MIN_PING_TIMEOUT = 200
const MAX_PING_TIMEOUT = 30_000

const cleanError = (error: Error) => error.message.replace(/^.*Error: /, '')

function pingText(ping: number | null | undefined) {
  if (ping === undefined) return ''
  return ping === null ? 'Not working' : `${ping} ms`
}

function ConnectionRow({ connection, active, ping, groups, onSelect, reload }: { connection: VpnConnection; active: boolean; ping: number | null | undefined; groups: VpnGroup[]; onSelect: () => void; reload: () => void }) {
  return (
    <li className="group flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-surface-hover">
      <input type="radio" name="vpn-connection" aria-label={`Use ${connection.name}`} checked={active} onChange={onSelect} className="accent-(--sc-accent)" />
      <div className="min-w-0 flex-1">
        <div className="truncate">{connection.name}</div>
        <div className="truncate text-xs text-text-faint">
          {connection.protocol} · {connection.host}:{connection.port}
        </div>
      </div>
      <span className="shrink-0 text-xs text-text-muted tabular-nums">{pingText(ping)}</span>
      {groups.length > 0 && (
        <Select
          aria-label={`Group for ${connection.name}`}
          className="h-7 max-w-28 text-xs"
          value={connection.groupId ?? ''}
          onChange={(e) => void api().invoke('vpn:move', connection.id, e.target.value || null).then(reload)}
        >
          <option value="">No group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      )}
      <IconButton size="sm" label={`Remove ${connection.name}`} onClick={() => void api().invoke('vpn:remove', connection.id).then(reload)}>
        <X size={12} strokeWidth={2} />
      </IconButton>
    </li>
  )
}

function ConnectionList({ title, group, connections, state, pings, progress, startPing, reload }: { title: string; group: VpnGroup | null; connections: VpnConnection[]; state: VpnState; pings: VpnPings; progress: VpnPingProgress; startPing: (ids: string[]) => void; reload: () => void }) {
  const [filter, setFilter] = useState('')
  const [hideDead, setHideDead] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const shown = useMemo(() => {
    const needle = filter.toLowerCase()
    return byPing(connections.filter((c) => `${c.name} ${c.host}`.toLowerCase().includes(needle) && !(hideDead && pings[c.id] === null)), pings)
  }, [connections, filter, pings, hideDead])

  const select = (id: string) => void api().invoke('vpn:select', id).then(reload)
  const fastest = shown[0] && pings[shown[0].id] ? shown[0] : null

  return (
    <section aria-label={title} className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-semibold">
          {title} <span className="font-normal text-text-faint">{connections.length}</span>
        </h2>
        {fastest && <Button variant="ghost" onClick={() => select(fastest.id)}>Use fastest</Button>}
        {connections.some((c) => pings[c.id] === null) && (
          <Button variant="ghost" aria-pressed={hideDead} onClick={() => setHideDead(!hideDead)}>
            {hideDead ? 'Show all' : 'Hide not working'}
          </Button>
        )}
        <Button disabled={progress.running || connections.length === 0} onClick={() => startPing(connections.map(({ id }) => id))}>
          Ping
        </Button>
        {group?.subscription && (
          <Button
            variant="ghost"
            onClick={() => {
              setProblem(null)
              void api().invoke('vpn:refresh', group.id).then(reload).catch((error: Error) => setProblem(cleanError(error)))
            }}
          >
            Refresh
          </Button>
        )}
        {group && (
          <Button variant="ghost" onClick={() => void api().invoke('vpn:remove-group', group.id).then(reload)}>
            Delete group
          </Button>
        )}
      </div>
      {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
      {connections.length > 10 && <Input aria-label={`Find in ${title}`} placeholder="Find by name or address" value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <ul>
        {shown.slice(0, VISIBLE_ROWS).map((connection) => (
          <ConnectionRow key={connection.id} connection={connection} active={connection.id === state.activeId} ping={pings[connection.id]} groups={state.groups} onSelect={() => select(connection.id)} reload={reload} />
        ))}
      </ul>
      {shown.length > VISIBLE_ROWS && <p className="text-xs text-text-faint">Showing the first {VISIBLE_ROWS}. Ping to bring the fastest to the top, or search.</p>}
    </section>
  )
}

const ROUTE_NOTES: Record<string, string> = {
  browser: 'Only scTerra uses this, not other apps.',
  proxy: 'Apps that follow the system proxy use this. Your setting is put back when the VPN turns off.',
  tun: 'Every app on this computer uses this.'
}

function RouteOption({ name, label, note, checked, disabled, onSelect }: { name: string; label: string; note: string; checked: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <label className={cx('flex items-start gap-2.5 rounded-md px-2 py-1.5', disabled ? 'opacity-60' : 'hover:bg-surface-hover')}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onSelect} className="mt-0.5 accent-(--sc-accent)" />
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block text-xs text-text-faint">{note}</span>
      </span>
    </label>
  )
}

/** Just the browser by default. Anything wider is a deliberate choice, with the cost of each spelled out. */
function RouteChoice({ state, setState, reload }: { state: VpnState; setState: (state: VpnState) => void; reload: () => void }) {
  // Shown straight away, as reconnecting can take a while, or wait on a password.
  const set = (scope: VpnScope, method: VpnMethod) => {
    setState({ ...state, scope, method })
    void api().invoke('vpn:set-route', scope, method).then(reload)
  }
  return (
    <section aria-label="What the VPN covers" className="flex flex-col gap-1 rounded-lg bg-surface p-3 shadow-1">
      <h2 className="px-2 pb-1 text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">What it covers</h2>
      <RouteOption name="vpn-scope" label="Just scTerra" note="Your other apps keep their normal connection." checked={state.scope === 'browser'} onSelect={() => set('browser', state.method)} />
      <RouteOption name="vpn-scope" label="This whole computer" note="Other apps go through the connection too." checked={state.scope === 'computer'} onSelect={() => set('computer', state.method)} />
      {state.scope === 'computer' && (
        <div className="mt-1 ml-5 flex flex-col gap-1 border-l border-border pl-3">
          <RouteOption
            name="vpn-method"
            label="System proxy"
            note={state.unavailable.proxy ?? 'Needs no password. Apps that ignore the system proxy, and most command-line tools, stay on your normal connection.'}
            checked={state.method === 'proxy'}
            disabled={!!state.unavailable.proxy}
            onSelect={() => set('computer', 'proxy')}
          />
          <RouteOption
            name="vpn-method"
            label="TUN"
            note={state.unavailable.tun ?? 'Catches every app through a virtual network device. Asks for your password each time it connects, and pings go through the connection while it’s on.'}
            checked={state.method === 'tun'}
            disabled={!!state.unavailable.tun}
            onSelect={() => set('computer', 'tun')}
          />
        </div>
      )}
    </section>
  )
}

/** Saved as it changes, so there's nothing to forget to press. */
function Conveniences({ usesTun, computerWide }: { usesTun: boolean; computerWide: boolean }) {
  const [settings, setSettings] = useState<Pick<Settings, 'vpnAutoConnect' | 'vpnAutoFastest' | 'vpnFailover' | 'vpnBypass' | 'vpnDirectContainers'> | null>(null)
  const [bypass, setBypass] = useState('')
  useEffect(() => {
    void api().invoke('settings:get').then((next) => {
      setSettings(next)
      setBypass(next.vpnBypass.join('\n'))
    })
  }, [])
  if (!settings) return null
  const change = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch })
    void api().invoke('settings:set', patch)
  }
  return (
    <section aria-label="Convenience" className="flex flex-col gap-3 rounded-lg bg-surface p-3 shadow-1">
      <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Convenience</h2>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div>Connect when scTerra starts</div>
          <div className="text-xs text-text-faint">Pages wait until it’s connected, and stay blocked if it can’t.{usesTun && ' With TUN, this asks for your password at every start.'}</div>
        </div>
        <Switch label="Connect when scTerra starts" checked={settings.vpnAutoConnect} onChange={(vpnAutoConnect) => change({ vpnAutoConnect })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div>Pick the fastest when turning on</div>
          <div className="text-xs text-text-faint">Pings the first 300 connections in the same group, and uses the quickest that works.</div>
        </div>
        <Switch label="Pick the fastest when turning on" checked={settings.vpnAutoFastest} onChange={(vpnAutoFastest) => change({ vpnAutoFastest })} />
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div>Move to another server if this one dies</div>
          <div className="text-xs text-text-faint">Checks every 30 seconds, and only moves within the same group.</div>
        </div>
        <Switch label="Move to another server if this one dies" checked={settings.vpnFailover} onChange={(vpnFailover) => change({ vpnFailover })} />
      </div>
      <label className="flex flex-col gap-1.5">
        <span>Sites that skip the VPN</span>
        <textarea
          aria-label="Sites that skip the VPN"
          rows={3}
          spellCheck={false}
          placeholder={'One per line, like bank.example.com'}
          className="w-full resize-y rounded-md border border-border bg-field p-2 font-mono text-xs outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
          value={bypass}
          onChange={(e) => setBypass(e.target.value)}
          onBlur={() => {
            const vpnBypass = parseBypassList(bypass)
            setBypass(vpnBypass.join('\n'))
            change({ vpnBypass })
          }}
        />
        <span className="text-xs text-text-faint">
          Subdomains are included. These sites see your real address{computerWide ? '. This only applies inside scTerra, not to other apps' : ''}{usesTun ? ', though with TUN they still go through the connection' : ''}.
        </span>
      </label>
      <div role="group" aria-label="Containers" className="flex flex-col gap-1.5">
        <span>Containers that use the VPN</span>
        <div className="flex flex-wrap gap-1.5">
          {CONTAINERS.map((container) => {
            const on = !settings.vpnDirectContainers.includes(container.id)
            return (
              <button
                key={container.id}
                type="button"
                aria-pressed={on}
                onClick={() => change({ vpnDirectContainers: on ? [...settings.vpnDirectContainers, container.id] : settings.vpnDirectContainers.filter((id) => id !== container.id) })}
                className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${on ? 'border-accent bg-accent-soft text-text' : 'border-border text-text-muted hover:bg-surface-hover hover:text-text'}`}
              >
                <span aria-hidden className="size-2 rounded-full" style={{ background: `oklch(0.65 0.14 ${container.hue})` }} />
                {container.name}
              </button>
            )
          })}
        </div>
        <span className="text-xs text-text-faint">
          {computerWide ? 'With the whole computer covered, every container goes through the connection.' : 'Turn one off to send its tabs directly, with your real address, like a bank in its own container.'}
        </span>
      </div>
    </section>
  )
}

/** For someone who hasn't added a VPN: free public servers from a community list, named Default. */
function StartingVpn({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section aria-label="Starting VPN connection" className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="font-medium">No VPN of your own yet?</div>
          <div className="text-xs text-text-muted">Use a starting connection from a public list of free servers. It’s added as a group called Default, and scTerra picks the fastest one that works.</div>
        </div>
        <Button
          variant="primary"
          className="shrink-0 whitespace-nowrap"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api()
              .invoke('vpn:use-default')
              .finally(() => {
                setBusy(false)
                onDone()
              })
          }}
        >
          {busy ? 'Finding a server…' : 'Use starting VPN connection'}
        </Button>
      </div>
      <p className="text-2xs text-text-faint">{STARTING_VPN_NOTE}</p>
    </section>
  )
}

export function VpnPage() {
  const [state, setState] = useState<VpnState | null>(null)
  const [pings, setPings] = useState<VpnPings>({})
  const [progress, setProgress] = useState<VpnPingProgress>({ running: false, done: 0, total: 0 })
  const [links, setLinks] = useState('')
  const [groupId, setGroupId] = useState('')
  const [subscription, setSubscription] = useState('')
  const [subscriptionName, setSubscriptionName] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [pingTimeout, setPingTimeout] = useState('3000')

  const reload = useCallback(
    () =>
      void api()
        .invoke('vpn:state')
        .then((next) => {
          setState(next)
          setPings(next.pings)
        }),
    []
  )
  useEffect(reload, [reload])
  useEffect(() => {
    void api().invoke('settings:get').then(({ vpnPingTimeout }) => setPingTimeout(String(vpnPingTimeout)))
  }, [])
  /** Anything out of range is pulled back to the nearest allowed value. */
  const savePingTimeout = () => {
    const typed = Math.round(Number(pingTimeout)) || 3000
    const vpnPingTimeout = Math.min(MAX_PING_TIMEOUT, Math.max(MIN_PING_TIMEOUT, typed))
    setPingTimeout(String(vpnPingTimeout))
    return api().invoke('settings:set', { vpnPingTimeout })
  }

  // Results arrive as they come in, so long lists show progress.
  useEffect(() => {
    if (!progress.running) return
    const timer = setInterval(() => {
      void api()
        .invoke('vpn:ping-progress')
        .then((next) => {
          setProgress(next)
          reload()
        })
    }, PING_REFRESH_MS)
    return () => clearInterval(timer)
  }, [progress.running, reload])

  if (!state) return null

  const startPing = (ids: string[]) => {
    setProgress({ running: true, done: 0, total: ids.length })
    void savePingTimeout().then(() => api().invoke('vpn:ping', ids))
  }

  const report = ({ added, skipped }: VpnAddResult) => {
    setNote(`Added ${added}${skipped > 0 ? `, skipped ${skipped} that scTerra can't use or that went over its 20,000 limit` : ''}.`)
    reload()
  }
  const fail = (error: Error) => setNote(cleanError(error))
  const active = state.connections.find((connection) => connection.id === state.activeId)
  const usesTun = state.scope === 'computer' && state.method === 'tun'

  return (
    <>
      <section aria-label="Status" className="flex items-center justify-between gap-4 rounded-lg bg-surface p-3 shadow-1">
        <div className="min-w-0">
          <div className="font-medium">{state.enabled ? 'Connected' : state.connecting ? (usesTun ? 'Waiting for your password…' : 'Connecting…') : 'Off'}</div>
          <div className="text-xs text-text-muted">{active ? active.name : 'Paste a connection below to get started'}. {ROUTE_NOTES[state.scope === 'browser' ? 'browser' : state.method]}</div>
          {state.error && <p role="alert" className="pt-1 text-xs text-danger">{state.error}</p>}
        </div>
        <Switch label="VPN" checked={state.enabled} onChange={(on) => void api().invoke('vpn:set-enabled', on).then(reload)} />
      </section>

      {state.connections.length === 0 && <StartingVpn onDone={reload} />}

      <section aria-label="Add connections" className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
        <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Add connections</h2>
        <textarea
          aria-label="Connection links"
          rows={3}
          spellCheck={false}
          placeholder="Paste vless://, vmess://, trojan://, ss://, socks5:// or http:// links, one per line"
          className="w-full resize-y rounded-md border border-border bg-field p-2 font-mono text-xs outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-focus-ring"
          value={links}
          onChange={(e) => setLinks(e.target.value)}
        />
        <div className="flex gap-2">
          <Select aria-label="Add to group" className="min-w-0 flex-1" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">No group</option>
            {state.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </Select>
          <Button
            disabled={!links.trim()}
            onClick={() => {
              setNote(null)
              void api()
                .invoke('vpn:add', links, groupId || null)
                .then((result) => {
                  setLinks('')
                  report(result)
                })
                .catch(fail)
            }}
          >
            Add links
          </Button>
        </div>
        <details className="group">
          <summary className="flex h-7 cursor-default list-none items-center gap-1.5 text-xs text-text-muted hover:text-text [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden size={12} strokeWidth={1.75} className="transition-transform group-open:rotate-90" />
            Subscriptions and groups
          </summary>
          <div className="flex flex-col gap-2 pt-1">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!/^https?:\/\/./i.test(subscription)) return
            setNote(null)
            void api()
              .invoke('vpn:subscribe', subscription.trim(), subscriptionName)
              .then((result) => {
                setSubscription('')
                setSubscriptionName('')
                report(result)
              })
              .catch(fail)
          }}
        >
          <Input aria-label="Subscription address" placeholder="Subscription address" className="min-w-0 flex-2" value={subscription} onChange={(e) => setSubscription(e.target.value)} />
          <Input aria-label="Subscription name" placeholder="Name" className="min-w-0 flex-1" value={subscriptionName} onChange={(e) => setSubscriptionName(e.target.value)} />
          <Button type="submit" disabled={!/^https?:\/\/./i.test(subscription)}>
            Subscribe
          </Button>
        </form>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void api()
              .invoke('vpn:add-group', newGroup.trim())
              .then(() => {
                setNewGroup('')
                reload()
              })
          }}
        >
          <Input aria-label="New group name" placeholder="New group" className="min-w-0 flex-1" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <Button type="submit" disabled={!newGroup.trim()}>
            Add group
          </Button>
        </form>
          </div>
        </details>
        {note && <p role="status" className="text-xs text-text-muted">{note}</p>}
        {state.connections.length > 0 && <p className="text-xs text-text-faint">Whoever runs a server can see your unencrypted traffic and which sites you visit, so avoid signing in to anything on free servers.</p>}
      </section>

      {progress.running && (
        <section aria-label="Pinging" className="flex items-center gap-3 rounded-lg bg-surface p-3 shadow-1">
          <div role="status" aria-label="Ping progress" className="min-w-0 flex-1 text-xs text-text-muted tabular-nums">
            Pinging {progress.done} of {progress.total}
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              void api().invoke('vpn:ping-stop')
              setProgress({ ...progress, running: false })
            }}
          >
            Stop
          </Button>
        </section>
      )}
      {state.groups.map((group) => (
        <ConnectionList
          key={group.id}
          title={group.name}
          group={group}
          connections={state.connections.filter((connection) => connection.groupId === group.id)}
          state={state}
          pings={pings}
          progress={progress}
          startPing={startPing}
          reload={reload}
        />
      ))}
      {state.connections.some((connection) => connection.groupId === null) && (
        <ConnectionList
          title="Connections"
          group={null}
          connections={state.connections.filter((connection) => connection.groupId === null)}
          state={state}
          pings={pings}
          progress={progress}
          startPing={startPing}
          reload={reload}
        />
      )}
      <RouteChoice state={state} setState={setState} reload={reload} />
      <Conveniences usesTun={usesTun} computerWide={state.scope === 'computer'} />

      <section aria-label="Ping" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3 shadow-1">
        <div className="min-w-0">
          <div>Ping time limit</div>
          <div className="text-xs text-text-faint">Each ping loads a small page through the connection. Past this limit, it counts as not working and the next one starts.</div>
        </div>
        <label className="flex items-center gap-2 text-text-muted">
          <Input
            type="number"
            aria-label="Ping time limit"
            className="w-24 text-right tabular-nums"
            min={MIN_PING_TIMEOUT}
            max={MAX_PING_TIMEOUT}
            step={100}
            value={pingTimeout}
            onChange={(e) => setPingTimeout(e.target.value)}
            onBlur={savePingTimeout}
            onKeyDown={(e) => {
              if (e.key === 'Enter') savePingTimeout()
            }}
          />
          ms
        </label>
      </section>
    </>
  )
}
