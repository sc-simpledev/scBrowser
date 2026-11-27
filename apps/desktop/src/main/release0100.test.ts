import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CoderEvent } from '@scbrowser/shared'
import { Coder, hookAnswer, noteImports, projectContext } from './ai/coder'
import { abortMidway, createPullRequest, gitState, mergeBranch, mergePullRequest, parsePrDraft, prMaterial, pull, push, switchBranch, type ShipGithub } from './ai/coderShip'
import { installPlugin, listPlugins, pluginDirs, pluginServers, pluginSource, previewPlugins, removePlugin, setPluginEnabled } from './ai/coderPlugins'
import { loadDefs, loadHooks, loadSkills } from './ai/coderProject'
import { inside, setExtraRoots } from './ai/coderTools'
import { runStatusLine } from './ai/coderStatusLine'
import { transcribe, voiceRoute, voiceRouteFor } from './ai/voice'
import { ChatTools, HISTORY_TOOL, historyLines } from './ai/chatTools'
import { notificationLabel, SiteNotifications } from './siteNotifications'
import { Agent, AGENT_PLAN_PROMPT } from './ai/agent'
import { selfEnv, selfLauncher } from './selfLaunch'
import { createRequire } from 'node:module'

const posixOnly = process.platform === 'win32'
let root = ''
beforeAll(() => {
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@example.com', GIT_CONFIG_NOSYSTEM: '1' })
})
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'release0100-')))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

/** A project with one commit, pushed to a bare repository standing in for GitHub. */
async function project(): Promise<{ work: string; bare: string }> {
  const bare = join(root, 'remote.git')
  const work = join(root, 'work')
  git(root, 'init', '--bare', '-b', 'main', bare)
  await mkdir(work)
  git(work, 'init', '-b', 'main')
  await writeFile(join(work, 'a.txt'), 'one\n')
  git(work, 'add', '-A')
  git(work, 'commit', '-m', 'First')
  git(work, 'remote', 'add', 'origin', bare)
  git(work, 'push', '-u', 'origin', 'main')
  return { work, bare }
}

/** Another clone of the same remote, as a colleague pushing their own commits. */
async function colleague(bare: string): Promise<string> {
  const other = join(root, 'other')
  git(root, 'clone', bare, other)
  return other
}

