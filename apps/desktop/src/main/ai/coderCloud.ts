import { randomBytes } from 'node:crypto'
import { blake2b } from '@noble/hashes/blake2b'
import nacl from 'tweetnacl'
import {
  CLOUD_BRANCH_PREFIX,
  CLOUD_EVENT_MARK,
  CLOUD_FILES_DIR,
  CLOUD_SECRET,
  CLOUD_TRIGGER_PREFIX,
  CLOUD_WORKFLOW_PATH,
  type CoderCloudModel,
  type CoderCloudRun,
  type CoderEffort,
  type CoderEvent,
  type ModelRef
} from '@scbrowser/shared'
import { git } from './coder'
import { GithubError, githubRepoOf, gitRemote, shownRemote, type CoderGithub } from './coderGithub'
import { parseServer, serverName, type CoderServer } from './coderServer'
import type { SandboxMode } from './coderTools'

const RUNS_KEY = 'coder:cloud'
/** Runs kept per session, newest last. */
const MAX_RUNS = 20
const MAX_SESSIONS = 200

/** What the runner is told, in the trigger branch. Never a key: that's the repository secret. */
export interface CloudTask {
  id: string
  task: string
  repo: string
  base: string
  branch: string
  trigger: string
  pr: boolean
  model: CoderCloudModel
  effort: CoderEffort | null
  /** The task's first line, for the commit and pull request. */
  title: string
  /** Started from a comment on this issue or pull request: the answer goes back there. */
  issue?: number
  /** Where it runs: GitHub Actions (the default), or the person's own server over SSH. */
  where?: 'github' | 'server'
  /** On a server: push the finished branch here, with the server's own git sign-in. */
  pushTo?: string | null
  /** On a server: fence commands in as Terra Code does on this computer, where the server can. */
  sandbox?: SandboxMode
}

/**
 * libsodium's sealed box, which is how GitHub wants secrets sent: a throwaway key pair, the nonce
 * made from both public keys with BLAKE2b, then an ordinary box to GitHub's key.
 */
export function sealForGithub(publicKeyBase64: string, value: string): string {
  const recipient = Uint8Array.from(Buffer.from(publicKeyBase64, 'base64'))
  if (recipient.length !== nacl.box.publicKeyLength) throw new Error('GitHub sent a key that can’t be used.')
  const ephemeral = nacl.box.keyPair()
  const nonce = blake2b(new Uint8Array([...ephemeral.publicKey, ...recipient]), { dkLen: nacl.box.nonceLength })
  const boxed = nacl.box(new TextEncoder().encode(value), nonce, recipient, ephemeral.secretKey)
  return Buffer.from(new Uint8Array([...ephemeral.publicKey, ...boxed])).toString('base64')
}

/** The other half, for tests: what GitHub does with the secret key it keeps. */
export function openSealed(sealedBase64: string, publicKey: Uint8Array, secretKey: Uint8Array): string | null {
  const sealed = Uint8Array.from(Buffer.from(sealedBase64, 'base64'))
  const ephemeral = sealed.slice(0, nacl.box.publicKeyLength)
  const nonce = blake2b(new Uint8Array([...ephemeral, ...publicKey]), { dkLen: nacl.box.nonceLength })
  const opened = nacl.box.open(sealed.slice(nacl.box.publicKeyLength), nonce, ephemeral, secretKey)
  return opened ? new TextDecoder().decode(opened) : null
}

