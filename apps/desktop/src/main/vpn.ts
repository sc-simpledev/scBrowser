import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, connect, type AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  isDirectProxy,
  parseVpnLink,
  proxyRule,
  splitVpnLinks,
  xrayConfig,
  type ParsedLink,
  type VpnAddResult,
  type VpnConnection,
  type VpnGroup,
  type VpnState,
  type VpnSummary
} from '@scbrowser/shared'
import type { KeyVault } from './sync'
import type { KeyValueRepo } from './storage/kv'

const KEY = 'vpn:store'
const MAX_CONNECTIONS = 20_000
const PING_TIMEOUT_MS = 3000
const PING_AT_ONCE = 128
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

/**
 * Sends the browser's traffic through a connection the person supplies. Only browser
 * sessions are touched, so other apps on the computer are unaffected. Links hold passwords,
 * so they're kept encrypted and never reach a renderer.
 */
export class VpnService {
  private store: Stored
  private enabled = false
  private connecting = false
  private error: string | null = null
  private core: ChildProcess | null = null

  constructor(private readonly deps: VpnDeps) {
    this.store = this.load()
  }

  private load(): Stored {
    const empty: Stored = { connections: [], groups: [], activeId: null }
    const saved = this.deps.kv.get(KEY)
    if (typeof saved !== 'string') return empty
    try {
      return { ...empty, ...(JSON.parse(this.deps.vault.decrypt(saved)) as Stored) }
    } catch {
      return empty
    }
  }

  private save(): void {
    this.deps.kv.set(KEY, this.deps.vault.encrypt(JSON.stringify(this.store)))
    this.deps.onChange()
  }

  state(): VpnState {
    return {
      enabled: this.enabled,
      connecting: this.connecting,
      activeId: this.store.activeId,
      error: this.error,
      connections: this.store.connections.map(({ link: _link, ...connection }) => connection),
      groups: this.store.groups.map(({ id, name, subscription }) => ({ id, name, subscription }))
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
    const lines = splitVpnLinks(text)
    const subscriptions = lines.filter((line) => /^https?:\/\/[^/]+\/./i.test(line))
    const result = this.addLinks(lines.filter((line) => !subscriptions.includes(line)), groupId)
    for (const url of subscriptions) {
      const { added, skipped } = await this.subscribe(url, new URL(url).hostname)
      result.added += added
      result.skipped += skipped
    }
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    this.save()
    return result
  }

  async subscribe(url: string, name: string): Promise<VpnAddResult> {
    if (!/^https?:\/\//i.test(url)) throw new Error('Use a web address for the subscription.')
    const text = await this.deps.fetchText(url)
    const group: StoredGroup = { id: randomUUID(), name: name.trim() || new URL(url).hostname, subscription: true, url }
    this.store.groups.push(group)
    const result = this.addLinks(splitVpnLinks(text), group.id)
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    this.save()
    return result
  }

  /** Replaces a subscription's connections with its current list. */
  async refresh(groupId: string): Promise<VpnAddResult> {
    const group = this.store.groups.find((candidate) => candidate.id === groupId)
    if (!group?.url) throw new Error('This group has no subscription.')
    const lines = splitVpnLinks(await this.deps.fetchText(group.url))
    const active = this.store.connections.find((connection) => connection.id === this.store.activeId)
    // The one in use stays, so that a refresh doesn't pull it out from under the browser.
    this.store.connections = this.store.connections.filter((connection) => connection.groupId !== groupId || (connection === active && this.enabled))
    const result = this.addLinks(lines, groupId)
    this.save()
    return result
  }

  addGroup(name: string): string {
    const id = randomUUID()
    this.store.groups.push({ id, name, subscription: false })
    this.save()
    return id
  }

  renameGroup(id: string, name: string): void {
    const group = this.store.groups.find((candidate) => candidate.id === id)
    if (group) group.name = name
    this.save()
  }

  /** A subscription's connections go with it; connections in a hand-made group stay, ungrouped. */
  removeGroup(id: string): void {
    const group = this.store.groups.find((candidate) => candidate.id === id)
    this.store.groups = this.store.groups.filter((candidate) => candidate.id !== id)
    this.store.connections = this.store.connections.flatMap((connection) => {
      if (connection.groupId !== id) return [connection]
      return group?.subscription && connection.id !== this.store.activeId ? [] : [{ ...connection, groupId: null }]
    })
    this.save()
  }

  moveToGroup(id: string, groupId: string | null): void {
    const connection = this.store.connections.find((candidate) => candidate.id === id)
    if (connection) connection.groupId = groupId
    this.save()
  }

  async remove(id: string): Promise<void> {
    if (this.store.activeId === id) {
      await this.setEnabled(false)
      this.store.activeId = null
    }
    this.store.connections = this.store.connections.filter((connection) => connection.id !== id)
    this.store.activeId ??= this.store.connections[0]?.id ?? null
    this.save()
  }

  async select(id: string): Promise<void> {
    if (!this.store.connections.some((connection) => connection.id === id)) return
    this.store.activeId = id
    this.save()
    if (this.enabled) await this.setEnabled(true)
  }

  /** Runs in small batches, because subscriptions can list thousands of servers. */
  async ping(ids: string[]): Promise<Record<string, number | null>> {
    const wanted = new Set(ids)
    const queue = this.store.connections.filter((connection) => wanted.has(connection.id))
    const results: Record<string, number | null> = {}
    const worker = async () => {
      for (let next = queue.pop(); next; next = queue.pop()) results[next.id] = await pingHost(next.host, next.port)
    }
    await Promise.all(Array.from({ length: PING_AT_ONCE }, worker))
    return results
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
    this.stopCore()
  }
}

/** The bundled core, or the one fetched for development. */
export function xrayPath(resourcesPath: string, appPath: string, packaged: boolean): string {
  if (process.env.SCB_XRAY) return process.env.SCB_XRAY
  const name = process.platform === 'win32' ? 'xray.exe' : 'xray'
  return packaged ? join(resourcesPath, 'xray', name) : join(appPath, 'resources', 'xray', name)
}
