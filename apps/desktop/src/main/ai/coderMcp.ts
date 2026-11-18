import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { app, safeStorage } from 'electron'
import { isMcpServerName, mcpToolName, type CoderSource, type McpServerConfig, type McpServerView } from '@scbrowser/shared'
import type { KeyValueRepo } from '../storage/kv'
import type { CoderMcpHost, McpTool } from './coder'
import { configHash, mcpConfig, projectMcp } from './coderProject'
import { clip, commandEnv } from './coderTools'
import type { CoderTrust } from './coderTrust'

const SERVERS_KEY = 'coder:mcp'
const START_MS = 20_000
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

  constructor(
    private readonly kv: KeyValueRepo,
    private readonly trust: CoderTrust
  ) {}

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

  async remove(name: string): Promise<void> {
    await this.store((await this.own()).filter((server) => server.name !== name))
    await this.close(`global:${name}`)
  }

  /** Every server for a folder: the person's own, then the project's, which can't take a name already in use. */
  private async servers(folder: string | null): Promise<{ server: McpServerConfig; source: CoderSource; key: string; trusted: boolean; hash: string }[]> {
    const own = (await this.own()).map((server) => ({ server, source: 'global' as const, key: `global:${server.name}`, trusted: true, hash: configHash(server) }))
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
    const connection: Connection = { key: entry.key, server: entry.server, source: entry.source, hash: entry.hash, client: null, state: 'starting', error: null, tools: [], names: new Map(), starting: null, stderr: '' }
    this.connections.set(entry.key, connection)
    connection.starting = this.start(connection, folder).finally(() => (connection.starting = null))
    return connection.starting
  }

  private async start(connection: Connection, folder: string | null): Promise<void> {
    const { server } = connection
    const client = new Client({ name: 'scTerra', version: app.getVersion() })
    const timeout = <T>(promise: Promise<T>) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('It took too long to start.')), START_MS))])
    try {
      if (server.type === 'stdio') {
        const env = Object.fromEntries(Object.entries({ ...commandEnv(), ...server.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        const transport = new StdioClientTransport({ command: server.command, args: server.args, env, cwd: folder ?? undefined, stderr: 'pipe' })
        transport.stderr?.on('data', (chunk: Buffer) => (connection.stderr = (connection.stderr + chunk.toString('utf8')).slice(-2000)))
        await timeout(client.connect(transport))
      } else {
        const url = new URL(server.url)
        const requestInit = { headers: server.headers }
        try {
          await timeout(client.connect(new StreamableHTTPClientTransport(url, { requestInit }) as Transport))
        } catch {
          // Older servers only speak the earlier SSE transport.
          await timeout(client.connect(new SSEClientTransport(url, { requestInit }) as Transport))
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
      connection.error = `${error instanceof Error ? error.message : "It couldn't start."}${said ? ` ${said}` : ''}`.slice(0, 500)
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
