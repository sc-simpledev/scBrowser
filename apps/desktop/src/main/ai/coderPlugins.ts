import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isCoderPluginName, type CoderPlugin, type CoderPluginPreview, type McpServerConfig } from '@scbrowser/shared'
import { commandEnv } from './coderTools'
import { frontmatter, mcpConfig } from './coderProject'

/**
 * Terra Code plugins, in Claude Code's layout: a folder (usually a Git repository) holding
 * `.claude-plugin/plugin.json` with commands/, agents/, skills/, hooks/hooks.json and .mcp.json.
 * A repository with `.claude-plugin/marketplace.json` offers several. Every piece is listed before
 * anything is added, and an installed plugin is a copy in Terra Code's own folder, so nothing in it
 * changes unless the person installs it again.
 */

const MAX_FILE = 256_000
const MAX_PIECES = 60
const STAGING_TTL_MS = 60 * 60_000
const MANIFEST_DIRS = ['.claude-plugin', '.terra-plugin']

interface Saved {
  name: string
  description: string
  version: string
  source: string
  enabled: boolean
  installedAt: number
}

const pluginsRoot = (home: string) => join(home, 'plugins')
const stateFile = (home: string) => join(pluginsRoot(home), 'plugins.json')
const stagingRoot = (home: string) => join(pluginsRoot(home), '.incoming')

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

async function readJson(path: string): Promise<unknown> {
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size > MAX_FILE) return undefined
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

async function saved(home: string): Promise<Saved[]> {
  const data = await readJson(stateFile(home))
  return Array.isArray(data) ? data.filter((one): one is Saved => isRecord(one) && typeof one.name === 'string' && isCoderPluginName(one.name)) : []
}

async function save(home: string, list: Saved[]): Promise<void> {
  await mkdir(pluginsRoot(home), { recursive: true })
  await writeFile(stateFile(home), JSON.stringify(list, null, 2))
}

/** The folders of plugins that are on, for the loaders of commands, agents, skills, hooks and MCP servers. */
export async function pluginDirs(home: string): Promise<{ name: string; dir: string }[]> {
  if (!home) return []
  return (await saved(home)).filter((one) => one.enabled).map((one) => ({ name: one.name, dir: join(pluginsRoot(home), one.name) }))
}

async function names(dir: string, kind: 'md' | 'skills'): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  if (kind === 'skills') return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().slice(0, MAX_PIECES)
  return entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md')).map((entry) => entry.name.replace(/\.md$/i, '')).sort().slice(0, MAX_PIECES)
}