describe('Terra Code git: push, pull, branches', () => {
  it.skipIf(posixOnly)('reads where the branch stands and pushes new commits', async () => {
    const { work } = await project()
    await writeFile(join(work, 'b.txt'), 'two\n')
    git(work, 'add', '-A')
    git(work, 'commit', '-m', 'Second')
    await writeFile(join(work, 'c.txt'), 'dirty\n')
    const before = await gitState(work, null, false)
    expect(before).toMatchObject({ branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, dirty: 1, conflicts: [], midway: null, remote: true, repo: null, defaultBranch: 'main' })
    expect(await push(work, null)).toBe('Pushed a commit to origin/main.')
    expect((await gitState(work, null, false)).ahead).toBe(0)
  })

  it.skipIf(posixOnly)('stops a push that carries a key, unless told to go ahead', async () => {
    const { work } = await project()
    await writeFile(join(work, 'config.js'), `const key = 'sk-ant-api03-${'A'.repeat(90)}'\n`)
    git(work, 'add', '-A')
    git(work, 'commit', '-m', 'Config')
    await expect(push(work, null)).rejects.toThrow(/secret/i)
    expect(await push(work, null, true)).toMatch(/^Pushed/)
  })

  it.skipIf(posixOnly)('pulls new commits, fast-forwarding, and says when there’s nothing new', async () => {
    const { work, bare } = await project()
    const other = await colleague(bare)
    await writeFile(join(other, 'theirs.txt'), 'x\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-m', 'Theirs')
    git(other, 'push')
    expect(await pull(work, null)).toBe('Pulled a commit from origin/main.')
    expect(existsSync(join(work, 'theirs.txt'))).toBe(true)
    expect(await pull(work, null)).toBe('Already up to date.')
  })

  it.skipIf(posixOnly)('tells a push that’s behind to pull first, and a pull that conflicts stops for resolving or giving up', async () => {
    const { work, bare } = await project()
    const other = await colleague(bare)
    await writeFile(join(other, 'a.txt'), 'theirs\n')
    git(other, 'commit', '-am', 'Theirs')
    git(other, 'push')
    await writeFile(join(work, 'a.txt'), 'mine\n')
    git(work, 'commit', '-am', 'Mine')
    await expect(push(work, null)).rejects.toThrow('Pull first')
    await expect(pull(work, null)).rejects.toThrow(/^CONFLICTS: /)
    const stopped = await gitState(work, null, false)
    expect(stopped.midway).toBe('merge')
    expect(stopped.conflicts).toEqual(['a.txt'])
    await expect(push(work, null)).rejects.toThrow('Finish or give up the merge first.')
    expect(await abortMidway(work)).toMatch(/Gave up the merge/)
    expect((await gitState(work, null, false)).midway).toBeNull()
    expect(await readFile(join(work, 'a.txt'), 'utf8')).toBe('mine\n')
  })

  it.skipIf(posixOnly)('makes and switches branches, pushes a new one, and merges one into another', async () => {
    const { work } = await project()
    expect(await switchBranch(work, 'feature/login', true, null)).toBe('Made feature/login and switched to it.')
    await writeFile(join(work, 'login.txt'), 'in\n')
    git(work, 'add', '-A')
    git(work, 'commit', '-m', 'Login')
    const fresh = await gitState(work, null, false)
    expect(fresh).toMatchObject({ branch: 'feature/login', upstream: null, ahead: 1 })
    expect(fresh.branches.slice(0, 2)).toEqual(['feature/login', 'main'])
    expect(await push(work, null)).toBe('Pushed a commit to origin/feature/login.')
    expect((await gitState(work, null, false)).upstream).toBe('origin/feature/login')
    expect(await switchBranch(work, 'main', false, null)).toBe('Switched to main.')
    expect(await mergeBranch(work, 'feature/login')).toBe('Merged feature/login into main.')
    expect(existsSync(join(work, 'login.txt'))).toBe(true)
    await expect(switchBranch(work, '-oops', true, null)).rejects.toThrow('isn’t a branch name')
    await writeFile(join(work, 'a.txt'), 'changed\n')
    await expect(mergeBranch(work, 'feature/login')).rejects.toThrow('Commit your changes first')
  })

  it.skipIf(posixOnly)('gathers the commits for a pull request description, and reads what the model wrote', async () => {
    const { work } = await project()
    git(work, 'switch', '-c', 'fix/typo')
    await writeFile(join(work, 'a.txt'), 'one, fixed\n')
    git(work, 'commit', '-am', 'Fix the typo in a.txt')
    const material = await prMaterial(work, 'main')
    expect(material).toContain('Fix the typo in a.txt')
    expect(material).toContain('a.txt')
    expect(parsePrDraft('```json\n{"title":"Fix the typo","body":"## Summary\\n- fixed"}\n```', 'x')).toEqual({ title: 'Fix the typo', body: '## Summary\n- fixed' })
    expect(parsePrDraft('# Fix the typo\nBecause.', 'x')).toEqual({ title: 'Fix the typo', body: 'Because.' })
    expect(parsePrDraft('', 'Fix typo')).toEqual({ title: 'Fix typo', body: '' })
  })
})

