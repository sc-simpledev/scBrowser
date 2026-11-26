import { execFile } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { CoderDoctorItem, CoderGithubStatus, CoderServerCheck, CoderStatus, McpServerView, Settings } from '@scbrowser/shared'
import { detectDiagnostics } from './coderProject'
import { installedServers } from './coderLsp'
import { findProgram, sandboxAvailable } from './coderTools'

export interface DoctorDeps {
  settings: Settings
  status: CoderStatus
  github: () => Promise<CoderGithubStatus>
  mcp: () => Promise<McpServerView[]>
  server: (host: string) => Promise<CoderServerCheck>
}

const version = (program: string, args: string[]) =>
  new Promise<string | null>((resolve) => execFile(program, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout).trim().split('\n')[0] ?? null)))

const exists = (path: string) => access(path).then(() => true, () => false)

/**
 * Terra Code's setup, checked in one go for /doctor, like Claude Code's: what works, what's missing
 * and what to do about it, in a line each. Nothing here changes anything or reaches a model.
 */
export async function runDoctor({ settings, status, github, mcp, server }: DoctorDeps): Promise<CoderDoctorItem[]> {
  const items: CoderDoctorItem[] = []
  const folder = status.folder
  items.push(status.ready ? { label: 'Model', state: 'ok', detail: `${status.model ?? 'Chosen'}${status.providerName ? ` from ${status.providerName}` : ''}${status.hosted ? ', with scTerra AI’s shared daily limits. Your own key in AI settings has none' : ''}.` } : { label: 'Model', state: 'warn', detail: 'No model is set up. Choose one in AI settings.' })

  const gitVersion = await version('git', ['--version'])
  if (!gitVersion) items.push({ label: 'git', state: 'warn', detail: 'git isn’t installed, so there’s no undoing by commit, no branches and no review of changes. Install git.' })
  if (!folder || !(await stat(folder).then((info) => info.isDirectory(), () => false))) items.push({ label: 'Project', state: 'warn', detail: 'No project folder is chosen, or it has moved. Choose one.' })
  else {
    items.push(status.git ? { label: 'Project', state: 'ok', detail: `${folder}, a git repository${status.branch ? ` on ${status.branch}` : ''}.` } : { label: 'Project', state: 'warn', detail: `${folder} isn’t a git repository, so commits, worktrees and cloud runs aren’t possible. Run git init there.` })
    const notes = await Promise.all(['TERRA.md', 'AGENTS.md', 'CLAUDE.md'].map(async (name) => ((await exists(join(folder, name))) ? name : null)))
    const found = notes.filter(Boolean)
    items.push(found.length ? { label: 'Project notes', state: 'ok', detail: `${found.join(' and ')}, read at the start of every session.` } : { label: 'Project notes', state: 'warn', detail: 'No TERRA.md, AGENTS.md or CLAUDE.md. Run /init to write one, so every session starts knowing the project.' })
    const checks = await detectDiagnostics(folder).catch(() => null)
    items.push(checks ? { label: 'Checks', state: 'ok', detail: `${checks} runs after edits${settings.coderAutoCheck ? '' : ' when asked (running it by itself is off)'}.` } : { label: 'Checks', state: 'off', detail: 'No test, type check or lint script found, so Terra Code can’t check its own work. Add one, or name it in .terra/settings.json as "diagnostics".' })
    const servers = installedServers(folder)
    const have = servers.filter((one) => one.program)
    items.push(have.length ? { label: 'Language servers', state: 'ok', detail: `${have.map((one) => one.program).join(', ')}: go to definition, references, and errors after each edit${settings.coderLspProblems ? '' : ' (turned off)'}.` } : { label: 'Language servers', state: 'off', detail: `None installed, so Terra Code reads code by text alone. For TypeScript, npm i -D typescript-language-server typescript; for Python, pip install pyright.` })
  }

  const sandbox = settings.coderSandbox
  if (sandbox === 'off') items.push({ label: 'Sandbox', state: 'off', detail: sandboxAvailable() ? 'Off: commands you allow run with your own permissions. Turn it on in the session panel to keep their writes inside the project.' : 'Off, and this computer has no sandbox to offer (on Linux, install bubblewrap).' })
  else if (sandbox === 'container') items.push(status.devContainer ? { label: 'Sandbox', state: 'ok', detail: 'Commands run inside the project’s dev container.' } : { label: 'Sandbox', state: 'warn', detail: 'Set to the dev container, but there’s no .devcontainer or devcontainer CLI, so commands run unfenced.' })
  else items.push(sandboxAvailable() ? { label: 'Sandbox', state: 'ok', detail: sandbox === 'offline' ? 'Commands can only write in the project, and can’t reach the network.' : 'Commands can only write in the project and their caches.' } : { label: 'Sandbox', state: 'warn', detail: 'Turned on, but this computer can’t provide one (on Linux, install bubblewrap), so commands run unfenced.' })

  const hub = await github().catch(() => null)
  if (!hub?.source) items.push({ label: 'GitHub', state: 'off', detail: 'Not connected. Connect it in Settings, under Connections, for pull requests, /review #12, /fix-ci and cloud runs.' })
  else if (hub.error) items.push({ label: 'GitHub', state: 'warn', detail: hub.error })
  else items.push({ label: 'GitHub', state: 'ok', detail: `Signed in as ${hub.login ?? 'you'}, ${settings.coderGithub === 'write' ? 'looking and acting' : settings.coderGithub === 'read' ? 'looking only' : 'but turned off'}${hub.repo ? `, on ${hub.repo}` : ''}.` })

  const views = await mcp().catch(() => [] as McpServerView[])
  const on = views.filter((view) => view.enabled)
  const broken = on.filter((view) => view.state === 'error' || view.state === 'signin' || !view.trusted)
  if (!on.length) items.push({ label: 'MCP servers', state: 'off', detail: 'None. Browse servers in Terra Code settings to add one in a click.' })
  else if (broken.length) items.push({ label: 'MCP servers', state: 'warn', detail: broken.map((view) => `${view.name}: ${!view.trusted ? 'waiting for your yes' : view.state === 'signin' ? 'needs you to sign in' : (view.error ?? 'didn’t start')}`).join('; ') })
  else items.push({ label: 'MCP servers', state: 'ok', detail: `${on.map((view) => view.name).join(', ')}, ${on.length === 1 ? 'starts' : 'start'} when a session needs ${on.length === 1 ? 'it' : 'them'}.` })
  if (on.some((view) => /\b(npx|uvx)\b/.test(view.target)) && !findProgram('npx') && !findProgram('uvx')) items.push({ label: 'npx and uvx', state: 'warn', detail: 'Some MCP servers start with npx or uvx, and neither was found. Install Node.js or uv.' })

  if (settings.coderServer) {
    const check = await server(settings.coderServer).catch((error: Error) => ({ ok: false, message: error.message }))
    items.push({ label: 'Your server', state: check.ok ? 'ok' : 'warn', detail: check.message })
  }
  return items
}
