import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'
import { isMcpServerName, type CoderHookEvent, type CoderSource, type McpServerConfig } from '@scbrowser/shared'

/**
 * What a project (in `.terra/`, or `.claude/` as other agents keep it) and the person (in their own
 * Terra Code folder) add to Terra Code: commands, agents, skills, hooks, MCP servers and settings.
 * Everything here is read with size limits, as a project's files can come from anyone.
 */

const MAX_FILE = 64_000
const MAX_DEFS = 60
const PROJECT_DIRS = ['.terra', '.claude']

export interface MarkdownDef {
  name: string
  description: string
  body: string
  source: CoderSource
  /** For agents: the tools it may use. Empty means only looking. */
  tools: string[]
  /** For skills: its folder, so the model can be told what else is in it. */
  dir?: string
}

export interface ProjectSettings {
  /** Commands the project never wants run, as rules like `git push*`. */
  deny: string[]
  /** The command the diagnostics tool runs, if the project names one. */
  diagnostics: string | null
}

const readSmall = async (path: string): Promise<string | null> => {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_FILE) return null
  return readFile(path, 'utf8').catch(() => null)
}

const readJson = async (path: string): Promise<unknown> => {
  const text = await readSmall(path)
  if (text === null) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const strings = (value: unknown, max = 50) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 500).slice(0, max) : [])

/** Frontmatter between `---` lines: simple `key: value` pairs, with lists as `a, b` or `[a, b]`. */
export function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { fields: {}, body: text }
  const fields: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) fields[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '')
  }
  return { fields, body: match[2]! }
}

const list = (value: string | undefined) =>
  (value ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

const cleanName = (name: string) => name.replace(/\.md$/i, '').replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 60)

/** The first sentence of a body, for things that don't say what they are. */
const firstLine = (body: string) => body.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find(Boolean)?.slice(0, 160) ?? ''

async function markdownIn(dir: string, source: CoderSource): Promise<MarkdownDef[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith('.md')).sort().slice(0, MAX_DEFS)
  const defs: MarkdownDef[] = []
  for (const name of names) {
    const text = await readSmall(join(dir, name))
    if (text === null) continue
    const { fields, body } = frontmatter(text)
    defs.push({ name: cleanName(fields.name || name), description: (fields.description || firstLine(body)).slice(0, 300), body: body.trim(), source, tools: list(fields.tools) })
  }
  return defs
}

/** Project ones first, so a project can replace one of the person's own of the same name. */
function merged(groups: MarkdownDef[][]): MarkdownDef[] {
  const seen = new Set<string>()
  return groups.flat().filter((def) => !seen.has(def.name.toLowerCase()) && seen.add(def.name.toLowerCase()))
}

export async function loadDefs(folder: string | null, home: string, kind: 'commands' | 'agents'): Promise<MarkdownDef[]> {
  const project = folder ? await Promise.all(PROJECT_DIRS.map((dir) => markdownIn(join(folder, dir, kind), 'project'))) : []
  return merged([...project, await markdownIn(join(home, kind), 'global')])
}

/** Skills are folders holding a SKILL.md. */
async function skillsIn(dir: string, source: CoderSource): Promise<MarkdownDef[]> {
  const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_DEFS)
  const skills: MarkdownDef[] = []
  for (const entry of entries) {
    const text = await readSmall(join(dir, entry.name, 'SKILL.md'))
    if (text === null) continue
    const { fields, body } = frontmatter(text)
    skills.push({ name: cleanName(fields.name || entry.name), description: (fields.description || firstLine(body)).slice(0, 300), body: body.trim(), source, tools: [], dir: join(dir, entry.name) })
  }
  return skills
}

export async function loadSkills(folder: string | null, home: string): Promise<MarkdownDef[]> {
  const project = folder ? await Promise.all(PROJECT_DIRS.map((dir) => skillsIn(join(folder, dir, 'skills'), 'project'))) : []
  return merged([...project, await skillsIn(join(home, 'skills'), 'global')])
}

export async function projectSettings(folder: string): Promise<ProjectSettings> {
  const data = await readJson(join(folder, '.terra', 'settings.json'))
  const settings = isRecord(data) ? data : {}
  const permissions = isRecord(settings.permissions) ? settings.permissions : {}
  const diagnostics = typeof settings.diagnostics === 'string' && settings.diagnostics.trim() && settings.diagnostics.length < 500 ? settings.diagnostics.trim() : null
  const claude = await claudeSettings(folder)
  return { deny: [...strings(settings.deny), ...strings(permissions.deny), ...claude.deny], diagnostics }
}

/** A Claude Code permission such as `Bash(npm run test:*)` as one of ours (`npm run test*`), or null if it isn't about commands. */
export function claudeRule(rule: string): string | null {
  const match = /^Bash\((.*)\)$/.exec(rule.trim())
  if (!match) return null
  const inner = match[1]!.trim()
  if (!inner) return null
  return inner.endsWith(':*') ? `${inner.slice(0, -2)}*` : inner
}

/**
 * A project's Claude Code settings (`.claude/settings.json`), so a project set up for it works here:
 * its command deny rules apply, its allow rules are only offered to the person, and its hooks
 * become this project's hooks (asked about like any other).
 */