describe('Terra Code git: pull requests on GitHub', () => {
  /** A stand-in for GitHub's API that records what was asked. */
  function stubGithub() {
    const calls: { method: string; path: string; body?: unknown }[] = []
    let state: 'open' | 'closed' = 'open'
    let merged = false
    const pullBody = () => ({ number: 7, title: 'Add login', html_url: 'https://github.com/acme/app/pull/7', state, merged, draft: false, mergeable: true, base: { ref: 'main' }, head: { sha: 'abc', ref: 'feature/login' } })
    const github: ShipGithub = {
      token: async () => 'token',
      call: async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
        calls.push({ method, path, body })
        if (method === 'POST' && path === '/repos/acme/app/pulls') return pullBody() as T
        if (method === 'GET' && path.startsWith('/repos/acme/app/pulls?head=')) return [pullBody()] as T
        if (method === 'GET' && path === '/repos/acme/app/pulls/7') return pullBody() as T
        if (method === 'PUT' && path === '/repos/acme/app/pulls/7/merge') {
          state = 'closed'
          merged = true
          return { merged: true } as T
        }
        if (path.endsWith('/check-runs?per_page=100')) return { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }] } as T
        if (path.endsWith('/status')) return { statuses: [] } as T
        if (method === 'DELETE') return undefined as T
        throw new Error(`Unexpected ${method} ${path}`)
      }
    }
    return { github, calls }
  }

  /** origin says github.com/acme/app, as people's projects do; git itself is sent to the bare stand-in. */
  async function onGithub() {
    const made = await project()
    git(made.work, 'remote', 'set-url', 'origin', 'https://github.com/acme/app.git')
    git(made.work, 'config', `url.${made.bare}.insteadOf`, 'https://github.com/acme/app.git')
    return made
  }

  it.skipIf(posixOnly)('opens a pull request, pushing the branch first, and reads it back with its checks', async () => {
    const { work } = await onGithub()
    const { github, calls } = stubGithub()
    git(work, 'switch', '-c', 'feature/login')
    await writeFile(join(work, 'login.txt'), 'in\n')
    git(work, 'add', '-A')
    git(work, 'commit', '-m', 'Login')
    const state = await gitState(work, github, true)
    expect(state).toMatchObject({ repo: 'acme/app', github: true, branch: 'feature/login' })
    expect(state.pr).toMatchObject({ number: 7, checks: 'pending', state: 'open' })
    await expect(createPullRequest(work, github, { title: 'Add login', body: 'Why', base: 'feature/login', draft: false })).rejects.toThrow('Make a branch')
    const pr = await createPullRequest(work, github, { title: 'Add login', body: 'Why', base: 'main', draft: true })
    expect(pr).toMatchObject({ number: 7, url: 'https://github.com/acme/app/pull/7' })
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ title: 'Add login', body: 'Why', head: 'feature/login', base: 'main', draft: true })
    expect(git(work, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/feature/login')
  })

  it.skipIf(posixOnly)('merges on GitHub, then goes back to the base and removes the branch here and there', async () => {
    const { work } = await onGithub()
    const { github, calls } = stubGithub()
    git(work, 'switch', '-c', 'feature/login')
    await writeFile(join(work, 'login.txt'), 'in\n')
    git(work, 'add', '-A')
    git(work, 'commit', '-m', 'Login')
    git(work, 'push', '-u', 'origin', 'feature/login')
    const said = await mergePullRequest(work, github, 7, 'squash', true)
    expect(said).toContain('Merged #7 into main (squashed).')
    expect(said).toContain('Removed feature/login from GitHub.')
    expect(said).toContain('Switched to main and pulled.')
    expect(said).toContain('Removed feature/login here.')
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ merge_method: 'squash', sha: 'abc' })
    expect(calls.some((call) => call.method === 'DELETE' && call.path === '/repos/acme/app/git/refs/heads/feature/login')).toBe(true)
    expect(git(work, 'branch', '--show-current')).toBe('main')
    await expect(mergePullRequest(work, github, 7, 'squash', true)).rejects.toThrow('already merged')
  })
})