/** A plugin's hooks, in Claude Code's `hooks/hooks.json` shape, as event and command. */
export async function pluginHookList(dir: string): Promise<{ event: string; matcher: string; command: string }[]> {
  const data = await readJson(join(dir, 'hooks', 'hooks.json'))
  const groups = isRecord(data) && isRecord(data.hooks) ? data.hooks : {}
  const found: { event: string; matcher: string; command: string }[] = []
  for (const [event, list] of Object.entries(groups)) {
    for (const group of (Array.isArray(list) ? list : []).slice(0, 10)) {
      if (!isRecord(group)) continue
      for (const hook of (Array.isArray(group.hooks) ? group.hooks : []).slice(0, 10)) {
        if (isRecord(hook) && hook.type === 'command' && typeof hook.command === 'string' && hook.command.length <= 2000)
          found.push({ event, matcher: typeof group.matcher === 'string' ? group.matcher : '', command: hook.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', dir) })
      }
    }
  }
  return found.slice(0, MAX_PIECES)
}

/** A plugin's MCP servers, from `.mcp.json` or the manifest's `mcpServers`. */
export async function pluginMcpOf(dir: string, manifest?: Record<string, unknown>): Promise<McpServerConfig[]> {
  const file = await readJson(join(dir, '.mcp.json'))
  const fromFile = isRecord(file) && isRecord(file.mcpServers) ? file.mcpServers : isRecord(file) ? file : {}
  const fromManifest = manifest && isRecord(manifest.mcpServers) ? manifest.mcpServers : {}
  const servers: McpServerConfig[] = []
  for (const [name, raw] of Object.entries({ ...fromFile, ...fromManifest }).slice(0, 20)) {
    // The plugin's own folder stands in for ${CLAUDE_PLUGIN_ROOT}, as in Claude Code.
    const filled = JSON.parse(JSON.stringify(raw ?? null).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir.replaceAll('\\', '\\\\'))) as unknown
    const server = mcpConfig(name, filled)
    if (server) servers.push(server)
  }
  return servers
}

async function manifestOf(dir: string): Promise<Record<string, unknown> | null> {
  for (const folder of MANIFEST_DIRS) {
    const data = await readJson(join(dir, folder, 'plugin.json'))
    if (isRecord(data)) return data
  }
  return null
}

const cleanPluginName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

/** What one plugin folder holds, as the person sees it before adding it. */
async function describe(dir: string, fallbackName: string, source: string, enabled = true): Promise<CoderPlugin | null> {
  const manifest = (await manifestOf(dir)) ?? {}
  const [commands, agents, skills, hooks, mcp] = await Promise.all([names(join(dir, 'commands'), 'md'), names(join(dir, 'agents'), 'md'), names(join(dir, 'skills'), 'skills'), pluginHookList(dir), pluginMcpOf(dir, manifest)])
  if (!commands.length && !agents.length && !skills.length && !hooks.length && !mcp.length) return null
  const name = cleanPluginName(typeof manifest.name === 'string' ? manifest.name : fallbackName)
  if (!isCoderPluginName(name)) return null
  let description = typeof manifest.description === 'string' ? manifest.description.slice(0, 300) : ''
  if (!description) {
    const readme = await readFile(join(dir, 'README.md'), 'utf8').catch(() => '')
    description = frontmatter(readme).body.split('\n').map((line) => line.replace(/^#+\s*/, '').trim()).find((line) => line && !line.startsWith('!['))?.slice(0, 300) ?? ''
  }
  return {
    name,
    description,
    version: typeof manifest.version === 'string' ? manifest.version.slice(0, 40) : '',
    source,
    enabled,
    commands,
    agents,
    skills,
    hooks: hooks.map((hook) => `${hook.event}${hook.matcher ? ` (${hook.matcher})` : ''}: ${hook.command}`),
    mcp: mcp.map((server) => `${server.name}: ${server.type === 'http' ? server.url : [server.command, ...server.args].join(' ')}`)
  }
}

/** Where a typed source points: owner/name on GitHub, a Git address, or a folder on this computer. */
export function pluginSource(input: string): { kind: 'git'; url: string } | { kind: 'folder'; path: string } {
  const text = input.trim()
  if (!text || text.length > 500 || /[\s\0]/.test(text) || text.startsWith('-')) throw new Error('Give a Git address, owner/name on GitHub, or a folder.')
  if (/^[\w.-]+\/[\w.-]+$/.test(text) && !text.startsWith('.')) return { kind: 'git', url: `https://github.com/${text.replace(/\.git$/, '')}.git` }
  if (/^(https:\/\/|git@|ssh:\/\/)/i.test(text)) return { kind: 'git', url: text }
  if (isAbsolute(text) || text.startsWith('~')) return { kind: 'folder', path: text.startsWith('~') ? join(process.env.HOME ?? '', text.slice(1)) : text }
  throw new Error('Give a Git address (https:// or git@), owner/name on GitHub, or a whole folder path.')
}

function clone(url: string, into: string): Promise<void> {
  return new Promise((done, fail) =>
    execFile('git', ['clone', '--depth', '1', '--', url, into], { env: { ...commandEnv(), GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=15' }, timeout: 3 * 60_000, windowsHide: true }, (error, _out, stderr) => {
      if (!error) return done()
      fail(new Error(String(stderr).split('\n').filter((line) => /fatal|error/i.test(line)).join(' ').slice(0, 300) || 'Couldn’t download it. Check the address, and that it’s public or you can reach it with git.'))
    })
  )
}

/** Fetches a plugin (or a marketplace of them) into a holding folder and lists what's in it. Nothing is added yet. */
export async function previewPlugins(home: string, input: string): Promise<CoderPluginPreview> {
  const source = pluginSource(input)
  await mkdir(stagingRoot(home), { recursive: true })
  // Old holding folders from previews never installed.
  for (const entry of await readdir(stagingRoot(home), { withFileTypes: true }).catch(() => [])) {
    const path = join(stagingRoot(home), entry.name)
    const info = await stat(path).catch(() => null)
    if (info && Date.now() - info.mtimeMs > STAGING_TTL_MS) await rm(path, { recursive: true, force: true })
  }
  const id = randomUUID()
  const dir = join(stagingRoot(home), id)
  if (source.kind === 'git') await clone(source.url, dir)
  else {
    const info = await stat(source.path).catch(() => null)
    if (!info?.isDirectory()) throw new Error('That folder can’t be found.')
    await cp(source.path, dir, { recursive: true, filter: (from) => !from.split(sep).includes('.git') && !from.split(sep).includes('node_modules') })
  }
  const shown = source.kind === 'git' ? input.trim() : source.path
  await writeFile(join(dir, '.source.json'), JSON.stringify({ source: shown }))
  const repoName = basename(source.kind === 'git' ? source.url.replace(/\.git$/, '') : source.path)
  const plugins: CoderPreviewEntry[] = []
  const market = (await readJson(join(dir, '.claude-plugin', 'marketplace.json'))) ?? (await readJson(join(dir, '.terra-plugin', 'marketplace.json')))
  if (isRecord(market) && Array.isArray(market.plugins)) {
    for (const entry of market.plugins.slice(0, 40)) {
      if (!isRecord(entry) || typeof entry.name !== 'string') continue
      const from = typeof entry.source === 'string' ? entry.source : isRecord(entry.source) && typeof entry.source.path === 'string' ? entry.source.path : null
      if (!from) continue
      const inner = resolve(dir, from)
      const rel = relative(dir, inner)
      if (rel.startsWith('..') || isAbsolute(rel)) continue
      const described = await describe(inner, entry.name, shown)
      if (described) plugins.push({ ...described, description: described.description || (typeof entry.description === 'string' ? entry.description.slice(0, 300) : ''), path: rel })
    }
  } else {
    const described = await describe(dir, repoName, shown)
    if (described) plugins.push({ ...described, path: '' })
  }
  if (plugins.length === 0) {
    await rm(dir, { recursive: true, force: true })
    throw new Error('There’s no plugin there: no .claude-plugin/plugin.json, and no commands, agents, skills, hooks or MCP servers.')
  }
  const installed = new Set((await saved(home)).map((one) => one.name))
  return { id, source: shown, plugins: plugins.map(({ path: _path, ...plugin }) => ({ ...plugin, installed: installed.has(plugin.name) })) }
}

type CoderPreviewEntry = CoderPlugin & { path: string }

/** Adds a previewed plugin (by name, for a marketplace), replacing an older copy of it. */
export async function installPlugin(home: string, previewId: string, name: string): Promise<CoderPlugin> {
  if (!/^[0-9a-f-]{36}$/.test(previewId)) throw new Error('That preview is gone. Look it up again.')
  const dir = join(stagingRoot(home), previewId)
  const info = await stat(dir).catch(() => null)
  if (!info?.isDirectory()) throw new Error('That preview is gone. Look it up again.')
  const market = (await readJson(join(dir, '.claude-plugin', 'marketplace.json'))) ?? (await readJson(join(dir, '.terra-plugin', 'marketplace.json')))
  const sourceLine = (await readJson(join(dir, '.source.json'))) as { source?: string } | undefined
  const shown = sourceLine?.source ?? ''
  let from: string | null = null
  let described: CoderPlugin | null = null
  if (isRecord(market) && Array.isArray(market.plugins)) {
    for (const entry of market.plugins.slice(0, 40)) {
      if (!isRecord(entry) || typeof entry.name !== 'string') continue
      const path = typeof entry.source === 'string' ? entry.source : isRecord(entry.source) && typeof entry.source.path === 'string' ? entry.source.path : null
      if (!path) continue
      const inner = resolve(dir, path)
      const rel = relative(dir, inner)
      if (rel.startsWith('..') || isAbsolute(rel)) continue
      const found = await describe(inner, entry.name, shown)
      if (found?.name === name) {
        from = inner
        described = found
        break
      }
    }
  } else {
    described = await describe(dir, name, shown)
    from = dir
  }
  if (!described || !from || described.name !== name) throw new Error('That plugin isn’t in this preview.')
  const target = join(pluginsRoot(home), name)
  await rm(target, { recursive: true, force: true })
  await cp(from, target, { recursive: true, filter: (path) => !path.split(sep).includes('.git') && basename(path) !== '.source.json' })
  const list = (await saved(home)).filter((one) => one.name !== name)
  const source = described.source
  list.push({ name, description: described.description, version: described.version, source, enabled: true, installedAt: Date.now() })
  await save(home, list)
  return { ...described, enabled: true }
}

export async function listPlugins(home: string): Promise<CoderPlugin[]> {
  const out: CoderPlugin[] = []
  for (const one of await saved(home)) {
    const described = await describe(join(pluginsRoot(home), one.name), one.name, one.source, one.enabled)
    if (described) out.push({ ...described, name: one.name, enabled: one.enabled, source: one.source })
  }
  return out
}

export async function setPluginEnabled(home: string, name: string, enabled: boolean): Promise<void> {
  const list = await saved(home)
  if (!list.some((one) => one.name === name)) throw new Error('That plugin isn’t installed.')
  await save(home, list.map((one) => (one.name === name ? { ...one, enabled } : one)))
}

export async function removePlugin(home: string, name: string): Promise<void> {
  if (!isCoderPluginName(name)) throw new Error('That plugin isn’t installed.')
  await save(home, (await saved(home)).filter((one) => one.name !== name))
  await rm(join(pluginsRoot(home), name), { recursive: true, force: true })
}

/** MCP servers from plugins that are on, named after their plugin so they can't take a person's own server's name. */
export async function pluginServers(home: string): Promise<McpServerConfig[]> {
  const servers: McpServerConfig[] = []
  for (const { dir } of await pluginDirs(home)) {
    const manifest = (await manifestOf(dir)) ?? undefined
    servers.push(...(await pluginMcpOf(dir, manifest)))
  }
  return servers.slice(0, 20)
}