export async function claudeSettings(folder: string): Promise<{ allow: string[]; deny: string[]; hooks: HookSet['hooks'] }> {
  const data = await readJson(join(folder, '.claude', 'settings.json'))
  const settings = isRecord(data) ? data : {}
  const permissions = isRecord(settings.permissions) ? settings.permissions : {}
  const rules = (value: unknown) => strings(value).map(claudeRule).filter((rule): rule is string => rule !== null)
  const hooks: HookSet['hooks'] = []
  const groups = isRecord(settings.hooks) ? settings.hooks : {}
  const events: [string, CoderHookEvent, (matcher: string) => boolean][] = [
    ['PostToolUse', 'afterEdit', (matcher) => !matcher || matcher === '*' || /Edit|Write/.test(matcher)],
    ['PreToolUse', 'beforeCommand', (matcher) => !matcher || matcher === '*' || /\bBash\b/.test(matcher)],
    ['Stop', 'afterTurn', () => true]
  ]
  for (const [name, event, fits] of events) {
    const list = Array.isArray(groups[name]) ? groups[name] : []
    for (const group of list.slice(0, 10)) {
      if (!isRecord(group) || !fits(typeof group.matcher === 'string' ? group.matcher : '')) continue
      for (const hook of (Array.isArray(group.hooks) ? group.hooks : []).slice(0, 10)) {
        if (isRecord(hook) && hook.type === 'command' && typeof hook.command === 'string' && hook.command.length <= 2000) hooks.push({ event, command: hook.command, match: null, claude: true })
      }
    }
  }
  return { allow: rules(permissions.allow), deny: rules(permissions.deny), hooks }
}

export interface HookSet {
  source: CoderSource
  /** Changes whenever the hooks do, so a project's changed hooks are asked about again. */
  hash: string
  /** `claude`: from Claude Code's settings, so it's given Claude's JSON on its input. */
  hooks: { event: CoderHookEvent; command: string; match: string | null; claude?: boolean }[]
}

const HOOK_EVENTS: CoderHookEvent[] = ['afterEdit', 'beforeCommand', 'afterTurn']

function hookSet(data: unknown, source: CoderSource): HookSet | null {
  if (!isRecord(data)) return null
  const hooks: HookSet['hooks'] = []
  for (const event of HOOK_EVENTS) {
    const entries = Array.isArray(data[event]) ? data[event] : []
    for (const entry of entries.slice(0, 10)) {
      const command = typeof entry === 'string' ? entry : isRecord(entry) && typeof entry.command === 'string' ? entry.command : null
      const match = isRecord(entry) && typeof entry.match === 'string' ? entry.match.slice(0, 200) : null
      if (command && command.length <= 2000) hooks.push({ event, command, match })
    }
  }
  return hooks.length ? { source, hooks, hash: createHash('sha256').update(JSON.stringify(hooks)).digest('hex').slice(0, 32) } : null
}

export async function loadHooks(folder: string | null, home: string): Promise<HookSet[]> {
  let project = folder ? hookSet(await readJson(join(folder, '.terra', 'hooks.json')), 'project') : null
  // Claude Code's hooks join the project's own, under one hash, so changing either asks again.
  const claude = folder ? (await claudeSettings(folder)).hooks : []
  if (claude.length) {
    const hooks = [...(project?.hooks ?? []), ...claude]
    project = { source: 'project', hooks, hash: createHash('sha256').update(JSON.stringify(hooks)).digest('hex').slice(0, 32) }
  }
  const sets = [project, hookSet(await readJson(join(home, 'hooks.json')), 'global')]
  return sets.filter((set): set is HookSet => set !== null)
}

/** `.mcp.json` (as other agents keep it) and `.terra/mcp.json`: `{"mcpServers": {"name": {...}}}`. */
export async function projectMcp(folder: string): Promise<McpServerConfig[]> {
  const servers: McpServerConfig[] = []
  for (const file of [join(folder, '.terra', 'mcp.json'), join(folder, '.mcp.json')]) {
    const data = await readJson(file)
    const found = isRecord(data) && isRecord(data.mcpServers) ? data.mcpServers : {}
    for (const [name, raw] of Object.entries(found).slice(0, 20)) {
      const server = mcpConfig(name, raw)
      if (server && !servers.some((other) => other.name === server.name)) servers.push(server)
    }
  }
  return servers
}

/** One server's settings in the usual shape, or null if they can't be used. */
export function mcpConfig(name: string, raw: unknown): McpServerConfig | null {
  if (!isMcpServerName(name) || !isRecord(raw)) return null
  const record = (value: unknown) => (isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].length <= 200 && entry[1].length <= 4000).slice(0, 40)) : {})
  const enabled = raw.disabled !== true && raw.enabled !== false
  const url = typeof raw.url === 'string' ? raw.url : null
  if (url && /^https?:\/\//i.test(url) && url.length <= 2048) return { name, type: 'http', url, headers: record(raw.headers), enabled }
  if (typeof raw.command !== 'string' || !raw.command.trim() || raw.command.length > 1000) return null
  return { name, type: 'stdio', command: raw.command.trim(), args: strings(raw.args, 60), env: record(raw.env), enabled }
}

