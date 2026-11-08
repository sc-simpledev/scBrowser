import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, connect, type AddressInfo, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  byPing,
  coreRefuses,
  isDirectProxy,
  parseVpnLink,
  proxyRule,
  splitVpnLinks,
  xrayComputerConfig,
  xrayConfig,
  xrayTestConfig,
  type ParsedLink,
  type VpnAddResult,
  type VpnConnection,
  type VpnGroup,
  type VpnMethod,
  type VpnScope,
  type VpnPingProgress,
  type VpnPings,
  type VpnState,
  type VpnSummary
} from '@scbrowser/shared'
import type { KeyVault } from './sync'
import type { ProxyPorts, SystemProxy } from './systemProxy'
import type { Tunnel, TunnelHandle } from './tun'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'vpn:store'
/** The starting connections offered to anyone who hasn't added their own: a public list of free servers in Australia. */
export const DEFAULT_VPN_URL = 'https://raw.githubusercontent.com/rtwo2/FastNodes/main/sub/countries/AU.txt'
export const DEFAULT_VPN_NAME = 'Default'
/** How many of the fastest starting connections to try before giving up, as free servers come and go. */
const DEFAULT_TRIES = 4
/** Points at a port nothing listens on, so pages fail rather than go out directly. */
const HOLD_RULE = 'socks5://127.0.0.1:9'
const FASTEST_LIMIT = 300
/** What the system proxy was before we changed it, so it survives a crash. */
const RESTORE_KEY = 'vpn:system-proxy'
const MAX_CONNECTIONS = 20_000
const PING_TIMEOUT_MS = 3000
const PING_AT_ONCE = 128
const TCP_CHECK_MS = 1500
const PROBE_BATCH = 96
const CORE_START_MS = 6000

interface StoredConnection extends VpnConnection {
  link: string
}

interface StoredGroup extends VpnGroup {
  url?: string
}

interface Stored {
  connections: StoredConnection[]
  groups: StoredGroup[]
  activeId: string | null
}

interface VpnDeps {
  kv: KeyValueRepo
  vault: KeyVault
  corePath: () => string
  /** The person's choice of how much the VPN covers. */
  route: () => { scope: VpnScope; method: VpnMethod }
  /** Turning on first looks for the fastest working connection. */
  autoFastest: () => boolean
  /** Null where this desktop has no system proxy we know how to set. */
  systemProxy: SystemProxy | null
  /** Null where TUN isn't available. */
  tun: Tunnel | null
  /** Points every browser session at a proxy, or back to a direct connection. */
  applyProxy: (rules: string | null) => Promise<void>
  fetchText: (url: string) => Promise<string>
  /** A small page that answers with an empty 204, requested through each connection. */
  probeTarget: ProbeTarget
  onChange: () => void
}

/** The useful end of Xray's error, which is a chain of `outer > inner` messages. */
const coreReason = (output: string) => {
  const line = output.trim().split('\n').at(-1) ?? ''
  return line.includes(' > ') ? `${line.split(' > ').at(-1)!.trim().replace(/^./, (c) => c.toUpperCase())}.` : ''
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })

/** Milliseconds to open a connection to the server, or null. It proves the server answers, not that it carries traffic. */
export const pingHost = (host: string, port: number, timeout = PING_TIMEOUT_MS) =>
  new Promise<number | null>((resolve) => {
    const started = performance.now()
    const socket = connect({ host, port, timeout })
    const finish = (result: number | null) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => finish(Math.round(performance.now() - started)))
    socket.once('timeout', () => finish(null))
    socket.once('error', () => finish(null))
  })

export interface ProbeTarget {
  host: string
  port: number
}

export const DEFAULT_PROBE: ProbeTarget = { host: 'cp.cloudflare.com', port: 80 }

const probeRequest = (path: string, { host, port }: ProbeTarget) => `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\nConnection: close\r\n\r\n`