describe('Terra Code plugins', () => {
  /** A plugin in Claude Code's layout, with one of each piece. */
  async function plugin(dir: string, name = 'review-kit') {
    await mkdir(join(dir, '.claude-plugin'), { recursive: true })
    await writeFile(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '1.2.0', description: 'Reviews and checks' }))
    await mkdir(join(dir, 'commands'))
    await writeFile(join(dir, 'commands', 'deep-review.md'), '---\ndescription: A deep review\n---\nReview $ARGUMENTS carefully.')
    await mkdir(join(dir, 'agents'))
    await writeFile(join(dir, 'agents', 'critic.md'), '---\nname: critic\ndescription: Finds problems\n---\nBe critical.')
    await mkdir(join(dir, 'skills', 'changelog'), { recursive: true })
    await writeFile(join(dir, 'skills', 'changelog', 'SKILL.md'), '---\nname: changelog\ndescription: Writes changelogs\n---\nSteps.')
    await mkdir(join(dir, 'hooks'))
    await writeFile(join(dir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/check.sh' }] }] } }))
    await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { lint: { command: '${CLAUDE_PLUGIN_ROOT}/server', args: ['--stdio'] } } }))
  }

  it('reads sources as people type them', () => {
    expect(pluginSource('anthropics/claude-code')).toEqual({ kind: 'git', url: 'https://github.com/anthropics/claude-code.git' })
    expect(pluginSource('git@github.com:me/kit.git')).toEqual({ kind: 'git', url: 'git@github.com:me/kit.git' })
    expect(pluginSource('/home/me/kit')).toEqual({ kind: 'folder', path: '/home/me/kit' })
    expect(() => pluginSource('--upload-pack=evil')).toThrow()
    expect(() => pluginSource('kit')).toThrow()
  })

  it('lists every piece before adding, then loads its commands, agents, skills, hooks and servers', async () => {
    const source = join(root, 'kit')
    const home = join(root, 'home')
    await plugin(source)
    const preview = await previewPlugins(home, source)
    expect(preview.plugins).toHaveLength(1)
    const listed = preview.plugins[0]!
    expect(listed).toMatchObject({ name: 'review-kit', version: '1.2.0', commands: ['deep-review'], agents: ['critic'], skills: ['changelog'], installed: false })
    expect(listed.hooks[0]).toMatch(/^Stop: .*\/check\.sh$/)
    expect(listed.mcp[0]).toMatch(/^lint: .*\/server --stdio$/)
    // Nothing is added by looking.
    expect(await pluginDirs(home)).toEqual([])
    await installPlugin(home, preview.id, 'review-kit')
    const installedDir = join(home, 'plugins', 'review-kit')
    expect((await loadDefs(null, home, 'commands')).map((def) => def.name)).toContain('deep-review')
    expect((await loadDefs(null, home, 'agents')).map((def) => def.name)).toContain('critic')
    expect((await loadSkills(null, home)).map((def) => def.name)).toContain('changelog')
    const hooks = (await loadHooks(null, home)).flatMap((set) => set.hooks)
    expect(hooks).toEqual([{ event: 'afterTurn', command: `${installedDir}/check.sh`, match: null, claude: true }])
    expect(await pluginServers(home)).toEqual([{ name: 'lint', type: 'stdio', command: `${installedDir}/server`, args: ['--stdio'], env: {}, enabled: true }])
    // Turned off, it brings nothing; removed, it's gone.
    await setPluginEnabled(home, 'review-kit', false)
    expect((await loadDefs(null, home, 'commands')).map((def) => def.name)).not.toContain('deep-review')
    expect(await pluginServers(home)).toEqual([])
    expect((await listPlugins(home))[0]).toMatchObject({ name: 'review-kit', enabled: false })
    await removePlugin(home, 'review-kit')
    expect(await listPlugins(home)).toEqual([])
    expect(existsSync(installedDir)).toBe(false)
  })

  it('offers each plugin in a marketplace, and installs the one picked', async () => {
    const market = join(root, 'market')
    await plugin(join(market, 'plugins', 'one'), 'one')
    await plugin(join(market, 'plugins', 'two'), 'two')
    await mkdir(join(market, '.claude-plugin'), { recursive: true })
    await writeFile(join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'm', plugins: [{ name: 'one', source: './plugins/one' }, { name: 'two', source: './plugins/two' }, { name: 'escape', source: '../../etc' }] }))
    const home = join(root, 'home')
    const preview = await previewPlugins(home, market)
    expect(preview.plugins.map((one) => one.name)).toEqual(['one', 'two'])
    await installPlugin(home, preview.id, 'two')
    expect((await listPlugins(home)).map((one) => one.name)).toEqual(['two'])
    await expect(installPlugin(home, preview.id, 'escape')).rejects.toThrow()
  })

  it('says when there’s no plugin there', async () => {
    await mkdir(join(root, 'empty'))
    await expect(previewPlugins(join(root, 'home'), join(root, 'empty'))).rejects.toThrow('There’s no plugin there')
  })
})

