import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { commandEnv, findProgram, ToolError } from './coderTools'

/** A language server for some file extensions: the program, how to start it, and the language id it expects. */
interface ServerKind {
  id: string
  extensions: string[]
  language: (ext: string) => string
  programs: { name: string; args: string[] }[]
}

const KINDS: ServerKind[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
    language: (ext) => (ext.startsWith('.t') || ext.startsWith('.mt') || ext.startsWith('.ct') ? (ext === '.tsx' ? 'typescriptreact' : 'typescript') : ext === '.jsx' ? 'javascriptreact' : 'javascript'),
    programs: [{ name: 'typescript-language-server', args: ['--stdio'] }]
  },
  { id: 'python', extensions: ['.py'], language: () => 'python', programs: [{ name: 'pyright-langserver', args: ['--stdio'] }, { name: 'basedpyright-langserver', args: ['--stdio'] }, { name: 'pylsp', args: [] }] },
  { id: 'go', extensions: ['.go'], language: () => 'go', programs: [{ name: 'gopls', args: [] }] },
  { id: 'rust', extensions: ['.rs'], language: () => 'rust', programs: [{ name: 'rust-analyzer', args: [] }] }
]

const REQUEST_MS = 30_000
const IDLE_MS = 10 * 60_000
const MAX_RESULTS = 60

export type LspAction = 'definition' | 'references' | 'hover' | 'symbols'

/** One language server for one project, spoken to over JSON-RPC on its standard input and output. */
class Server {
  private readonly child: ChildProcess
  private buffer = Buffer.alloc(0)
  private next = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly opened = new Map<string, number>()
  readonly ready: Promise<void>
  lastUsed = Date.now()
  dead = false

  constructor(
    readonly root: string,
    readonly kind: ServerKind,
    program: string,
    args: string[]
  ) {
    this.child = spawn(program, args, { cwd: root, env: commandEnv(), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    this.child.on('exit', () => this.fail('The language server stopped.'))
    this.child.on('error', () => this.fail('The language server couldn’t start.'))
    this.child.stdout!.on('data', (chunk: Buffer) => this.read(chunk))
    this.ready = this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(root).href,
      workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'project' }],
      capabilities: { textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] }, definition: {}, references: {}, documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }
    }).then(() => this.notify('initialized', {}))
  }

  private fail(message: string): void {
    this.dead = true
    for (const waiting of this.pending.values()) waiting.reject(new ToolError(message))
    this.pending.clear()
  }

  private send(message: object): void {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }), 'utf8')
    this.child.stdin!.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]))
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const end = this.buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      const length = Number(/Content-Length: *(\d+)/i.exec(this.buffer.subarray(0, end).toString('ascii'))?.[1] ?? NaN)
      if (!Number.isFinite(length) || this.buffer.length < end + 4 + length) return
      const body = this.buffer.subarray(end + 4, end + 4 + length).toString('utf8')
      this.buffer = this.buffer.subarray(end + 4 + length)
      let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(body)
      } catch {
        continue
      }
      // Requests from the server (configuration, progress) get an empty answer so it carries on.
      if (message.method && message.id !== undefined) {
        this.send({ id: message.id, result: message.method === 'workspace/configuration' ? [] : null })
        continue
      }
      const waiting = message.id !== undefined ? this.pending.get(message.id) : undefined
      if (!waiting) continue
      this.pending.delete(message.id!)
      if (message.error) waiting.reject(new ToolError(message.error.message ?? 'The language server refused that.'))
      else waiting.resolve(message.result)
    }
  }

  request<T = unknown>(method: string, params: object): Promise<T> {
    if (this.dead) return Promise.reject(new ToolError('The language server stopped.'))
    const id = this.next++
    this.lastUsed = Date.now()
    return new Promise<T>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ToolError('The language server took too long.'))
      }, REQUEST_MS)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolvePromise(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        }
      })
      this.send({ id, method, params })
    })
  }

  notify(method: string, params: object): void {
    if (!this.dead) this.send({ method, params })
  }

  /** Tells the server about a file as it is on disk now, so answers match what the model last wrote. */
  async open(full: string): Promise<string> {
    const uri = pathToFileURL(full).href
    const text = await readFile(full, 'utf8')
    const version = (this.opened.get(uri) ?? 0) + 1
    if (version === 1) this.notify('textDocument/didOpen', { textDocument: { uri, languageId: this.kind.language(extname(full)), version, text } })
    else this.notify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] })
    this.opened.set(uri, version)
    return uri
  }

  stop(): void {
    this.dead = true
    this.child.kill()
  }
}

type Location = { uri: string; range: { start: { line: number; character: number } } }