/** Runs `talk` over a socket, resolving with the milliseconds it took or null at the deadline. */
function timedExchange(host: string, port: number, timeout: number, talk: (socket: Socket, finish: (ok: boolean) => void) => void): Promise<number | null> {
  return new Promise((resolve) => {
    const started = performance.now()
    const socket = connect({ host, port })
    const timer = setTimeout(() => finish(false), timeout)
    function finish(ok: boolean) {
      clearTimeout(timer)
      socket.destroy()
      resolve(ok ? Math.round(performance.now() - started) : null)
    }
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
    talk(socket, finish)
  })
}

const isNoContent = (reply: Buffer) => /^HTTP\/1\.[01] 204/.test(reply.toString('latin1'))

/** Asks a SOCKS5 proxy for the test page. Only an exact empty 204 counts, so a block page doesn't pass. */
export function probeSocks(host: string, port: number, target: ProbeTarget, timeout: number): Promise<number | null> {
  return timedExchange(host, port, timeout, (socket, finish) => {
    let stage = 0
    let reply = Buffer.alloc(0)
    socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])))
    socket.on('data', (data) => {
      reply = Buffer.concat([reply, data])
      if (stage === 0 && reply.length >= 2) {
        if (reply[0] !== 5 || reply[1] !== 0) return finish(false)
        stage = 1
        reply = Buffer.alloc(0)
        const name = Buffer.from(target.host)
        socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([target.port >> 8, target.port & 255])]))
      } else if (stage === 1 && reply.length >= 10) {
        if (reply[1] !== 0) return finish(false)
        stage = 2
        reply = Buffer.alloc(0)
        socket.write(probeRequest('/generate_204', target))
      } else if (stage === 2 && reply.length >= 12) finish(isNoContent(reply))
    })
  })
}

/** The same check for a plain proxy, which Chromium can use directly. */
function probeProxy(link: ParsedLink, target: ProbeTarget, timeout: number): Promise<number | null> {
  if (link.protocol === 'socks5') return probeSocks(link.host, link.port, target, timeout)
  return timedExchange(link.host, link.port, timeout, (socket, finish) => {
    socket.on('connect', () => socket.write(probeRequest(`http://${target.host}:${target.port}/generate_204`, target)))
    socket.on('data', (data) => finish(isNoContent(data)))
  })
}

/** The system proxy's values as we found them and as we left them. */
interface SavedProxy {
  before: string
  applied: string
}

/**
 * Sends traffic through a connection the person supplies. By default only browser sessions
 * are touched, so other apps are unaffected; they can choose to cover the whole computer.
 * Links hold passwords, so they're kept encrypted and never reach a renderer.
 */
export class VpnService {
  private store: Stored = { connections: [], groups: [], activeId: null }
  /** Settles once the saved connections have been decrypted. */
  readonly ready: Promise<void>
  private saving: Promise<void> = Promise.resolve()
  private stopped = false
  private enabled = false
  private connecting = false
  private error: string | null = null
  private core: ChildProcess | null = null
  private tunnel: TunnelHandle | null = null
  private proxyWatcher: { stop: () => void } | null = null
  private pings: VpnPings = {}
  private progress: VpnPingProgress = { running: false, done: 0, total: 0 }
  /** Changes when a check starts or stops, so an old one can't report in. */
  private pingRun = 0
  /** Changes when a connection attempt is abandoned, so a password prompt left open can't connect later. */
  private startRun = 0

  constructor(private readonly deps: VpnDeps) {
    this.recoverSystemProxy()
    this.ready = this.load().then((store) => {
      this.store = store
      this.deps.onChange()
    })
  }

  private async load(): Promise<Stored> {
    const empty: Stored = { connections: [], groups: [], activeId: null }
    const saved = this.deps.kv.get(KEY)
    if (typeof saved !== 'string') return empty
    try {
      return { ...empty, ...(JSON.parse(await this.deps.vault.decrypt(saved)) as Stored) }
    } catch {
      return empty
    }
  }

  /** Saves in order, and says so if the system can't encrypt rather than failing the change itself. */
  private save(): Promise<void> {
    const json = JSON.stringify(this.store)
    this.deps.onChange()
    this.saving = this.saving
      .then(() => this.deps.vault.encrypt(json))
      .then((sealed) => {
        // The database may have closed while this was encrypting.
        if (!this.stopped) this.deps.kv.set(KEY, sealed)
      })
      .catch(() => {
        this.error = "Your connections couldn't be saved securely, so they'll be gone when scTerra closes."
        this.deps.onChange()
      })
    return this.saving
  }

