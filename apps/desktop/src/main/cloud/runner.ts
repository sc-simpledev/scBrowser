/**
 * Terra Code's cloud runner: what a GitHub Actions job runs for one task, bundled into a single
 * file (scripts/build-cloud-runner.mjs) that scTerra puts in the run's trigger branch. It uses the
 * same harness as the app, with nobody watching: every step is allowed, as the machine is GitHub's
 * and is thrown away after. It prints its events for the app to read back from the job's log,
 * commits the work to a branch of its own, and opens a pull request if it was asked to.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createProvider, type ChatMessage, type ToolUse } from '@scbrowser/ai'
import { CLOUD_EVENT_MARK, CLOUD_SECRET, type CoderEvent, type ProviderConfig } from '@scbrowser/shared'
import type { CloudTask } from '../ai/coderCloud'
import { Coder } from '../ai/coder'
import { CoderGithub } from '../ai/coderGithub'

const MAX_OUTPUT_TOKENS = 16_000
/** Long tool output is cut in the log: the app shows a summary of each step, not all of it. */
const LOG_OUTPUT_CHARS = 1500
const SESSION = 'cloud'

/** An event without its session, which the app fills in when it reads the log. */
type Printed = { [K in CoderEvent['type']]: Omit<Extract<CoderEvent, { type: K }>, 'sessionId'> }[CoderEvent['type']]

const print = (event: Printed) => process.stdout.write(`${CLOUD_EVENT_MARK}${JSON.stringify(event)}\n`)

function sh(command: string, args: string[], quiet = false): string {
  return execFileSync(command, args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'], maxBuffer: 50_000_000 }).trim()
}

async function main(): Promise<number> {
  const spec = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as CloudTask
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
  if (spec.model.needsKey && !secret.apiKey) {
    print({ type: 'error', message: `The repository secret ${CLOUD_SECRET} is missing, so the model can't be reached.` })
    return 1
  }

  const config: ProviderConfig = { id: 'cloud', name: 'Cloud', protocol: spec.model.protocol, baseUrl: spec.model.baseUrl, models: [spec.model.model], firstParty: spec.model.firstParty, ...(spec.model.needsKey ? {} : { hosted: true }) }
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
  const coder = new Coder({
    unattended: true,
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

  // The work goes to a branch of its own, made from where it started.
  sh('git', ['config', 'user.name', 'Terra Code'])
  sh('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  sh('git', ['add', '-A'])
  const changed = sh('git', ['status', '--porcelain']) !== ''
  const summary = (failed ? `Stopped: ${failed}\n\n${lastText}` : lastText).trim().slice(0, 6000) || (changed ? 'Done.' : 'Nothing needed changing.')
  sh('git', ['commit', ...(changed ? [] : ['--allow-empty']), '-m', spec.title, '-m', summary])
  // Only this push carries the job's token: the model's commands had no way to push anywhere.
  const auth = githubToken ? ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${githubToken}`).toString('base64')}`] : []
  sh('git', [...auth, 'push', 'origin', `HEAD:refs/heads/${spec.branch}`])
  print({ type: 'note', text: `Pushed to ${spec.branch}.` })

  if (spec.pr && changed && githubToken) {
    const response = await fetch(`https://api.github.com/repos/${spec.repo}/pulls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'scTerra' },
      body: JSON.stringify({ title: spec.title, head: spec.branch, base: spec.base, body: `${summary}\n\n---\nMade by Terra Code in the cloud.` })
    }).catch(() => null)
    // Repositories may not let Actions open pull requests; scTerra opens it next time it checks.
    if (response?.ok) print({ type: 'note', text: `Opened a pull request: ${((await response.json()) as { html_url: string }).html_url}` })
    else print({ type: 'note', text: 'GitHub didn’t let the run open a pull request. scTerra opens it when it next checks.' })
  }

  try {
    sh('git', [...auth, 'push', 'origin', '--delete', spec.trigger], true)
  } catch {
    // scTerra deletes it when it next checks.
  }
  return failed ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    print({ type: 'error', message: error instanceof Error ? error.message : 'The cloud run failed.' })
    process.exit(1)
  }
)
