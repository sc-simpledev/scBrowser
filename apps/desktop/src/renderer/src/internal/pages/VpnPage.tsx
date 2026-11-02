import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconButton, Input, Select, Switch } from '@scbrowser/ui'
import { byPing, type VpnAddResult, type VpnConnection, type VpnGroup, type VpnPingProgress, type VpnPings, type VpnState } from '@scbrowser/shared'
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

  return (
    <>
      <section aria-label="Status" className="flex items-center justify-between gap-4 rounded-lg bg-surface p-3 shadow-1">
        <div className="min-w-0">
          <div className="font-medium">{state.enabled ? 'Connected' : state.connecting ? 'Connecting…' : 'Off'}</div>
          <div className="truncate text-xs text-text-muted">{active ? active.name : 'Add a connection below'}. Only scTerra uses this, not other apps.</div>
          {state.error && <p role="alert" className="pt-1 text-xs text-danger">{state.error}</p>}
        </div>
        <Switch label="VPN" checked={state.enabled} onChange={(on) => void api().invoke('vpn:set-enabled', on).then(reload)} />
      </section>

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
        {progress.running && (
          <div className="flex w-full items-center gap-3">
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
          </div>
        )}
      </section>

      <section aria-label="Add connections" className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-1">
        <h2 className="text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Add connections</h2>
        <textarea
          aria-label="Connection links"
          rows={4}
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
        <div className="flex gap-2">
          <Input aria-label="Subscription address" placeholder="Subscription address" className="min-w-0 flex-2" value={subscription} onChange={(e) => setSubscription(e.target.value)} />
          <Input aria-label="Subscription name" placeholder="Name" className="min-w-0 flex-1" value={subscriptionName} onChange={(e) => setSubscriptionName(e.target.value)} />
          <Button
            disabled={!/^https?:\/\/./i.test(subscription)}
            onClick={() => {
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
            Subscribe
          </Button>
        </div>
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
        {note && <p role="status" className="text-xs text-text-muted">{note}</p>}
        <p className="text-xs text-text-faint">Whoever runs a server can see your unencrypted traffic and which sites you visit, so avoid signing in to anything on free servers.</p>
      </section>

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
    </>
  )
}