  private unavailable(): VpnState['unavailable'] {
    return {
      proxy: this.deps.systemProxy ? null : "scTerra can't set the system proxy on this desktop.",
      tun: this.deps.tun ? null : process.platform === 'linux' ? 'TUN needs polkit (pkexec) to ask for your password.' : 'TUN is only available on Linux, Windows and macOS.'
    }
  }

  state(): VpnState {
    const { scope, method } = this.deps.route()
    return {
      scope,
      method,
      unavailable: this.unavailable(),
      enabled: this.enabled,
      connecting: this.connecting,
      activeId: this.store.activeId,
      error: this.error,
      connections: this.store.connections.map(({ link: _link, ...connection }) => connection),
      groups: this.store.groups.map(({ id, name, subscription }) => ({ id, name, subscription })),
      pings: this.pings
    }
  }

  summary(): VpnSummary {
    const active = this.store.connections.find((connection) => connection.id === this.store.activeId)
    return { available: this.store.connections.length > 0, enabled: this.enabled, connecting: this.connecting, name: active?.name ?? null, error: this.error }
  }

  private addLinks(lines: string[], groupId: string | null): VpnAddResult {
    const known = new Set(this.store.connections.map((connection) => connection.link))
    let added = 0
    let skipped = 0
    for (const link of lines) {
      const parsed = parseVpnLink(link)
      if (!parsed || this.store.connections.length >= MAX_CONNECTIONS) skipped++
      else if (!known.has(link)) {
        known.add(link)
        this.store.connections.push({ id: randomUUID(), name: parsed.name.slice(0, 120), protocol: parsed.protocol, host: parsed.host, port: parsed.port, groupId, link })
        added++
      }
    }
    return { added, skipped }
  }

  /** Takes pasted links. A web address with a path is treated as a subscription. */
  async add(text: string, groupId: string | null): Promise<VpnAddResult> {
    await this.ready
    const lines = splitVpnLinks(text)
    const subscriptions = lines.filter((line) => /^https?:\/\/[^/]+\/./i.test(line))
    const result = this.addLinks(lines.filter((line) => !subscriptions.includes(line)), groupId)
    for (const url of subscriptions) {
      const { added, skipped } = await this.subscribe(url, new URL(url).hostname)
      result.added += added
      result.skipped += skipped
    }
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    await this.save()
    return result
  }