describe('Terra Code hooks, auto mode and folders', () => {
  const run = async (coder: Coder, task: string, mode: 'ask' | 'edits' | 'auto' = 'edits') => {
    const events: CoderEvent[] = []
    await coder.run('s', root, task, mode, (event) => {
      events.push(event)
      if (event.type === 'approval') coder.answer(event.id, 'allow')
    })
    return events
  }

  it.skipIf(posixOnly)('lets a Stop hook keep the run going, with its reason, until it’s satisfied', async () => {
    const home = join(root, '.home')
    await mkdir(home)
    await writeFile(join(home, 'hooks.json'), JSON.stringify({ afterTurn: ['test -f done.txt || (echo "Write done.txt first"; exit 2)'] }))
    const replies = ['All done.', tool({ tool: 'write', path: 'done.txt', content: 'yes\n' }), 'Now it is done.']
    const seen: string[] = []
    const coder = new Coder({ home, chat: async (messages) => (seen.push(messages.at(-1)!.content), replies.shift() ?? 'Done.') })
    const events = await run(coder, 'finish the job')
    expect(seen[1]).toContain('A Stop hook asked you to keep going')
    expect(seen[1]).toContain('Write done.txt first')
    expect(existsSync(join(root, 'done.txt'))).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'finished' })
  })

  it.skipIf(posixOnly)('gives up on a Stop hook that never lets go, after a few tries', async () => {
    const home = join(root, '.home')
    await mkdir(home)
    await writeFile(join(home, 'hooks.json'), JSON.stringify({ afterTurn: ['echo again; exit 2'] }))
    let asked = 0
    const coder = new Coder({ home, chat: async () => (asked++, 'Done.') })
    const events = await run(coder, 'go')
    expect(asked).toBe(4)
    expect(events.at(-1)).toMatchObject({ type: 'done', reason: 'finished' })
  })

  it.skipIf(posixOnly)('stops a message a prompt hook refuses, and adds what a prompt hook prints', async () => {
    const home = join(root, '.home')
    await mkdir(home)
    await writeFile(join(home, 'hooks.json'), JSON.stringify({ beforePrompt: ['case "$TERRA_PROMPT" in *secret*) echo "No secrets here"; exit 2;; *) echo "The build is make all";; esac'] }))
    const seen: string[] = []
    const coder = new Coder({ home, chat: async (messages) => (seen.push(messages.at(-1)!.content), 'Done.') })
    const refused = await run(coder, 'print the secret')
    expect(refused.find((event) => event.type === 'error')).toMatchObject({ message: 'A hook stopped this message: No secrets here' })
    expect(seen).toHaveLength(0)
    await run(coder, 'build it')
    expect(seen[0]).toContain("(From the project's hooks:)\nThe build is make all")
  })

  it('reads Claude Code hook answers', () => {
    expect(hookAnswer('{"decision":"block","reason":"Tests are failing"}')).toEqual({ block: 'Tests are failing', message: null, context: '' })
    expect(hookAnswer('{"continue":false,"stopReason":"Stop now","systemMessage":"Heads up"}')).toEqual({ block: 'Stop now', message: 'Heads up', context: '' })
    expect(hookAnswer('{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"No rm"}}').block).toBe('No rm')
    expect(hookAnswer('{"hookSpecificOutput":{"additionalContext":"Use pnpm"}}')).toEqual({ block: null, message: null, context: 'Use pnpm' })
    expect(hookAnswer('plain words')).toEqual({ block: null, message: null, context: 'plain words' })
  })

  it.skipIf(posixOnly)('runs commands in auto mode without asking, apart from risky ones', async () => {
    const replies = [tool({ tool: 'run', command: 'echo hi > out.txt' }), tool({ tool: 'run', command: 'git push origin main' }), 'Done.']
    const coder = new Coder({ chat: async () => replies.shift() ?? 'Done.' })
    const events = await run(coder, 'do it', 'auto')
    const approvals = events.filter((event): event is Extract<CoderEvent, { type: 'approval' }> => event.type === 'approval')
    expect(approvals.map((event) => event.detail)).toEqual(['git push origin main'])
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe('hi\n')
  })

  it('reads and edits an added folder by its full path, and nothing else outside', async () => {
    const shared = join(root, 'shared')
    const project = join(root, 'project')
    await mkdir(shared)
    await mkdir(project)
    await writeFile(join(shared, 'lib.txt'), 'shared code\n')
    await expect(inside(project, join(shared, 'lib.txt'))).rejects.toThrow('outside the project')
    setExtraRoots(project, [shared])
    expect(await inside(project, join(shared, 'lib.txt'))).toBe(join(shared, 'lib.txt'))
    await expect(inside(project, join(root, 'elsewhere.txt'))).rejects.toThrow('outside the project')
    await expect(inside(project, join(shared, '..', 'escape.txt'))).rejects.toThrow('outside the project')
    setExtraRoots(project, [])
    await expect(inside(project, join(shared, 'lib.txt'))).rejects.toThrow('outside the project')
  })

  it('tells the model about added folders once, when they change', async () => {
    const shared = join(root, 'shared')
    await mkdir(shared)
    const seen: string[] = []
    let dirs = [shared]
    const coder = new Coder({ extraDirs: () => dirs, chat: async (messages) => (seen.push(messages.at(-1)!.content), 'Done.') })
    await run(coder, 'first')
    await run(coder, 'second')
    dirs = []
    await run(coder, 'third')
    expect(seen[0]).toContain(`you may read and edit these folders, by their full paths: ${shared}`)
    expect(seen[1]).not.toContain('these folders')
    expect(seen[2]).toContain('The extra folders were taken away')
  })
})

