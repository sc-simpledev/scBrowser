/**
 * Terra Code's cloud runner: what a GitHub Actions job runs for one task, bundled into a single
 * file (scripts/build-cloud-runner.mjs) that scTerra puts in the run's trigger branch. It uses the
 * same harness as the app, with nobody watching: every step is allowed, as the machine is GitHub's
 * and is thrown away after. It prints its events for the app to read back from the job's log,
 * commits the work to a branch of its own, and opens a pull request if it was asked to.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createProvider, type ChatMessage, type ToolUse } from '@scbrowser/ai'
import { CLOUD_EVENT_MARK, CLOUD_SECRET, findSecrets, secretWarning, type CoderEvent, type ProviderConfig } from '@scbrowser/shared'
import { randomBytes } from 'node:crypto'
import { branchFor, type CloudTask } from '../ai/coderCloud'
import { Coder } from '../ai/coder'
import { CoderGithub } from '../ai/coderGithub'

const MAX_OUTPUT_TOKENS = 16_000
/** Long tool output is cut in the log: the app shows a summary of each step, not all of it. */
const LOG_OUTPUT_CHARS = 1500
const SESSION = 'cloud'

/** An event without its session, which the app fills in when it reads the log. */
type Printed = { [K in CoderEvent['type']]: Omit<Extract<CoderEvent, { type: K }>, 'sessionId'> }[CoderEvent['type']]

/** The latest events, for the check run the app reads while the run is still going. */
const recent: string[] = []
let progressDirty = false
const print = (event: Printed) => {
  const line = `${CLOUD_EVENT_MARK}${JSON.stringify(event)}`
  process.stdout.write(`${line}\n`)
  recent.push(line.slice(0, 2000))
  while (recent.join('\n').length > PROGRESS_CHARS) recent.shift()
  progressDirty = true
}
/** GitHub caps a check run's text at 65,535 characters. */
const PROGRESS_CHARS = 60_000
const PROGRESS_EVERY_MS = 15_000

function sh(command: string, args: string[], quiet = false): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'], maxBuffer: 50_000_000 }).trim()
}

/** One of the person's scheduled tasks, written into the installed workflow by scTerra. */
interface Scheduled {
  cron: string
  task: string
  pr?: boolean
}

/**
 * The task for a run the installed workflow started: an @terra comment on an issue or pull
 * request, a scheduled task, or one started by hand. Who may start one is checked by the workflow.
 */