/**
 * Language servers for Terra Code: go to a definition, find references, read a symbol's type and
 * docs, or list a file's symbols, the way an editor does. Only servers already installed (in the
 * project or on PATH) are used; nothing is downloaded. Each starts on first use and stops when idle.
 */
export class CoderLsp {
  private readonly servers = new Map<string, Server>()
  private readonly timer = setInterval(() => this.sweep(), 60_000)

  constructor() {
    this.timer.unref?.()
  }

  /** The kinds of file this project has a server for, by extension, such as ['.ts', '.tsx'] . */
  available(root: string): string[] {
    return KINDS.filter((kind) => kind.programs.some((program) => findProgram(program.name, root))).flatMap((kind) => kind.extensions)
  }

  private server(root: string, file: string): Server {
    const kind = KINDS.find((candidate) => candidate.extensions.includes(extname(file).toLowerCase()))
    if (!kind) throw new ToolError(`There's no language server for ${extname(file) || 'this kind of file'}.`)
    const key = `${root}\n${kind.id}`
    const existing = this.servers.get(key)
    if (existing && !existing.dead) return existing
    const found = kind.programs.map((program) => ({ ...program, path: findProgram(program.name, root) })).find((program) => program.path)
    if (!found) throw new ToolError(`No ${kind.id} language server is installed (such as ${kind.programs[0]!.name}).`)
    const server = new Server(root, kind, found.path!, found.args)
    this.servers.set(key, server)
    return server
  }

  async run(root: string, action: LspAction, path: string, line: number, column: number): Promise<string> {
    const full = resolve(root, path)
    if (relative(root, full).startsWith('..')) throw new ToolError('Only files inside the project folder.')
    const server = this.server(root, full)
    await server.ready
    const uri = await server.open(full)
    const position = { line: Math.max(0, line - 1), character: Math.max(0, column - 1) }
    const shown = async (locations: Location[]) => {
      if (locations.length === 0) return 'Nothing found.'
      const lines = await Promise.all(
        locations.slice(0, MAX_RESULTS).map(async (location) => {
          const file = fileURLToPath(location.uri)
          const text = await readFile(file, 'utf8').catch(() => '')
          const at = location.range.start
          return `${relative(root, file) || file}:${at.line + 1}:${at.character + 1}: ${(text.split('\n')[at.line] ?? '').trim().slice(0, 200)}`
        })
      )
      return `${lines.join('\n')}${locations.length > MAX_RESULTS ? `\n…and ${locations.length - MAX_RESULTS} more` : ''}`
    }
    const asList = (value: unknown): Location[] => (Array.isArray(value) ? value : value ? [value] : []).map((one: { uri?: string; targetUri?: string; range?: Location['range']; targetSelectionRange?: Location['range'] }) => ({ uri: one.uri ?? one.targetUri ?? '', range: one.range ?? one.targetSelectionRange! })).filter((one) => one.uri && one.range)
    if (action === 'definition') return shown(asList(await server.request('textDocument/definition', { textDocument: { uri }, position })))
    if (action === 'references') return shown(asList(await server.request('textDocument/references', { textDocument: { uri }, position, context: { includeDeclaration: false } })))
    if (action === 'hover') {
      const hover = await server.request<{ contents?: unknown } | null>('textDocument/hover', { textDocument: { uri }, position })
      const contents = hover?.contents
      const text = typeof contents === 'string' ? contents : Array.isArray(contents) ? contents.map((part) => (typeof part === 'string' ? part : (part as { value?: string }).value ?? '')).join('\n') : ((contents as { value?: string } | undefined)?.value ?? '')
      return text.trim() || 'Nothing known about that spot.'
    }
    const symbols = await server.request<{ name: string; kind: number; range?: Location['range']; location?: Location; children?: unknown[] }[] | null>('textDocument/documentSymbol', { textDocument: { uri } })
    const lines: string[] = []
    const walk = (list: typeof symbols, depth: number) => {
      for (const symbol of list ?? []) {
        if (lines.length >= 200) return
        const at = symbol.range?.start ?? symbol.location?.range.start
        lines.push(`${'  '.repeat(depth)}${symbol.name}${at ? ` (line ${at.line + 1})` : ''}`)
        walk(symbol.children as typeof symbols, depth + 1)
      }
    }
    walk(symbols, 0)
    return lines.join('\n') || 'No symbols.'
  }

  private sweep(): void {
    for (const [key, server] of this.servers) {
      if (server.dead || Date.now() - server.lastUsed > IDLE_MS) {
        server.stop()
        this.servers.delete(key)
      }
    }
  }

  dispose(): void {
    clearInterval(this.timer)
    for (const server of this.servers.values()) server.stop()
    this.servers.clear()
  }
}