/** The workflow that runs one task. It lives only in the trigger branch, so nothing lands on the person's branches. */
export function cloudWorkflow(task: Pick<CloudTask, 'id' | 'trigger'>): string {
  return `# Made by scTerra for one Terra Code cloud run. It only runs on its own branch,
# which is deleted when the run ends. You can delete this branch at any time.
name: Terra Code cloud run ${task.id}
on:
  push:
    branches: ['${task.trigger}']
permissions:
  contents: write
  pull-requests: write
  checks: write
concurrency:
  group: scterra-cloud-${task.id}
jobs:
  terra-code:
    runs-on: ubuntu-latest
    timeout-minutes: 300
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          # The job's token stays out of git's settings, so only the runner's own push can use it.
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Terra Code works on the task
        env:
          ${CLOUD_SECRET}: \${{ secrets.${CLOUD_SECRET} }}
          GITHUB_TOKEN: \${{ github.token }}
        run: |
          cp -r ${CLOUD_FILES_DIR} "$RUNNER_TEMP/scterra"
          git reset --hard HEAD~1
          node "$RUNNER_TEMP/scterra/runner.mjs" "$RUNNER_TEMP/scterra/task.json"
`
}

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? 'project'

/** A branch name from a task: a few of its words, then the run's id. */
export function branchFor(task: string, id: string): string {
  const words = task
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `${CLOUD_BRANCH_PREFIX}${words ? `${words}-` : ''}${id}`
}

/** Events the runner printed, read back from the job's log. Each line starts with a time, then the mark. */
export function eventsFromLog(log: string, sessionId: string): CoderEvent[] {
  const events: CoderEvent[] = []
  for (const line of log.split('\n')) {
    const at = line.indexOf(CLOUD_EVENT_MARK)
    if (at === -1) continue
    try {
      const event = JSON.parse(line.slice(at + CLOUD_EVENT_MARK.length)) as CoderEvent
      if (event && typeof event === 'object' && typeof event.type === 'string') events.push({ ...event, sessionId })
    } catch {
      // A line cut off or masked by GitHub: the rest still tells the story.
    }
  }
  return events
}

interface GithubRun {
  id: number
  status: string
  conclusion: string | null
  html_url: string
}

export interface CoderCloudDeps {
  github: CoderGithub
  kv: { get(key: string): unknown; set(key: string, value: unknown): void }
  /** The bundled runner script, which goes into the trigger branch. */
  runner: () => Promise<string>
  /** Where the model is, and the secret it needs (null when it needs none). */
  model: (ref: ModelRef | null, where?: 'github' | 'server') => Promise<{ model: CoderCloudModel; secret: string | null }>
  /** Runs on the person's own server, over SSH. */
  server?: CoderServer
  /** The server from Terra Code's settings, and whether it pushes what it made. */
  serverSettings?: () => { host: string; push: boolean; sandbox: SandboxMode }
  now?: () => number
}

/**
 * Terra Code in the cloud: a task runs on GitHub Actions in the person's own repository, so it
 * carries on with this computer off. It starts from GitHub's copy of the branch, works with every
 * step allowed (the machine is GitHub's and thrown away after), pushes to a branch of its own, and
 * opens a pull request if asked. Nothing touches the person's branches until they merge it.
 */
export class CoderCloud {
  private readonly now: () => number

  constructor(private readonly deps: CoderCloudDeps) {
    this.now = deps.now ?? Date.now
  }

  private all(): Record<string, CoderCloudRun[]> {
    const saved = this.deps.kv.get(RUNS_KEY)
    return saved && typeof saved === 'object' ? (saved as Record<string, CoderCloudRun[]>) : {}
  }

  runs(sessionId: string): CoderCloudRun[] {
    return this.all()[sessionId] ?? []
  }

  private save(sessionId: string, run: CoderCloudRun): CoderCloudRun {
    const all = this.all()
    const list = (all[sessionId] ?? []).filter((one) => one.id !== run.id)
    list.push(run)
    all[sessionId] = list.slice(-MAX_RUNS)
    const ids = Object.keys(all)
    for (const old of ids.slice(0, Math.max(0, ids.length - MAX_SESSIONS))) delete all[old]
    this.deps.kv.set(RUNS_KEY, all)
    return run
  }

  private find(sessionId: string, id: string): CoderCloudRun {
    const run = this.runs(sessionId).find((one) => one.id === id)
    if (!run) throw new Error('That cloud run isn’t known here any more.')
    return run
  }