// GitHub's event payloads are loosely typed JSON.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function taskFromEvent(): Promise<CloudTask | null> {
  const repo = process.env.GITHUB_REPOSITORY ?? ''
  const name = process.env.GITHUB_EVENT_NAME ?? ''
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')) as Record<string, any>
  const model = JSON.parse(process.env.SCTERRA_MODEL || 'null') as CloudTask['model'] | null
  if (!model) throw new Error('The repository variable SCTERRA_MODEL is missing. Install Terra Code on GitHub again from scTerra.')
  const id = randomBytes(4).toString('hex')
  const defaultBranch = String(event.repository?.default_branch ?? 'main')
  let task = ''
  let base = defaultBranch
  let issue: number | undefined
  let pr = true
  if (name === 'issue_comment') {
    const asked = String(event.comment?.body ?? '').replace(/@terra\b/gi, '').trim()
    issue = Number(event.issue?.number)
    const title = String(event.issue?.title ?? '')
    const body = String(event.issue?.body ?? '').slice(0, 4000)
    if (event.issue?.pull_request) {
      // A comment on a pull request works on that pull request's branch.
      const token = process.env.GITHUB_TOKEN ?? ''
      const pull = (await (await fetch(`https://api.github.com/repos/${repo}/pulls/${issue}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'scTerra' } })).json()) as { head?: { ref?: string; repo?: { full_name?: string } } }
      if (pull.head?.repo?.full_name !== repo) throw new Error('Pull requests from forks are left alone.')
      base = String(pull.head?.ref ?? defaultBranch)
      sh('git', ['fetch', 'origin', base])
      sh('git', ['checkout', '-B', base, 'FETCH_HEAD'])
    }
    task = `${asked || 'Take care of this.'}\n\n(Asked in a comment on ${event.issue?.pull_request ? 'pull request' : 'issue'} #${issue} “${title}”. Its description:)\n${body}`
  } else if (name === 'schedule') {
    const planned = (JSON.parse(process.env.SCTERRA_SCHEDULES || '[]') as Scheduled[]).find((one) => one.cron === event.schedule)
    if (!planned) return null
    task = planned.task
    pr = planned.pr !== false
  } else if (name === 'workflow_dispatch') {
    task = String(event.inputs?.task ?? '').trim()
  }
  if (!task.trim()) return null
  const title = task.split('\n')[0]!.trim().slice(0, 72) || 'Terra Code'
  return { id, task, repo, base, branch: branchFor(title, id), trigger: '', pr, model, effort: null, title, ...(issue ? { issue } : {}) }
}

async function main(): Promise<number> {
  const fromEvent = process.argv[2] === '--event'
  const spec = fromEvent ? await taskFromEvent() : (JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as CloudTask)
  if (!spec) {
    process.stdout.write('Nothing to do for this event.\n')
    return 0
  }
  // The secret and the job's token are for this script. The model's commands don't get them.
  const secretText = process.env[CLOUD_SECRET] ?? ''
  const githubToken = process.env.GITHUB_TOKEN ?? ''
  delete process.env[CLOUD_SECRET]
  delete process.env.GITHUB_TOKEN
  let secret = { apiKey: '', headers: {} as Record<string, string> }
  if (secretText) {
    try {
      secret = { ...secret, ...(JSON.parse(secretText) as typeof secret) }
    } catch {
      secret.apiKey = secretText
    }
  }
  if (spec.model.needsKey && !secret.apiKey && !Object.keys(secret.headers).length) {
    const message = spec.where === 'server' ? 'The model’s key didn’t reach the server, so the model can’t be reached.' : `The repository secret ${CLOUD_SECRET} is missing, so the model can't be reached.`
    print({ type: 'error', message })
    if (spec.where === 'server') writeFileSync(join(process.cwd(), '..', 'result.json'), JSON.stringify({ ok: false, error: message }))
    return 1
  }

  const onServer = spec.where === 'server'
  // On a server, the app reads how it went from this file beside the work.
  const finish = (result: { ok: boolean; summary?: string; error?: string | null; pushed?: boolean }) => {
    if (onServer) writeFileSync(join(process.cwd(), '..', 'result.json'), JSON.stringify(result))
  }
  const config: ProviderConfig = { id: 'cloud', name: spec.model.name ?? (spec.model.needsKey ? 'The model' : 'scTerra AI'), protocol: spec.model.protocol, baseUrl: spec.model.baseUrl, models: [spec.model.model], firstParty: spec.model.firstParty, ...(spec.model.needsKey ? {} : { hosted: true }) }
  const provider = createProvider({ config, secret, fetch })
  const model = spec.model.model
  // The hosted service doesn't take tool calls yet, so it uses the text protocol, as in the app.
  const native = spec.model.needsKey

  // The job's own token can look at this repository, so the model can read its issues and pull requests.
  const github = new CoderGithub({
    kv: { get: () => ({ source: 'token', sealed: githubToken, login: 'github-actions' }), set: () => undefined },
    access: () => (githubToken ? 'read' : 'off'),
    seal: async (text) => text,
    unseal: async (text) => text,
    remote: async () => `https://github.com/${spec.repo}.git`
  })

  let lastText = ''
  let failed: string | null = null

  /** The job's own token for GitHub's API: the check run, the pull request, a reply on the issue. */
  const api = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> => {
    if (!githubToken) return null
    const response = await fetch(`https://api.github.com/repos/${spec.repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'scTerra' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }).catch(() => null)
    return response?.ok ? ((await response.json().catch(() => ({}))) as Record<string, unknown>) : null
  }
  // A check run the app reads while this works, as the job's log only comes back at the end.
  const check = process.env.GITHUB_SHA ? await api('POST', '/check-runs', { name: 'Terra Code', head_sha: process.env.GITHUB_SHA, status: 'in_progress', external_id: spec.id, output: { title: 'Working', summary: spec.title.slice(0, 1000) } }) : null
  const sendProgress = async (final?: { conclusion: 'success' | 'failure'; summary: string }) => {
    if (!check?.id || (!progressDirty && !final)) return
    progressDirty = false
    await api('PATCH', `/check-runs/${String(check.id)}`, { ...(final ? { status: 'completed', conclusion: final.conclusion } : {}), output: { title: final ? (final.conclusion === 'success' ? 'Finished' : 'Stopped') : 'Working', summary: (final?.summary ?? spec.title).slice(0, 60_000), text: recent.join('\n') } })
  }
  const ticker = setInterval(() => void sendProgress(), PROGRESS_EVERY_MS)
  const coder = new Coder({
    unattended: true,
    // On the person's own server, commands are fenced in as they would be at home, where it can.
    sandbox: () => spec.sandbox ?? 'off',
    autoCompact: () => true,
    autoCheck: () => true,
    autoFormat: () => true,
    showReasoning: () => false,
    github,
    chat: async (messages, system, signal, options) => {
      let text = ''
      for await (const event of provider.chat({ model, system, messages, maxTokens: MAX_OUTPUT_TOKENS, signal, ...(options?.effort ? { effort: options.effort } : {}) })) {
        if (event.type === 'text') {
          text += event.text
          options?.onText?.(text)
        } else if (event.type === 'usage') options?.onUsage?.(event.inputTokens, event.outputTokens)
      }
      return text
    },
    native: {
      available: () => native,
      chat: async (messages: ChatMessage[], system, tools, signal, options) => {
        let text = ''
        let blocks: unknown[] | undefined
        const uses: ToolUse[] = []
        for await (const event of provider.chat({ model, system, messages, maxTokens: MAX_OUTPUT_TOKENS, signal, tools, ...(options?.effort ? { effort: options.effort } : {}) })) {
          if (event.type === 'text') {
            text += event.text
            options?.onText?.(text)
          } else if (event.type === 'blocks') blocks = event.blocks
          else if (event.type === 'tool') uses.push(event.use)
          else if (event.type === 'usage') options?.onUsage?.(event.inputTokens, event.outputTokens)
        }
        return { text, uses, ...(blocks ? { blocks } : {}) }
      }
    }
  })

  const emit = (event: CoderEvent) => {
    const { sessionId: _session, ...rest } = event
    const shown = rest as Printed
    switch (event.type) {
      case 'approval':
        // Nobody is watching, and the machine is thrown away after.
        coder.answer(event.id, 'allow')
        return
      case 'text':
        lastText = event.text
        print(shown)
        return
      case 'tool':
        process.stdout.write(`▸ ${event.summary}\n`)
        print(shown)
        return
      case 'tool-result':
        print({ type: 'tool-result', id: event.id, ok: event.ok, output: event.output.slice(0, LOG_OUTPUT_CHARS), ...(event.undoable ? { undoable: true } : {}) })
        return
      case 'error':
        failed = event.message
        print(shown)
        return
      case 'todo':
      case 'note':
      case 'done':
      case 'changes':
      case 'compacted':
        print(shown)
        return
      case 'agent':
        if (event.run.state !== 'running') print(shown)
        return
      default:
        // Streaming, reasoning, live output and the like are for a screen, not a log.
        return
    }
  }

  const folder = process.cwd()
  await coder.run(SESSION, folder, spec.task, 'edits', emit, undefined, { effort: spec.effort })
  coder.dispose()
  clearInterval(ticker)

  // The work goes to a branch of its own, made from where it started.
  sh('git', ['config', 'user.name', 'Terra Code'])
  sh('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  sh('git', ['add', '-A'])
  const changed = sh('git', ['status', '--porcelain']) !== ''
  // Nothing that looks like a secret leaves this machine: the run stops before pushing instead.
  const leak = secretWarning(findSecrets(sh('git', ['diff', '--cached', '--no-color', '--unified=0'])))
  if (leak) {
    print({ type: 'error', message: onServer ? `${leak} The work wasn’t committed.` : `${leak} The work wasn’t pushed. Its log on GitHub still shows what it did.` })
    clearInterval(ticker)
    await sendProgress({ conclusion: 'failure', summary: leak })
    finish({ ok: false, error: leak })
    return 1
  }
  const summary = (failed ? `Stopped: ${failed}\n\n${lastText}` : lastText).trim().slice(0, 6000) || (changed ? 'Done.' : 'Nothing needed changing.')
  sh('git', ['commit', ...(changed ? [] : ['--allow-empty']), '-m', spec.title, '-m', summary])

  if (onServer) {
    // The work stays in this folder for scTerra to fetch, unless the person asked the server to push it.
    let pushed = false
    if (spec.pushTo && changed && !failed) {
      try {
        execFileSync('git', ['push', spec.pushTo, `HEAD:refs/heads/${spec.branch}`], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
        pushed = true
        print({ type: 'note', text: `Pushed to ${spec.branch}.` })
      } catch (error) {
        const said = error instanceof Error && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '').trim().split('\n').at(-1) : ''
        print({ type: 'note', text: `The server couldn’t push ${spec.branch}${said ? ` (${said.slice(0, 200)})` : ''}. It’s kept there for scTerra to fetch.` })
      }
    }
    finish({ ok: !failed, summary, error: failed, pushed })
    return failed ? 1 : 0
  }
  // Only this push carries the job's token: the model's commands had no way to push anywhere.
  const auth = githubToken ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`] : []
  sh('git', [...auth, 'push', 'origin', `HEAD:refs/heads/${spec.branch}`])
  print({ type: 'note', text: `Pushed to ${spec.branch}.` })

  let prUrl: string | null = null
  if (spec.pr && changed && githubToken) {
    const made = await api('POST', '/pulls', { title: spec.title, head: spec.branch, base: spec.base, body: `${summary}${spec.issue ? `\n\nFor #${spec.issue}.` : ''}\n\n---\nMade by Terra Code in the cloud.` })
    prUrl = typeof made?.html_url === 'string' ? made.html_url : null
    // Repositories may not let Actions open pull requests; scTerra opens it next time it checks.
    print({ type: 'note', text: prUrl ? `Opened a pull request: ${prUrl}` : 'GitHub didn’t let the run open a pull request. scTerra opens it when it next checks.' })
  }
  // Started from a comment: the answer goes back where it was asked.
  if (spec.issue) {
    const where = prUrl ? `the pull request ${prUrl}` : changed ? `the branch \`${spec.branch}\`` : null
    await api('POST', `/issues/${spec.issue}/comments`, { body: `${summary}${where ? `\n\nThe changes are on ${where}.` : ''}\n\n<sub>Terra Code, in GitHub Actions</sub>` })
  }
  await sendProgress({ conclusion: failed ? 'failure' : 'success', summary })

  if (spec.trigger) {
    try {
      sh('git', [...auth, 'push', 'origin', '--delete', spec.trigger], true)
    } catch {
      // scTerra deletes it when it next checks.
    }
  }
  return failed ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : 'The cloud run failed.'
    print({ type: 'error', message })
    try {
      if (process.argv[2] && process.argv[2] !== '--event' && (JSON.parse(readFileSync(process.argv[2], 'utf8')) as CloudTask).where === 'server') writeFileSync(join(process.cwd(), '..', 'result.json'), JSON.stringify({ ok: false, error: message }))
    } catch {
      // The app says the run stopped without saying why.
    }
    process.exit(1)
  }
)