  async subscribe(url: string, name: string): Promise<VpnAddResult> {
    await this.ready
    if (!/^https?:\/\//i.test(url)) throw new Error('Use a web address for the subscription.')
    const text = await this.deps.fetchText(url)
    const group: StoredGroup = { id: randomUUID(), name: name.trim() || new URL(url).hostname, subscription: true, url }
    this.store.groups.push(group)
    const result = this.addLinks(splitVpnLinks(text), group.id)
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    await this.save()
    return result
  }

  /** Replaces a subscription's connections with its current list. */
  async refresh(groupId: string): Promise<VpnAddResult> {
    await this.ready
    const group = this.store.groups.find((candidate) => candidate.id === groupId)
    if (!group?.url) throw new Error('This group has no subscription.')
    const lines = splitVpnLinks(await this.deps.fetchText(group.url))
    const active = this.store.connections.find((connection) => connection.id === this.store.activeId)
    // The one in use stays, so that a refresh doesn't pull it out from under the browser.
    this.store.connections = this.store.connections.filter((connection) => connection.groupId !== groupId || (connection === active && this.enabled))
    const result = this.addLinks(lines, groupId)
    // Connections get new ids here, so the chosen one is found again by its link.
    if (!this.store.connections.some((connection) => connection.id === this.store.activeId)) {
      this.store.activeId = (this.store.connections.find((connection) => connection.link === active?.link) ?? this.store.connections[0])?.id ?? null
    }
    await this.save()
    return result
  }

  async addGroup(name: string): Promise<string> {
    await this.ready
    const id = randomUUID()
    this.store.groups.push({ id, name, subscription: false })
    await this.save()
    return id
  }

  async renameGroup(id: string, name: string): Promise<void> {
    await this.ready
    const group = this.store.groups.find((candidate) => candidate.id === id)
    if (group) group.name = name
    await this.save()
  }

  /** A subscription's connections go with it; connections in a hand-made group stay, ungrouped. */
  async removeGroup(id: string): Promise<void> {
    await this.ready
    const group = this.store.groups.find((candidate) => candidate.id === id)
    this.store.groups = this.store.groups.filter((candidate) => candidate.id !== id)
    this.store.connections = this.store.connections.flatMap((connection) => {
      if (connection.groupId !== id) return [connection]
      return group?.subscription && connection.id !== this.store.activeId ? [] : [{ ...connection, groupId: null }]
    })
    await this.save()
  }

  async moveToGroup(id: string, groupId: string | null): Promise<void> {
    await this.ready
    const connection = this.store.connections.find((candidate) => candidate.id === id)
    if (connection) connection.groupId = groupId
    await this.save()
  }

  async remove(id: string): Promise<void> {
    await this.ready
    if (this.store.activeId === id) {
      await this.setEnabled(false)
      this.store.activeId = null
    }
    this.store.connections = this.store.connections.filter((connection) => connection.id !== id)
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    await this.save()
  }

  async select(id: string): Promise<void> {
    await this.ready
    if (!this.store.connections.some((connection) => connection.id === id)) return
    this.store.activeId = id
    await this.save()
    if (this.enabled) await this.setEnabled(true)
  }

  pingProgress(): VpnPingProgress {
    return { ...this.progress }
  }

  stopPing(): void {
    this.pingRun++
    this.progress.running = false
  }

  /**
   * Checks each connection by loading a tiny page through it, because a server can accept a
   * connection and still carry nothing. Anything silent past `timeout` counts as failed, and
   * the check moves on. Results arrive in `pings` as they come in.
   */
  async ping(ids: string[], timeout = PING_TIMEOUT_MS): Promise<VpnPings> {
    const run = ++this.pingRun
    const wanted = new Set(ids)
    const queue = this.store.connections.filter((connection) => wanted.has(connection.id))
    this.progress = { running: true, done: 0, total: queue.length }
    const record = (id: string, result: number | null) => {
      if (run !== this.pingRun) return
      this.pings[id] = result
      this.progress.done++
    }
    const viaCore: { id: string; link: ParsedLink }[] = []
    const core = existsSync(this.deps.corePath())
    const reachable = async (connection: StoredConnection) => {
      const link = parseVpnLink(connection.link)
      if (!link || coreRefuses(link)) return record(connection.id, null)
      // A server that won't even take a connection needs no further testing.
      const reached = await pingHost(link.host, link.port, Math.min(timeout, TCP_CHECK_MS))
      if (reached === null) return record(connection.id, null)
      if (isDirectProxy(link) && link.protocol !== 'https' && link.protocol !== 'socks4') {
        return record(connection.id, await probeProxy(link, this.deps.probeTarget, timeout))
      }
      if (core) viaCore.push({ id: connection.id, link })
      else record(connection.id, reached)
    }
    await Promise.all(Array.from({ length: PING_AT_ONCE }, async () => {
      for (let next = queue.pop(); next && run === this.pingRun; next = queue.pop()) await reachable(next)
    }))
    while (viaCore.length > 0 && run === this.pingRun) await this.probeBatch(viaCore.splice(0, PROBE_BATCH), timeout, record)
    if (run === this.pingRun) this.progress.running = false
    this.deps.onChange()
    return this.pings
  }

  /** One core tests a whole batch. If a bad link stops it starting, the batch is split to find it. */
  private async probeBatch(items: { id: string; link: ParsedLink }[], timeout: number, record: (id: string, result: number | null) => void): Promise<void> {
    const ports = await Promise.all(items.map(() => freePort()))
    const core = spawn(this.deps.corePath(), ['run', '-c', 'stdin:'], { stdio: ['pipe', 'ignore', 'ignore'] })
    let exited = false
    core.on('exit', () => (exited = true))
    core.on('error', () => (exited = true))
    core.stdin?.on('error', () => undefined)
    core.stdin?.end(JSON.stringify(xrayTestConfig(items.map(({ link }, index) => ({ link, port: ports[index]! })))))
    const deadline = Date.now() + CORE_START_MS
    let ready = false
    while (!exited && !ready && Date.now() < deadline) {
      ready = (await pingHost('127.0.0.1', ports[0]!, 300)) !== null
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!ready) {
      core.kill()
      if (items.length === 1) return record(items[0]!.id, null)
      const middle = Math.ceil(items.length / 2)
      await this.probeBatch(items.slice(0, middle), timeout, record)
      await this.probeBatch(items.slice(middle), timeout, record)
      return
    }
    await Promise.all(items.map(async ({ id }, index) => record(id, await probeSocks('127.0.0.1', ports[index]!, this.deps.probeTarget, timeout))))
    core.kill()
  }

  /** Holds pages back at startup until `connectAtStart` settles, so nothing slips out before the VPN is up. */
  holdPages(): Promise<void> {
    return this.deps.applyProxy(HOLD_RULE)
  }

  /** A failure stays closed, as someone who asked to always connect shouldn't silently browse without it. */
  async connectAtStart(): Promise<void> {
    await this.ready
    if (!this.store.connections.some((connection) => connection.id === this.store.activeId)) return this.deps.applyProxy(null)
    await this.turnOn()
    if (this.enabled) return
    const reason = this.error
    await this.deps.applyProxy(HOLD_RULE)
    this.enabled = true
    this.error = `${reason ?? "The VPN didn't connect."} Pages won’t load until you turn the VPN off or pick another connection.`
    this.deps.onChange()
  }

  /**
   * "Use starting VPN connection": adds the Default list if it isn't there yet (or refreshes it when
   * it's empty), checks which of its servers really carry traffic, and connects through the fastest
   * one that starts. Free public servers come and go, so a few are tried in turn.
   */
  async useDefault(): Promise<void> {
    await this.ready
    this.error = null
    this.connecting = true
    this.deps.onChange()
    try {
      let group = this.store.groups.find((candidate) => candidate.url === DEFAULT_VPN_URL)
      if (!group) {
        await this.subscribe(DEFAULT_VPN_URL, DEFAULT_VPN_NAME)
        group = this.store.groups.find((candidate) => candidate.url === DEFAULT_VPN_URL)
      } else if (!this.store.connections.some((connection) => connection.groupId === group!.id)) await this.refresh(group.id)
      const candidates = this.store.connections.filter((connection) => connection.groupId === group?.id).slice(0, FASTEST_LIMIT)
      if (candidates.length === 0) throw new Error("The starting VPN list is empty right now. Try again later, or add a connection of your own.")
      this.connecting = true
      this.deps.onChange()
      const pings = await this.ping(candidates.map(({ id }) => id))
      const working = byPing(candidates, pings).filter((connection) => pings[connection.id])
      if (working.length === 0) throw new Error("None of the starting VPN servers answered just now. Try again in a while, or add a connection of your own.")
      for (const connection of working.slice(0, DEFAULT_TRIES)) {
        this.store.activeId = connection.id
        await this.save()
        await this.setEnabled(true)
        if (this.enabled) return
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "The starting VPN didn't connect."
    } finally {
      this.connecting = false
      this.deps.onChange()
    }
  }

  /** Whether the only connections are the starting ones, which are picked afresh each time. */
  onlyDefault(): boolean {
    const group = this.store.groups.find((candidate) => candidate.url === DEFAULT_VPN_URL)
    return !!group && this.store.connections.every((connection) => connection.groupId === group.id)
  }

  /** What the on switch does: picks a connection if asked to, then connects. */
  async turnOn(): Promise<void> {
    if (this.deps.autoFastest()) await this.pickFastest()
    await this.setEnabled(true)
  }

  /** Within the current connection's group, as a free list can be huge and some groups are kept apart on purpose. */
  private async pickFastest(): Promise<void> {
    const active = this.store.connections.find((connection) => connection.id === this.store.activeId)
    const candidates = this.store.connections.filter((connection) => connection.groupId === (active?.groupId ?? null)).slice(0, FASTEST_LIMIT)
    if (candidates.length < 2) return
    this.connecting = true
    this.deps.onChange()
    const pings = await this.ping(candidates.map(({ id }) => id))
    const best = byPing(candidates, pings)[0]
    if (best && pings[best.id]) {
      this.store.activeId = best.id
      await this.save()
    }
  }

  async setEnabled(on: boolean): Promise<void> {
    this.error = null
    await this.stopEverything()
    if (!on) {
      this.enabled = false
      await this.deps.applyProxy(null)
      this.deps.onChange()
      return
    }
    const active = this.store.connections.find((connection) => connection.id === this.store.activeId)
    const parsed = active && parseVpnLink(active.link)
    if (!parsed) {
      this.error = 'Choose a connection first.'
      this.deps.onChange()
      return
    }
    this.connecting = true
    this.deps.onChange()
    try {
      const { scope, method } = this.deps.route()
      const rules =
        scope === 'computer'
          ? await (method === 'tun' ? this.startTunnel(parsed) : this.startSystemProxy(parsed))
          : isDirectProxy(parsed)
            ? proxyRule(parsed)
            : await this.startCore((port) => xrayConfig(parsed, port))
      await this.deps.applyProxy(rules)
      this.enabled = true
    } catch (error) {
      await this.stopEverything()
      this.enabled = false
      await this.deps.applyProxy(null)
      this.error = error instanceof Error ? error.message : "That connection didn't start."
    } finally {
      this.connecting = false
      this.deps.onChange()
    }
  }

  /** The core carries every whole-computer connection, and has no way to speak SOCKS4. */
  private checkCoreCanCarry(link: ParsedLink): void {
    if (link.protocol === 'socks4') throw new Error("SOCKS4 servers can't cover the whole computer. Pick another connection, or use just the browser.")
    if (coreRefuses(link)) throw new Error("This connection can't cover the whole computer, because it has no encryption.")
    if (!existsSync(this.deps.corePath())) throw new Error('The VPN core is missing from this build.')
  }

  private async startSystemProxy(link: ParsedLink): Promise<string> {
    const proxy = this.deps.systemProxy
    if (!proxy) throw new Error(this.unavailable().proxy!)
    this.checkCoreCanCarry(link)
    const httpPort = await freePort()
    const rules = await this.startCore((socksPort) => xrayComputerConfig(link, { socksPort, httpPort }))
    const ports: ProxyPorts = { host: '127.0.0.1', httpPort, socksPort: Number(rules.split(':').at(-1)) }
    // Saved first, so that a crash part way through can still be put right.
    const before = proxy.read()
    this.deps.kv.set(RESTORE_KEY, JSON.stringify({ before, applied: '' } satisfies SavedProxy))
    proxy.apply(ports)
    this.deps.kv.set(RESTORE_KEY, JSON.stringify({ before, applied: proxy.read() } satisfies SavedProxy))
    this.proxyWatcher = proxy.watchForCrash(before)
    return rules
  }

  /** Puts the system proxy back as it was found. Runs at shutdown too, so it can't wait. */
  private releaseSystemProxy(): void {
    this.proxyWatcher?.stop()
    this.proxyWatcher = null
    const saved = this.deps.kv.get(RESTORE_KEY)
    if (typeof saved !== 'string') return
    try {
      this.deps.systemProxy?.restore((JSON.parse(saved) as SavedProxy).before)
    } catch {
      this.error = "Your system proxy couldn't be put back, so check it in your network settings."
    } finally {
      this.deps.kv.delete(RESTORE_KEY)
    }
  }

  /** After a crash, only undoes our own change: the person may have set something else since. */
  private recoverSystemProxy(): void {
    const saved = this.deps.kv.get(RESTORE_KEY)
    if (typeof saved !== 'string') return
    try {
      const { before, applied } = JSON.parse(saved) as SavedProxy
      const current = this.deps.systemProxy?.read()
      if (current !== undefined && (applied === '' || current === applied)) this.deps.systemProxy?.restore(before)
    } catch {
      // Nothing more can be done, and it shouldn't stop the browser starting.
    }
    this.deps.kv.delete(RESTORE_KEY)
  }

  private async startTunnel(link: ParsedLink): Promise<string> {
    const tun = this.deps.tun
    if (!tun) throw new Error(this.unavailable().tun!)
    this.checkCoreCanCarry(link)
    const socksPort = await freePort()
    const cancelled = this.startRun
    // Looked up now, as DNS itself goes through the connection once the routes change.
    const serverAddress = await tun.resolve(link.host)
    const handle = await tun.start({
      corePath: this.deps.corePath(),
      config: (device) => xrayComputerConfig(link, { socksPort, tun: { ...device, serverAddress } }),
      onExit: () => {
        if (this.tunnel !== handle) return
        this.tunnel = null
        this.error = 'The connection stopped. Other apps are back on your normal connection, and pages won’t load in scTerra until you turn the VPN off or pick another connection.'
        this.deps.onChange()
      },
      isCancelled: () => cancelled !== this.startRun
    })
    this.tunnel = handle
    return `socks5://127.0.0.1:${socksPort}`
  }

  private async startCore(config: (port: number) => unknown): Promise<string> {
    const path = this.deps.corePath()
    if (!existsSync(path)) throw new Error('The VPN core is missing from this build, so only plain proxies work.')
    const port = await freePort()
    const core = spawn(path, ['run', '-c', 'stdin:'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.core = core
    let output = ''
    // Xray reports a refused config on stdout.
    const collect = (data: Buffer) => (output = (output + data.toString()).slice(-400))
    core.stdout?.on('data', collect)
    core.stderr?.on('data', collect)
    core.on('error', () => undefined)
    core.on('exit', () => {
      if (this.core !== core) return
      this.core = null
      // The browser's proxy stays pointed at the closed port, so pages fail rather than leaking
      // out directly. Other apps go back to normal, as they'd otherwise lose the internet.
      const covered = this.proxyWatcher !== null
      this.releaseSystemProxy()
      this.error = covered
        ? 'The connection stopped. Other apps are back on your normal connection, and pages won’t load in scTerra until you turn the VPN off or pick another connection.'
        : 'The connection stopped. Pages won’t load until you turn the VPN off or pick another connection.'
      this.deps.onChange()
    })
    core.stdin?.on('error', () => undefined)
    core.stdin?.end(JSON.stringify(config(port)))
    const deadline = Date.now() + CORE_START_MS
    while (Date.now() < deadline) {
      if (this.core !== core) throw new Error(`That connection didn't start. ${coreReason(output)}`.trim())
      if ((await pingHost('127.0.0.1', port, 300)) !== null) return `socks5://127.0.0.1:${port}`
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
    throw new Error("That connection didn't start in time.")
  }

  private stopCore(): void {
    const core = this.core
    this.core = null
    core?.kill()
  }

  private async stopEverything(): Promise<void> {
    this.startRun++
    this.releaseSystemProxy()
    this.stopCore()
    const tunnel = this.tunnel
    this.tunnel = null
    await tunnel?.stop()
  }

  /** Closes everything with the browser, so nothing is left listening or pointing at a closed port. */
  stop(): void {
    this.stopped = true
    this.releaseSystemProxy()
    this.stopCore()
    // The tunnel removes its own routes once this end of its pipe closes.
    void this.tunnel?.stop()
  }
}

/** The bundled core, or the one fetched for development. */
export function xrayPath(resourcesPath: string, appPath: string, packaged: boolean): string {
  if (process.env.SCB_XRAY) return process.env.SCB_XRAY
  const name = process.platform === 'win32' ? 'xray.exe' : 'xray'
  return packaged ? join(resourcesPath, 'xray', name) : join(appPath, 'resources', 'xray', name)
}

/** Someone with connections of their own gets theirs turned on; anyone else gets the starting one. */
export async function useVpnForAi(vpn: VpnService): Promise<VpnSummary> {
  await vpn.ready
  if (!vpn.summary().enabled) {
    if (vpn.summary().available && !vpn.onlyDefault()) await vpn.turnOn()
    else await vpn.useDefault()
  }
  return vpn.summary()
}