  async start(sessionId: string, folder: string, task: string, { pr, effort, model: ref = null, where = 'github' }: { pr: boolean; effort: CoderEffort | null; model?: ModelRef | null; where?: 'github' | 'server' }): Promise<CoderCloudRun> {
    if (where === 'server') return this.startOnServer(sessionId, folder, task, { pr, effort, model: ref })
    const { github } = this.deps
    if (github.access() !== 'write') throw new Error('Cloud runs push to GitHub, so Terra Code needs to look and act there. Connect GitHub in Terra Code settings and choose Look and act.')
    const repo = await github.repo(folder)
    if (!repo) throw new Error('This project isn’t on GitHub: its git remote “origin” doesn’t point there. Push it to GitHub first.')
    const local = await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const info = await github.call<{ default_branch: string; permissions?: { push?: boolean } }>('GET', `/repos/${repo}`)
    if (info.permissions && info.permissions.push === false) throw new Error(`Your GitHub account can’t push to ${repo}, so a cloud run couldn’t save its work.`)
    const base = local && local !== 'HEAD' ? local : info.default_branch
    let baseSha: string
    try {
      baseSha = (await github.call<{ commit: { sha: string } }>('GET', `/repos/${repo}/branches/${encodeURIComponent(base)}`)).commit.sha
    } catch (error) {
      if (error instanceof GithubError && error.status === 404) throw new Error(`The branch ${base} isn’t on GitHub yet. Push it first: the cloud starts from GitHub’s copy.`)
      throw error
    }
    const warning = await this.warningFor(folder, baseSha, base)

    const { model, secret } = await this.deps.model(ref)
    if (model.needsKey) {
      if (!secret) throw new Error('This model needs a key, and none is saved for it. Add one in AI settings.')
      const key = await github.call<{ key_id: string; key: string }>('GET', `/repos/${repo}/actions/secrets/public-key`)
      await github.call('PUT', `/repos/${repo}/actions/secrets/${CLOUD_SECRET}`, { encrypted_value: sealForGithub(key.key, secret), key_id: key.key_id })
    }

    const id = randomBytes(4).toString('hex')
    const trigger = `${CLOUD_TRIGGER_PREFIX}${id}`
    const branch = branchFor(task, id)
    const title = task.split('\n')[0]!.trim().slice(0, 72) || 'Terra Code cloud run'
    const spec: CloudTask = { id, task, repo, base, branch, trigger, pr, model, effort, title }
    const runner = await this.deps.runner()
    const blob = async (content: string) => (await github.call<{ sha: string }>('POST', `/repos/${repo}/git/blobs`, { content: Buffer.from(content).toString('base64'), encoding: 'base64' })).sha
    const [workflowSha, runnerSha, taskSha] = await Promise.all([blob(cloudWorkflow(spec)), blob(runner), blob(JSON.stringify(spec, null, 2))])
    const baseTree = (await github.call<{ tree: { sha: string } }>('GET', `/repos/${repo}/git/commits/${baseSha}`)).tree.sha
    const tree = await github.call<{ sha: string }>('POST', `/repos/${repo}/git/trees`, {
      base_tree: baseTree,
      tree: [
        { path: CLOUD_WORKFLOW_PATH, mode: '100644', type: 'blob', sha: workflowSha },
        { path: `${CLOUD_FILES_DIR}/runner.mjs`, mode: '100644', type: 'blob', sha: runnerSha },
        { path: `${CLOUD_FILES_DIR}/task.json`, mode: '100644', type: 'blob', sha: taskSha }
      ]
    })
    const commit = await github.call<{ sha: string }>('POST', `/repos/${repo}/git/commits`, { message: `Terra Code cloud run ${id}\n\n${title}`, tree: tree.sha, parents: [baseSha] })
    await github.call('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${trigger}`, sha: commit.sha })
    return this.save(sessionId, { id, repo, base, trigger, branch, task, pr, state: 'queued', runId: null, runUrl: null, prUrl: null, summary: null, startedAt: this.now(), endedAt: null, error: null, warning })
  }

  /** The server from settings, ready for ssh, or why not. */
  private target(run?: CoderCloudRun) {
    const host = run?.host ?? this.deps.serverSettings?.().host ?? ''
    const target = parseServer(host)
    if (!this.deps.server) throw new Error('Runs on a server aren’t available here.')
    if (!target) throw new Error(host ? `“${host}” isn’t a server address scTerra can use. Write it as user@host, or a name from ~/.ssh/config.` : 'Add your server under Runs on first: user@host, or a name from ~/.ssh/config.')
    return { server: this.deps.server, target }
  }

  /** The same task on the person's own server: the folder as it is now goes there over SSH, nothing through GitHub. */
  private async startOnServer(sessionId: string, folder: string, task: string, { pr, effort, model: ref }: { pr: boolean; effort: CoderEffort | null; model: ModelRef | null }): Promise<CoderCloudRun> {
    const { server, target } = this.target()
    const settings = this.deps.serverSettings?.() ?? { host: '', push: false, sandbox: 'off' as SandboxMode }
    const remote = await gitRemote(folder)
    const pushTo = settings.push && remote ? shownRemote(remote) : null
    const github = githubRepoOf(remote)
    const { model, secret } = await this.deps.model(ref, 'server')
    if (model.needsKey && !secret) throw new Error('This model needs a key, and none is saved for it. Add one in AI settings.')
    const local = await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD'])
    const base = local && local !== 'HEAD' ? local : ((await git(folder, ['rev-parse', '--short', 'HEAD'])) ?? 'HEAD')
    const id = randomBytes(4).toString('hex')
    const branch = branchFor(task, id)
    const title = task.split('\n')[0]!.trim().slice(0, 72) || 'Terra Code run'
    const spec: CloudTask = { id, task, repo: github ?? folderName(folder), base, branch, trigger: '', pr: pr && !!pushTo && !!github, model, effort, title, where: 'server', pushTo, sandbox: settings.sandbox === 'container' ? 'off' : settings.sandbox }
    const { warning } = await server.start(target, folder, spec, secret)
    return this.save(sessionId, { id, where: 'server', host: serverName(target), repo: spec.repo, base, trigger: '', branch, task, pr: spec.pr, state: 'working', runId: null, runUrl: null, prUrl: null, summary: null, startedAt: this.now(), endedAt: null, error: null, warning })
  }

  /** What the cloud copy won't have: uncommitted changes, and commits not pushed. */
  private async warningFor(folder: string, remoteSha: string, base: string): Promise<string | null> {
    const [dirty, head] = await Promise.all([git(folder, ['status', '--porcelain']), git(folder, ['rev-parse', 'HEAD'])])
    const parts: string[] = []
    if (head && head !== remoteSha) {
      const ahead = await git(folder, ['rev-list', '--count', `${remoteSha}..HEAD`])
      const count = Number(ahead)
      parts.push(Number.isFinite(count) && count > 0 ? `${count} ${count === 1 ? 'commit' : 'commits'} on this computer ${count === 1 ? 'isn’t' : 'aren’t'} pushed` : `this computer’s ${base} differs from GitHub’s`)
    }
    if (dirty) parts.push('uncommitted changes stay here')
    return parts.length ? `It started from GitHub’s copy of ${base}: ${parts.join(', and ')}.` : null
  }

  /** Brings each unfinished run up to date with GitHub. */
  async check(sessionId: string): Promise<CoderCloudRun[]> {
    for (const run of this.runs(sessionId)) {
      if (run.state === 'done' || run.state === 'failed' || run.state === 'cancelled') continue
      await this.refresh(sessionId, run).catch((error: unknown) => this.save(sessionId, { ...run, error: error instanceof Error ? error.message : 'GitHub couldn’t be reached.' }))
    }
    return this.runs(sessionId)
  }

  private async refresh(sessionId: string, run: CoderCloudRun): Promise<void> {
    if (run.where === 'server') {
      const { server, target } = this.target(run)
      const now = await server.status(target, run)
      const finished = now.state !== 'working'
      let next: CoderCloudRun = { ...run, state: now.state, summary: now.summary ?? run.summary, pushed: now.pushed, error: now.error, live: now.live, ...(finished ? { endedAt: this.now() } : {}) }
      // The server pushed its branch; the pull request is opened with the person's own GitHub sign-in.
      if (now.state === 'done' && run.pr && now.pushed && !run.prUrl && this.deps.github.access() === 'write') next = { ...next, prUrl: await this.openPr(next).catch(() => null) }
      this.save(sessionId, next)
      return
    }
    const { github } = this.deps
    const found = await github.call<{ workflow_runs: GithubRun[] }>('GET', `/repos/${run.repo}/actions/runs?branch=${encodeURIComponent(run.trigger)}&per_page=5`)
    const latest = found.workflow_runs[0]
    if (!latest) {
      // GitHub takes a moment to see the push. Past a few minutes, Actions is probably off for this repository.
      const stuck = this.now() - run.startedAt > 5 * 60_000
      this.save(sessionId, { ...run, error: stuck ? 'GitHub hasn’t started the run. Check that Actions is turned on for this repository (Settings, Actions).' : null })
      return
    }
    const base = { ...run, runId: latest.id, runUrl: latest.html_url, error: null }
    if (latest.status !== 'completed') {
      const live = latest.status === 'in_progress' ? await this.live(run).catch(() => null) : null
      this.save(sessionId, { ...base, state: latest.status === 'in_progress' ? 'working' : 'queued', ...(live ? { live } : {}) })
      return
    }
    const ok = latest.conclusion === 'success'
    const cancelled = latest.conclusion === 'cancelled'
    let summary: string | null = null
    let prUrl: string | null = run.prUrl
    if (ok) {
      const head = await github.call<{ commit: { message: string } }>('GET', `/repos/${run.repo}/commits/${encodeURIComponent(run.branch)}`).catch(() => null)
      summary = head ? head.commit.message.split('\n').slice(2).join('\n').trim() || head.commit.message.split('\n')[0]! : null
      const owner = run.repo.split('/')[0]
      const pulls = await github.call<{ html_url: string }[]>('GET', `/repos/${run.repo}/pulls?head=${encodeURIComponent(`${owner}:${run.branch}`)}&state=all&per_page=1`).catch(() => [])
      prUrl = pulls[0]?.html_url ?? prUrl
    }
    // The runner deletes its trigger branch; if it couldn't, this does.
    await github.call('DELETE', `/repos/${run.repo}/git/refs/heads/${run.trigger}`).catch(() => undefined)
    // A failed run says why in its own words, the last error it printed, rather than sending the person to the log.
    const why = ok || cancelled ? null : await this.lastError(run.repo, latest.id).catch(() => null)
    let next: CoderCloudRun = { ...base, state: ok ? 'done' : cancelled ? 'cancelled' : 'failed', summary, prUrl, endedAt: this.now(), error: ok || cancelled ? null : why ? `It stopped: ${why}` : 'The run stopped with an error. Its log on GitHub says why.' }
    // The runner may not be allowed to open pull requests (a repository setting), so the person's own sign-in does.
    if (ok && run.pr && !prUrl && summary !== null) next = { ...next, prUrl: await this.openPr(next).catch(() => null) }
    this.save(sessionId, next)
  }

  /** The last error a finished run printed in its job's log. */
  private async lastError(repo: string, runId: number): Promise<string | null> {
    const events = await this.logEvents(repo, runId, '')
    const error = events.filter((event): event is Extract<CoderEvent, { type: 'error' }> => event.type === 'error').at(-1)
    return error ? error.message.slice(0, 600) : null
  }

  private async logEvents(repo: string, runId: number, sessionId: string): Promise<CoderEvent[]> {
    const jobs = await this.deps.github.call<{ jobs: { id: number }[] }>('GET', `/repos/${repo}/actions/runs/${runId}/jobs`)
    const job = jobs.jobs[0]
    if (!job) return []
    const log = await this.deps.github.call<string>('GET', `/repos/${repo}/actions/jobs/${job.id}/logs`)
    return eventsFromLog(typeof log === 'string' ? log : '', sessionId)
  }

  /** The steps the runner has posted to its check run so far, newest last, in a few words each. */
  private async live(run: CoderCloudRun): Promise<string[] | null> {
    const found = await this.deps.github.call<{ check_runs: { output?: { text?: string | null } }[] }>('GET', `/repos/${run.repo}/commits/${encodeURIComponent(run.trigger)}/check-runs?check_name=${encodeURIComponent('Terra Code')}`)
    const text = found.check_runs[0]?.output?.text
    if (!text) return null
    return eventsFromLog(text, '')
      .flatMap((event) => (event.type === 'tool' ? [event.summary] : event.type === 'text' ? [event.text.split('\n')[0]!.slice(0, 140)] : []))
      .slice(-6)
  }

  private async openPr(run: CoderCloudRun): Promise<string> {
    const made = await this.deps.github.call<{ html_url: string }>('POST', `/repos/${run.repo}/pulls`, {
      title: run.task.split('\n')[0]!.trim().slice(0, 120) || 'Terra Code cloud run',
      head: run.branch,
      base: run.base,
      body: `${run.summary ?? ''}\n\n---\nMade by Terra Code in the cloud.`.trim()
    })
    return made.html_url
  }

  async pr(sessionId: string, id: string): Promise<string> {
    const run = this.find(sessionId, id)
    if (run.prUrl) return run.prUrl
    if (run.state !== 'done') throw new Error('Wait for the run to finish first.')
    if (run.where === 'server' && (!run.pushed || !run.repo.includes('/'))) throw new Error('The server kept this branch to itself. Fetch it here, push it, and open the pull request from there.')
    try {
      const url = await this.openPr(run)
      this.save(sessionId, { ...run, prUrl: url })
      return url
    } catch (error) {
      if (error instanceof GithubError && error.status === 422) throw new Error('GitHub wouldn’t open a pull request: the branch may have no changes, or one is already open.')
      throw error
    }
  }

  async cancel(sessionId: string, id: string): Promise<CoderCloudRun[]> {
    const run = this.find(sessionId, id)
    if (run.where === 'server') {
      const { server, target } = this.target(run)
      await server.cancel(target, run)
      this.save(sessionId, { ...run, state: 'cancelled', endedAt: this.now() })
      return this.runs(sessionId)
    }
    if (run.runId) await this.deps.github.call('POST', `/repos/${run.repo}/actions/runs/${run.runId}/cancel`).catch(() => undefined)
    await this.deps.github.call('DELETE', `/repos/${run.repo}/git/refs/heads/${run.trigger}`).catch(() => undefined)
    this.save(sessionId, { ...run, state: 'cancelled', endedAt: this.now() })
    return this.runs(sessionId)
  }

  /** What the run did, from its log. Only there once the run has finished. */
  async events(sessionId: string, id: string): Promise<CoderEvent[]> {
    const run = this.find(sessionId, id)
    if (run.where === 'server') {
      const { server, target } = this.target(run)
      return server.events(target, run, sessionId)
    }
    if (!run.runId) return []
    return this.logEvents(run.repo, run.runId, sessionId)
  }

  /** The run's branch, fetched into the project so it can be looked at or switched to. */
  async fetchBranch(sessionId: string, id: string, folder: string): Promise<string> {
    const run = this.find(sessionId, id)
    if (run.where === 'server') {
      const { server, target } = this.target(run)
      return server.fetch(target, run, folder)
    }
    const done = await git(folder, ['fetch', 'origin', `+refs/heads/${run.branch}:refs/remotes/origin/${run.branch}`], 60_000)
    if (done === null) throw new Error(`Couldn’t fetch ${run.branch}. Check git can reach GitHub from this computer.`)
    return `Fetched ${run.branch}. Look at it with git diff ${run.base}...origin/${run.branch}, or switch to it with git switch ${run.branch}.`
  }
}