describe('Terra Code memory', () => {
  it('reads the person’s own notes and a project’s @imports, but never imports from outside the project', async () => {
    const home = join(root, '.home')
    await mkdir(home)
    await writeFile(join(home, 'TERRA.md'), 'I like small commits.')
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs', 'style.md'), 'Tabs, not spaces.')
    await writeFile(join(root, 'secret.txt'), 'nope')
    await writeFile(join(root, 'CLAUDE.md'), 'See @docs/style.md for style.\n`@secret.txt` is code.\nAnd @~/.ssh/id_rsa.pub and @../outside.md.')
    await writeFile(join(root, 'CLAUDE.local.md'), 'My own setup: port 3001.')
    const context = await projectContext(root, home)
    expect(context).toContain('I like small commits.')
    expect(context).toContain('(Imported with @docs/style.md:)\nTabs, not spaces.')
    expect(context).toContain('My own setup: port 3001.')
    expect(context).not.toContain('nope')
    expect(context).not.toContain('Imported with @~/.ssh')
    expect(await noteImports('@a.md', root, root, new Set())).toBe('')
  })
})

describe('the status line command', () => {
  it.skipIf(posixOnly)('gets the session as JSON and shows its first line without colours', async () => {
    const line = await runStatusLine('node -e "let s=\'\';process.stdin.on(\'data\',d=>s+=d).on(\'end\',()=>{const j=JSON.parse(s);console.log(\'\\x1b[32m\'+j.model.display_name+\' in \'+j.workspace.current_dir+\'\\x1b[0m\');console.log(\'second\')})"', root, JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/p' } }))
    expect(line).toBe('Opus in /p')
    expect(await runStatusLine('exit 0', root, '{}')).toBeNull()
  })
})

describe('voice', () => {
  const provider = (baseUrl: string, extra: object = {}) => ({ id: 'p', name: 'Mine', protocol: 'openai' as const, baseUrl, models: [], firstParty: false, ...extra })

  it('uses only a provider that takes audio, the chat model’s first', () => {
    expect(voiceRouteFor(provider('https://api.openai.com/v1'), null)).toMatchObject({ kind: 'transcriptions', model: 'gpt-4o-mini-transcribe' })
    expect(voiceRouteFor(provider('https://generativelanguage.googleapis.com/v1beta/openai'), 'gemini-2.5-pro')).toMatchObject({ kind: 'chat-audio', model: 'gemini-2.5-pro' })
    expect(voiceRouteFor(provider('http://localhost:8000/v1'), null)).toMatchObject({ kind: 'transcriptions', model: 'whisper-1' })
    expect(voiceRouteFor({ ...provider('https://api.anthropic.com'), protocol: 'anthropic' }, null)).toBeNull()
    expect(voiceRouteFor(provider('https://example.com/v1', { hosted: true }), null)).toBeNull()
    const store = { providers: () => [{ ...provider('https://api.anthropic.com'), id: 'a', protocol: 'anthropic' as const }, { ...provider('https://api.groq.com/openai/v1'), id: 'g' }], roles: () => ({ chat: { providerId: 'a', model: 'claude-opus-5-5' } }) }
    expect(voiceRoute(store)).toMatchObject({ kind: 'transcriptions', model: 'whisper-large-v3-turbo' })
  })

  it('sends a recording to the transcription address with the key, and reads the words', async () => {
    const asked: { url: string; auth: string | null; body: unknown }[] = []
    const fetch = (async (url: string, init: RequestInit) => {
      asked.push({ url, auth: new Headers(init.headers).get('authorization'), body: init.body })
      return new Response(JSON.stringify({ text: ' hello there ' }))
    }) as unknown as typeof globalThis.fetch
    const route = voiceRouteFor(provider('https://api.openai.com/v1/'), null)!
    const wav = Buffer.alloc(4000, 1).toString('base64')
    expect(await transcribe(route, wav, { apiKey: 'sk-1', headers: {} }, fetch)).toBe('hello there')
    expect(asked[0]).toMatchObject({ url: 'https://api.openai.com/v1/audio/transcriptions', auth: 'Bearer sk-1' })
    expect(asked[0]!.body).toBeInstanceOf(FormData)
    expect(await transcribe(route, Buffer.alloc(10).toString('base64'), { apiKey: '', headers: {} }, fetch)).toBe('')
    const refused = (async () => new Response('no', { status: 401 })) as unknown as typeof globalThis.fetch
    await expect(transcribe(route, wav, { apiKey: 'bad', headers: {} }, refused)).rejects.toThrow('didn’t accept the key')
  })
})

describe('the assistant looking through history', () => {
  it('offers the tool only when allowed, and answers with titles and addresses', async () => {
    let allowed = false
    const asked: [string[], number][] = []
    const tools = new ChatTools({
      folder: () => root,
      webSearch: async () => '',
      readUrl: async () => '',
      screenshot: async () => null,
      history: (words, days) => (asked.push([words, days]), [{ title: 'Rust ownership explained', url: 'https://example.com/rust', lastVisit: Date.now() - 2 * 86_400_000, visitCount: 3 }]),
      historyAllowed: () => allowed
    })
    expect((await tools.specs(null)).specs.map((spec) => spec.name)).not.toContain(HISTORY_TOOL.name)
    allowed = true
    expect((await tools.specs(null)).specs.map((spec) => spec.name)).toContain(HISTORY_TOOL.name)
    const steps: string[] = []
    const out = await tools.run({ id: '1', name: 'search_history', input: { words: 'Rust ownership!', days: 7 } }, [], { streamId: 's', tabId: null, emit: (event) => event.type === 'step' && steps.push(event.text), signal: new AbortController().signal }, new Set())
    expect(asked).toEqual([[['rust', 'ownership'], 7]])
    expect(out.output).toBe('- Rust ownership explained | https://example.com/rust | last visited 2 days ago, 3 visits')
    expect(steps).toEqual(['Looked through your history for “rust ownership”'])
    expect(historyLines([])).toMatch(/^Nothing in the history/)
  })
})

describe('notifications from sites', () => {
  it('lists them newest first, held or not, and limits a noisy page', () => {
    let changes = 0
    const list = new SiteNotifications(() => changes++)
    expect(list.record({ url: 'https://chat.example.com/room', title: 'New message', body: '  Hi\nthere ', tabId: 3, hold: false }, 1000)).toBe(false)
    expect(list.record({ url: 'https://mail.example.org/', title: 'Inbox', body: '', tabId: null, hold: true }, 2000)).toBe(true)
    expect(list.all().map((one) => [one.site, one.title, one.body, one.held])).toEqual([
      ['mail.example.org', 'Inbox', '', true],
      ['chat.example.com', 'New message', 'Hi there', false]
    ])
    expect(list.unread()).toBe(2)
    list.markRead()
    expect(list.unread()).toBe(0)
    for (let i = 0; i < 15; i++) list.record({ url: 'https://spam.example/', title: `n${i}`, body: '', tabId: 1, hold: false }, 3000 + i)
    expect(list.all().filter((one) => one.site === 'spam.example')).toHaveLength(10)
    expect(list.record({ url: 'about:blank', title: 'x', body: '', tabId: 1, hold: false })).toBe(false)
    list.forgetTab(3)
    expect(list.all().find((one) => one.site === 'chat.example.com')!.tabId).toBeNull()
    expect(notificationLabel(list.all().at(-1)!, 1000 + 5 * 60_000)).toBe('chat.example.com · New message: Hi there (5 min)')
    list.clear()
    expect(list.all()).toEqual([])
    expect(changes).toBeGreaterThan(3)
  })
})

describe('agent mode, plan first', () => {
  /** A tab standing in for a page: what the agent sees, and where it was sent. */
  function page(url = 'https://shop.example.com/') {
    const went: string[] = []
    let current = url
    const contents = {
      isDestroyed: () => false,
      getURL: () => current,
      loadURL: async (to: string) => {
        went.push(to)
        current = to
      },
      executeJavaScriptInIsolatedWorld: async () => ({ title: 'Shop', url: current, text: 'Welcome', elements: [{ ref: 1, tag: 'button', type: '', name: 'Buy', sensitive: false }] })
    }
    return { contents: contents as unknown as Electron.WebContents, went }
  }

  it('asks once for the plan, then moves between the site’s pages without asking; other sites still ask', async () => {
    const replies = ['1. Open the deals page\n2. Read the prices', '{"action":"navigate","url":"https://shop.example.com/deals","reason":"Deals"}', '{"action":"navigate","url":"https://other.example/","reason":"Compare"}', '{"action":"done","summary":"Read them."}']
    const systems: string[] = []
    const agent = new Agent({ chat: async (_messages, system) => (systems.push(system), replies.shift()!), isSiteOff: () => false, planFirst: () => true })
    const asked: string[] = []
    const { contents, went } = page()
    await agent.run('s', 'find deals', contents, (event) => {
      if (event.type === 'approval') {
        asked.push(event.text)
        agent.answer(event.approvalId, true)
      }
    }, new AbortController().signal)
    expect(systems[0]).toBe(AGENT_PLAN_PROMPT)
    expect(asked).toEqual(['Carry out this plan?', 'Go to https://other.example/'])
    expect(went).toEqual(['https://shop.example.com/deals', 'https://other.example/'])
  })

  it('does nothing when the plan is turned down', async () => {
    const agent = new Agent({ chat: async () => '1. Buy everything', isSiteOff: () => false, planFirst: () => true })
    const texts: string[] = []
    const { contents, went } = page()
    await agent.run('s', 'shop', contents, (event) => {
      if (event.type === 'approval') agent.answer(event.approvalId, false)
      if (event.type === 'text') texts.push(event.text)
    }, new AbortController().signal)
    expect(went).toEqual([])
    expect(texts[0]).toMatch(/plan wasn’t approved/)
  })
})

describe('starting another copy of scTerra', () => {
  it('leaves out CHROME_DESKTOP, which castLabs’ Electron can’t start with', () => {
    const before = process.env.CHROME_DESKTOP
    process.env.CHROME_DESKTOP = 'scterra.desktop'
    try {
      const env = selfEnv({ EXTRA: '1' })
      expect(env.CHROME_DESKTOP).toBeUndefined()
      expect(env.EXTRA).toBe('1')
      expect(env.PATH).toBe(process.env.PATH)
    } finally {
      if (before === undefined) delete process.env.CHROME_DESKTOP
      else process.env.CHROME_DESKTOP = before
    }
  })

  it('starts through the AppImage, or the Linux launcher beside the real program', () => {
    expect(selfLauncher('/opt/scTerra/scterra-bin', '/home/me/scTerra.AppImage')).toBe('/home/me/scTerra.AppImage')
    const launcher = selfLauncher('/opt/scTerra/scterra-bin', undefined, (path) => path === '/opt/scTerra/scterra')
    expect(launcher).toBe(process.platform === 'linux' ? '/opt/scTerra/scterra' : '/opt/scTerra/scterra-bin')
    expect(selfLauncher('/opt/scTerra/scterra-bin', undefined, () => false)).toBe('/opt/scTerra/scterra-bin')
    expect(selfLauncher('/opt/scTerra/scterra', undefined, () => true)).toBe('/opt/scTerra/scterra')
  })

  it.skipIf(posixOnly)('packs a Linux launcher that drops CHROME_DESKTOP and runs the real program', async () => {
    const out = join(root, 'linux-unpacked')
    await mkdir(out)
    await writeFile(join(out, 'scterra'), '#!/bin/sh\necho "real ${CHROME_DESKTOP:-unset} $*"\n', { mode: 0o755 })
    const hook = createRequire(import.meta.url)(join(process.cwd(), 'apps/desktop/scripts/after-pack.cjs')) as { default: (context: object) => unknown }
    await hook.default({ electronPlatformName: 'linux', appOutDir: out, packager: { executableName: 'scterra' } })
    expect(existsSync(join(out, 'scterra-bin'))).toBe(true)
    const said = execFileSync(join(out, 'scterra'), ['--smoke-test'], { encoding: 'utf8', env: { ...process.env, CHROME_DESKTOP: 'discord.desktop' } }).trim()
    expect(said).toBe('real unset --smoke-test')
  })
})

describe('packaging castLabs’ Electron', () => {
  it('builds with the same castLabs release the app runs on', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'apps/desktop/package.json'), 'utf8')) as { devDependencies: Record<string, string> }
    const builder = await readFile(join(process.cwd(), 'apps/desktop/electron-builder.yml'), 'utf8')
    const tag = /#v(.+\+wvcus)$/.exec(pkg.devDependencies.electron!)?.[1]
    expect(tag).toMatch(/^\d+\.\d+\.\d+\+wvcus$/)
    expect(builder).toContain(`electronVersion: ${tag}`)
    // Windows checks files out with \r\n line endings.
    expect(builder).toMatch(/^ {2}mirror: https:\/\/github\.com\/castlabs\/electron-releases\/releases\/download\/\r?$/m)
  })
})
