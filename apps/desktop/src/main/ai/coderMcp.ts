import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { app, safeStorage } from 'electron'
import { isMcpServerName, mcpToolName, type CoderSource, type McpServerConfig, type McpServerView } from '@scbrowser/shared'
import type { KeyValueRepo } from '../storage/kv'
import type { CoderMcpHost, McpTool } from './coder'
import { configHash, mcpConfig, projectMcp } from './coderProject'
import { clip, commandEnv } from './coderTools'
import type { CoderTrust } from './coderTrust'
import { callbackPort, McpAuthStore, McpOAuth, waitForCode } from './coderMcpAuth'

const SERVERS_KEY = 'coder:mcp'
/** A command's first start may download it (npx, uvx), so it gets longer than an address. */
const START_MS = { stdio: 90_000, http: 20_000 }
const CALL_MS = 120_000
const MAX_TOOLS = 80
const MAX_SERVERS = 20

interface Connection {
  key: string
  server: McpServerConfig
  source: CoderSource
  hash: string
  client: Client | null
  state: McpServerView['state']
  error: string | null
  tools: McpTool[]
  /** The tool's name on its server, by the name the model knows it by. */
  names: Map<string, string>
  starting: Promise<void> | null
  stderr: string
  /** A remote server waiting for the person to sign in, and the transport to finish it on. */
  auth: { provider: McpOAuth; transport: StreamableHTTPClientTransport } | null
}

/**
 * MCP servers for Terra Code, through the official SDK. The person's own servers are kept encrypted,
 * as their settings often hold tokens, and never reach a page: it only sees names and variable
 * names. A project's own servers (`.mcp.json`) run only after the person allows them, and again
 * whenever they change. Servers start when Terra Code first needs them and stop with the window.
 */
export class CoderMcp implements CoderMcpHost {
  private saved: McpServerConfig[] | null = null
  private readonly connections = new Map<string, Connection>()

