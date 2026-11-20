import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import type { CoderEvent } from '@scbrowser/shared'
import type { HeadlessCode } from './codeArgs'
import { AiService } from './ai/service'
import { AiStore } from './ai/store'
import { KvCoderTrust } from './ai/coderTrust'
import { CoderMcp } from './ai/coderMcp'
import { primeLoginPath } from './ai/coderTools'
import { SettingsStore } from './settings'
import { openDatabase } from './storage/database'
import { KeyValueRepo } from './storage/kv'

/**
 * Terra Code with no window, run from a terminal. It uses the same profile, models, keys, rules and
 * MCP servers as the browser, with nobody to ask: anything that would ask is answered by the flags.
 */
export async function runHeadless(job: HeadlessCode): Promise<number> {
  await app.whenReady()
  app.dock?.hide()
  await primeLoginPath()
  const db = openDatabase(join(app.getPath('userData'), 'browser.db'))
  const kv = new KeyValueRepo(db)
  const settings = new SettingsStore(kv)
  const trust = new KvCoderTrust(kv)
  const mcp = new CoderMcp(kv, trust)
  const ai = new AiService(new AiStore(kv), () => undefined, () => null, {
    dir: join(app.getPath('userData'), 'terra-code'),
    keep: () => false,
    trust,
    sandbox: () => settings.get().coderSandbox,
    autoCompact: () => true,
    autoCheck: () => settings.get().coderAutoCheck,
    autoFormat: () => settings.get().coderFormat,
    agentModel: () => settings.get().coderAgentModel,
    budget: () => settings.get().coderBudget,
    mcp,
    folder: () => job.folder
  })
  const out = (text: string) => process.stdout.write(text)
  const err = (text: string) => process.stderr.write(text)
  let answer = ''
  let failed: string | null = null
  const emit = (event: CoderEvent) => {
    if (job.json) out(`${JSON.stringify(event)}\n`)
    switch (event.type) {
      case 'approval': {
        const yes = event.kind === 'change' ? job.allowEdits : event.kind === 'command' ? job.allowCommands : false
        if (!job.json) err(`${yes ? '✓' : '✗'} ${event.summary}${yes ? '' : ' (not allowed: see --allow-edits and --allow-commands)'}\n`)
        ai.coder.answer(event.id, yes ? 'allow' : 'deny')
        return
      }
      case 'question':
        // Nobody can answer: the model is told to decide.
        ai.coder.answerQuestion(event.id, null)
        return
      case 'tool':
        if (!job.json) err(`▸ ${event.summary}\n`)
        return
      case 'text':
        answer = event.text
        return
      case 'error':
        failed = event.message
        return
      default:
    }
  }
  try {
    await ai.coder.run(`headless-${randomUUID()}`, job.folder, job.task, job.mode, emit)
  } finally {
    ai.coder.dispose()
    await mcp.closeAll()
    db.close()
  }
  if (!job.json) {
    if (failed) err(`${failed}\n`)
    else out(`${answer.trim()}\n`)
  }
  return failed ? 1 : 0
}