/** Names a server's settings, so trusting one doesn't carry over once a project changes it. */
export const configHash = (server: McpServerConfig) => createHash('sha256').update(JSON.stringify(server)).digest('hex').slice(0, 32)

/** A type checker or linter the project already uses, for the diagnostics tool. */
export async function detectDiagnostics(folder: string): Promise<string | null> {
  const has = (name: string) => stat(join(folder, name)).then(() => true, () => false)
  const pkg = await readJson(join(folder, 'package.json'))
  const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts : {}
  const runner = (await has('pnpm-lock.yaml')) ? 'pnpm' : (await has('yarn.lock')) ? 'yarn' : (await has('bun.lockb')) || (await has('bun.lock')) ? 'bun run' : 'npm run'
  for (const script of ['typecheck', 'type-check', 'check-types', 'tsc', 'lint']) if (typeof scripts[script] === 'string') return `${runner} ${script}`
  if (await has('tsconfig.json')) return 'npx tsc --noEmit'
  if (await has('Cargo.toml')) return 'cargo check --message-format short'
  if (await has('go.mod')) return 'go vet ./...'
  if ((await has('pyproject.toml')) || (await has('ruff.toml'))) return 'ruff check .'
  return null
}

const JS_LIKE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.jsonc', '.css', '.scss', '.less', '.md', '.mdx', '.html', '.vue', '.svelte', '.yaml', '.yml', '.graphql'])
const PRETTIER_CONFIGS = ['.prettierrc', '.prettierrc.json', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs']

/** A path as one word for the person's shell. */
export function shellQuote(text: string): string {
  if (process.platform === 'win32') return `"${text.replace(/"/g, '""')}"`
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** A program on the PATH, found without running anything. */
function onPath(name: string): string | null {
  const windows = process.platform === 'win32'
  for (const dir of (process.env.PATH ?? '').split(windows ? ';' : ':')) {
    if (!dir) continue
    for (const candidate of windows ? [`${name}.exe`, `${name}.cmd`] : [name]) {
      const full = join(dir, candidate)
      if (existsSync(full)) return full
    }
  }
  return null
}

/** A formatter the project has installed in node_modules: never fetched, as npx would. */
function localBin(folder: string, name: string): string | null {
  const full = join(folder, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name)
  return existsSync(full) ? full : null
}

export interface Formatter {
  name: string
  /** What trusting it is remembered by. */
  key: string
  command: string
  /** The command with a short path, for asking about it. */
  example: string
}

/**
 * The formatter this project uses for a file, if it clearly uses one: Biome or Prettier installed
 * in the project with their settings present, Ruff or Black set up in pyproject.toml, gofmt for Go
 * modules and rustfmt for Cargo projects. Anything else, or nothing set up, gives null.
 */
export async function formatterFor(folder: string, file: string): Promise<Formatter | null> {
  const ext = extname(file).toLowerCase()
  const has = (name: string) => existsSync(join(folder, name))
  const shortPath = relative(folder, file).split(sep).join('/')
  const make = (name: string, key: string, program: string, args: string[]) => ({
    name,
    key,
    command: [shellQuote(program), ...args.map((arg) => (arg === '$FILE' ? shellQuote(file) : arg))].join(' '),
    example: [basename(program).replace(/\.(cmd|exe)$/, ''), ...args.map((arg) => (arg === '$FILE' ? shortPath : arg))].join(' ')
  })
  if (JS_LIKE.has(ext)) {
    const biome = localBin(folder, 'biome')
    if (biome && (has('biome.json') || has('biome.jsonc'))) return make('Biome', 'biome', biome, ['format', '--write', '$FILE'])
    const prettier = localBin(folder, 'prettier')
    if (prettier) {
      const pkg = await readJson(join(folder, 'package.json'))
      if (PRETTIER_CONFIGS.some(has) || (isRecord(pkg) && pkg.prettier !== undefined)) return make('Prettier', 'prettier', prettier, ['--write', '--log-level', 'warn', '$FILE'])
    }
    return null
  }
  if (ext === '.py') {
    const pyproject = (await readSmall(join(folder, 'pyproject.toml'))) ?? ''
    const ruff = onPath('ruff')
    if (ruff && (has('ruff.toml') || has('.ruff.toml') || /^\[tool\.ruff/m.test(pyproject))) return make('Ruff', 'ruff', ruff, ['format', '$FILE'])
    const black = onPath('black')
    if (black && /^\[tool\.black\]/m.test(pyproject)) return make('Black', 'black', black, ['-q', '$FILE'])
    return null
  }
  if (ext === '.go' && has('go.mod')) {
    const gofmt = onPath('gofmt')
    return gofmt ? make('gofmt', 'gofmt', gofmt, ['-w', '$FILE']) : null
  }
  if (ext === '.rs' && has('Cargo.toml')) {
    const rustfmt = onPath('rustfmt')
    return rustfmt ? make('rustfmt', 'rustfmt', rustfmt, ['--edition', '2021', '$FILE']) : null
  }
  return null
}