  private readonly auth: McpAuthStore

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly trust: CoderTrust,
    /** Opens a sign-in page for the person, in a tab. */
    private readonly openUrl: (url: string) => void = () => undefined,
    /** Servers from installed plugins that are on. */
    private readonly plugins: () => Promise<McpServerConfig[]> = async () => []
  ) {
    this.auth = new McpAuthStore(kv)
  }

  /**
   * Opens the server's sign-in page and waits for the person to come back from it, then starts
   * the server again with the tokens it handed over.
   */
  async signIn(folder: string | null, name: string): Promise<void> {
    const found = (await this.servers(folder)).find((entry) => entry.server.name === name)
    if (!found || found.server.type !== 'http') throw new Error('Only servers at an address sign in.')
    let connection = this.connections.get(found.key)
    if (!connection?.auth?.provider.authorizationUrl) {
      await this.restart(folder, name)
      connection = this.connections.get(found.key)
    }
    const pending = connection?.auth
    if (!pending?.provider.authorizationUrl) throw new Error(connection?.state === 'ready' ? 'Already signed in.' : 'This server didn’t ask to sign in.')
    const code = waitForCode(callbackPort(name))
    this.openUrl(pending.provider.authorizationUrl.toString())
    await pending.transport.finishAuth(await code)
    await this.restart(folder, name)
  }

  async signOut(folder: string | null, name: string): Promise<void> {
    await this.auth.update(name, null)
    const found = (await this.servers(folder)).find((entry) => entry.server.name === name)
    if (found) await this.close(found.key)
  }

  /** The person's own servers, decrypted. */
  private async own(): Promise<McpServerConfig[]> {
    if (this.saved) return this.saved
    const stored = this.kv.get(SERVERS_KEY)
    let list: unknown = []
    if (typeof stored === 'string' && (await safeStorage.isAsyncEncryptionAvailable())) {
      try {
        list = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result)
      } catch {
        list = []
      }
    }
    this.saved = (Array.isArray(list) ? list : []).flatMap((raw: unknown) => {
      const record = raw as { name?: unknown }
      const server = typeof record?.name === 'string' ? mcpConfig(record.name, raw) : null
      return server ? [{ ...server, enabled: (raw as { enabled?: unknown }).enabled !== false }] : []
    })
    return this.saved
  }

  private async store(list: McpServerConfig[]): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("This computer's keychain isn't available, so MCP servers can't be saved safely.")
    this.kv.set(SERVERS_KEY, (await safeStorage.encryptStringAsync(JSON.stringify(list))).toString('base64'))
    this.saved = list
  }

  /** Adds or changes one of the person's servers. A secret left empty keeps what was saved before. */
  async save(server: McpServerConfig): Promise<void> {
    if (!isMcpServerName(server.name)) throw new Error('Names are letters, numbers, - and _, up to 40.')
    const checked = mcpConfig(server.name, server)
    if (!checked) throw new Error(server.type === 'http' ? 'That address needs to start with http:// or https://.' : 'It needs a command to run.')
    const list = await this.own()
    const old = list.find((other) => other.name === server.name)
    const keep = (fresh: Record<string, string>, before: Record<string, string> | undefined) => Object.fromEntries(Object.entries(fresh).map(([key, value]) => [key, value || before?.[key] || '']).filter(([, value]) => value))
    const merged: McpServerConfig =
      checked.type === 'stdio'
        ? { ...checked, enabled: server.enabled, env: keep(checked.env, old?.type === 'stdio' ? old.env : undefined) }
        : { ...checked, enabled: server.enabled, headers: keep(checked.headers, old?.type === 'http' ? old.headers : undefined) }
    const next = [...list.filter((other) => other.name !== server.name), merged].slice(0, MAX_SERVERS)
    await this.store(next)
    await this.close(`global:${server.name}`)
  }

  /** Stops servers that came from plugins, after one is added, turned off or removed; they start again when needed. */
  async closePlugins(): Promise<void> {
    await Promise.all([...this.connections.keys()].filter((key) => key.startsWith('plugin:')).map((key) => this.close(key)))
  }

  async remove(name: string): Promise<void> {
    await this.auth.update(name, null).catch(() => undefined)
    await this.store((await this.own()).filter((server) => server.name !== name))
    await this.close(`global:${name}`)
  }

  /** Every server for a folder: the person's own, then the project's, which can't take a name already in use. */
  private async servers(folder: string | null): Promise<{ server: McpServerConfig; source: CoderSource; key: string; trusted: boolean; hash: string }[]> {
    const mine = (await this.own()).map((server) => ({ server, source: 'global' as const, key: `global:${server.name}`, trusted: true, hash: configHash(server) }))
    const fromPlugins = (await this.plugins().catch(() => []))
      .filter((server) => !mine.some((other) => other.server.name === server.name))
      .map((server) => ({ server, source: 'global' as const, key: `plugin:${server.name}`, trusted: true, hash: configHash(server) }))
    const own = [...mine, ...fromPlugins]
    const project = folder
      ? (await projectMcp(folder))
          .filter((server) => !own.some((other) => other.server.name === server.name))
          .map((server) => {
            const hash = configHash(server)
            return { server, source: 'project' as const, key: `project:${folder}:${server.name}`, trusted: this.trust.trusted(folder, `mcp:${server.name}`) === hash, hash }
          })
      : []
    return [...own, ...project]
  }

  async trustProject(folder: string, name: string, trusted: boolean): Promise<void> {
    const found = (await this.servers(folder)).find((entry) => entry.source === 'project' && entry.server.name === name)
    if (!found) return
    this.trust.trust(folder, `mcp:${name}`, trusted ? found.hash : null)
    if (!trusted) await this.close(found.key)
  }

  async restart(folder: string | null, name: string): Promise<void> {
    const found = (await this.servers(folder)).find((entry) => entry.server.name === name)
    if (found) {
      await this.close(found.key)
      if (found.server.enabled && found.trusted) await this.connect(found, folder)
    }
  }

  /** Starts what's needed and lists every tool from servers that are on and allowed. */
  async tools(folder: string): Promise<McpTool[]> {
    const wanted = (await this.servers(folder)).filter((entry) => entry.server.enabled && entry.trusted)
    await Promise.all(wanted.map((entry) => this.connect(entry, folder)))
    return wanted.flatMap((entry) => this.connections.get(entry.key)?.tools ?? []).slice(0, MAX_TOOLS)
  }

  async call(folder: string, name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<{ ok: boolean; output: string; images: string[] }> {
    const entries = await this.servers(folder)
    const connection = entries.map((entry) => this.connections.get(entry.key)).find((candidate) => candidate?.names.has(name))
    if (!connection?.client) return { ok: false, output: `${name} isn't available: its server stopped. It may start again on the next step.`, images: [] }
    const result = await connection.client.callTool({ name: connection.names.get(name)!, arguments: input }, undefined, { signal, timeout: CALL_MS })
    const texts: string[] = []
    const images: string[] = []
    for (const part of (result.content as { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string } }[] | undefined) ?? []) {
      if (part.type === 'text' && part.text) texts.push(part.text)
      else if (part.type === 'image' && part.data && /^image\/(png|jpeg|gif|webp)$/.test(part.mimeType ?? '')) images.push(`data:${part.mimeType};base64,${part.data}`)
      else if (part.type === 'resource' && part.resource) texts.push(part.resource.text ?? `(A resource: ${part.resource.uri ?? 'unnamed'})`)
    }
    if (result.structuredContent && texts.length === 0) texts.push(JSON.stringify(result.structuredContent, null, 2))
    return { ok: !result.isError, output: clip(texts.join('\n\n') || '(The tool returned nothing.)', 40_000), images: images.slice(0, 4) }
  }

  /** What the settings panel shows, with no secret values. */
  async views(folder: string | null): Promise<McpServerView[]> {
    return (await this.servers(folder)).map(({ server, source, key, trusted }) => {
      const connection = this.connections.get(key)
      return {
        name: server.name,
        type: server.type,
        target: server.type === 'stdio' ? [server.command, ...server.args].join(' ') : server.url,
        envKeys: Object.keys(server.type === 'stdio' ? server.env : server.headers),
        source,
        enabled: server.enabled,
        trusted,
        state: connection?.state ?? 'off',
        error: connection?.error ?? null,
        tools: connection?.tools.map((tool) => tool.spec.name.split('__')[2] ?? tool.spec.name) ?? []
      }
    })
  }

  private connect(entry: { server: McpServerConfig; source: CoderSource; key: string; hash: string }, folder: string | null): Promise<void> {
    const existing = this.connections.get(entry.key)
    // A changed setup starts again; a failed one is tried again on the next run.
    if (existing && existing.hash === entry.hash && existing.state !== 'error') return existing.starting ?? Promise.resolve()
    if (existing) void this.close(entry.key)
    const connection: Connection = { key: entry.key, server: entry.server, source: entry.source, hash: entry.hash, client: null, state: 'starting', error: null, tools: [], names: new Map(), starting: null, stderr: '', auth: null }
    this.connections.set(entry.key, connection)
    connection.starting = this.start(connection, folder).finally(() => (connection.starting = null))
    return connection.starting
  }

  private async start(connection: Connection, folder: string | null): Promise<void> {
    const { server } = connection
    const client = new Client({ name: 'scTerra', version: app.getVersion() })
    const limit = START_MS[server.type]
    const timeout = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`It took longer than ${limit / 1000} seconds to start.`)), limit))])
    try {
      if (server.type === 'stdio') {
        const env = Object.fromEntries(Object.entries({ ...commandEnv(), ...server.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        const transport = new StdioClientTransport({ command: server.command, args: server.args, env, cwd: folder ?? undefined, stderr: 'pipe' })
        transport.stderr?.on('data', (chunk: Buffer) => (connection.stderr = (connection.stderr + chunk.toString('utf8')).slice(-2000)))
        await timeout(client.connect(transport))
      } else {
        const url = new URL(server.url)
        const requestInit = { headers: server.headers }
        // Servers that need an account say so with a 401, and the SDK runs OAuth through this.
        const provider = new McpOAuth(this.auth, server.name)
        const transport = new StreamableHTTPClientTransport(url, { requestInit, authProvider: provider })
        try {
          await timeout(client.connect(transport as Transport))
        } catch (error) {
          if (error instanceof UnauthorizedError || provider.authorizationUrl) {
            connection.state = 'signin'
            connection.error = null
            connection.auth = { provider, transport }
            return
          }
          // Older servers only speak the earlier SSE transport.
          await timeout(client.connect(new SSEClientTransport(url, { requestInit, authProvider: provider }) as Transport))
        }
      }
      const listed = await timeout(client.listTools())
      for (const tool of listed.tools.slice(0, MAX_TOOLS)) {
        const name = mcpToolName(server.name, tool.name)
        connection.names.set(name, tool.name)
        connection.tools.push({
          server: server.name,
          readOnly: tool.annotations?.readOnlyHint === true,
          spec: { name, description: `[${server.name}] ${tool.description ?? tool.title ?? tool.name}`.slice(0, 1000), parameters: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} } }
        })
      }
      connection.client = client
      connection.state = 'ready'
      client.onclose = () => {
        if (this.connections.get(connection.key) !== connection) return
        connection.state = 'error'
        connection.error = 'It stopped.'
        connection.client = null
      }
    } catch (error) {
      connection.state = 'error'
      const said = connection.stderr.trim().split('\n').slice(-3).join(' ')
      const missing = error instanceof Error && /ENOENT/.test(error.message) && server.type === 'stdio'
      const why = missing ? `${server.command} wasn't found. Install it, or give its full path.` : error instanceof Error ? error.message : "It couldn't start."
      connection.error = `${why}${said ? ` ${said}` : ''}`.slice(0, 500)
      await client.close().catch(() => undefined)
    }
  }

  private async close(key: string): Promise<void> {
    const connection = this.connections.get(key)
    this.connections.delete(key)
    await connection?.client?.close().catch(() => undefined)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((key) => this.close(key)))
  }
}
