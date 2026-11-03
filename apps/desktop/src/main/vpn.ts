import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, connect, type AddressInfo, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  coreRefuses,
  isDirectProxy,
  parseVpnLink,
  proxyRule,
  splitVpnLinks,
  xrayConfig,
  xrayTestConfig,
  type ParsedLink,
  type VpnAddResult,
  type VpnConnection,
  type VpnGroup,
  type VpnPingProgress,
  type VpnPings,
  type VpnState,
  type VpnSummary
} from '@scbrowser/shared'
import type { KeyVault } from './sync'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'vpn:store'
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

/**
 * Sends the browser's traffic through a connection the person supplies. Only browser
 * sessions are touched, so other apps on the computer are unaffected. Links hold passwords,
 * so they're kept encrypted and never reach a renderer.
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
  private pings: VpnPings = {}
  private progress: VpnPingProgress = { running: false, done: 0, total: 0 }
  /** Changes when a check starts or stops, so an old one can't report in. */
  private pingRun = 0

  constructor(private readonly deps: VpnDeps) {
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

  state(): VpnState {
    return {
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

  async setEnabled(on: boolean): Promise<void> {
    this.error = null
    this.stopCore()
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
      await this.deps.applyProxy(isDirectProxy(parsed) ? proxyRule(parsed) : await this.startCore(parsed))
      this.enabled = true
    } catch (error) {
      this.stopCore()
      this.enabled = false
      await this.deps.applyProxy(null)
      this.error = error instanceof Error ? error.message : "That connection didn't start."
    } finally {
      this.connecting = false
      this.deps.onChange()
    }
  }

  private async startCore(link: ParsedLink): Promise<string> {
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
      // The proxy stays pointed at the closed port, so pages fail rather than leaking out directly.
      this.error = 'The connection stopped. Pages won’t load until you turn the VPN off or pick another connection.'
      this.deps.onChange()
    })
    core.stdin?.on('error', () => undefined)
    core.stdin?.end(JSON.stringify(xrayConfig(link, port)))
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

  /** Closes the core with the browser, so nothing is left listening. */
  stop(): void {
    this.stopped = true
    this.stopCore()
  }
}

/** The bundled core, or the one fetched for development. */
export function xrayPath(resourcesPath: string, appPath: string, packaged: boolean): string {
  if (process.env.SCB_XRAY) return process.env.SCB_XRAY
  const name = process.platform === 'win32' ? 'xray.exe' : 'xray'
  return packaged ? join(resourcesPath, 'xray', name) : join(appPath, 'resources', 'xray', name)
}
