import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ nativeTheme: { themeSource: 'system' } }))

import { Reporter } from './reporter'
import { SettingsStore } from './settings'
import { migrate } from './storage/database'
import { KeyValueRepo } from './storage/kv'

const environment = { version: '1', electron: '2', platform: 'linux', arch: 'x64' }

function setup() {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  const kv = new KeyValueRepo(db)
  const settings = new SettingsStore(kv)
  const sent: Record<string, unknown>[] = []
  const reporter = new Reporter(kv, settings, environment, async (body) => sent.push(body as Record<string, unknown>))
  return { kv, settings, sent, reporter }
}

describe('Reporter', () => {
  it('sends nothing until turned on, but still keeps a local log', () => {
    const { reporter, sent } = setup()
    reporter.start()
    reporter.record('page', 'crashed')
    reporter.finish()
    expect(sent).toEqual([])
    expect(reporter.list()).toMatchObject([{ kind: 'page', reason: 'crashed' }])
  })

  it('sends a crash with only the scrubbed details when opted in', () => {
    const { reporter, settings, sent } = setup()
    settings.set({ crashReports: true })
    reporter.record('exception', 'TypeError', 'TypeError: secret\n    at f (/home/alex/x/a.js:1:1)')
    expect(sent).toEqual([{ type: 'crash', ...environment, kind: 'exception', reason: 'TypeError', stack: 'at f (a.js:1:1)' }])
  })

  it('notices a session that ended without quitting', () => {
    const { reporter, kv, settings } = setup()
    reporter.start()
    const next = new Reporter(kv, settings, environment, null)
    next.start()
    next.finish()
    expect(next.list()).toMatchObject([{ kind: 'browser', reason: 'unclean-exit' }])
    const after = new Reporter(kv, settings, environment, null)
    after.start()
    after.finish()
    expect(after.list()).toHaveLength(1)
  })

  it('sends usage once a day when opted in', () => {
    const { reporter, settings, sent } = setup()
    settings.set({ usageStats: true })
    reporter.start()
    reporter.finish()
    reporter.start()
    reporter.finish()
    expect(sent).toEqual([{ type: 'usage', ...environment }])
  })
})
