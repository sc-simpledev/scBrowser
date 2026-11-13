import { describe, expect, it, vi } from 'vitest'
import { briefPreview, briefQuery, briefTitle, HOSTED_BRIEFS_PER_DAY, isBriefInput, nextBriefRun, type BriefInput, type BriefIssue } from '@scbrowser/shared'
import { BriefService, STARTUP_WINDOW_MS, trimIssues, type BriefDeps } from './briefs'
import type { KeyValueRepo } from './storage/kv'

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

function fakeKv(): KeyValueRepo {
  const values = new Map<string, string>()
  return {
    get: (key: string) => (values.has(key) ? JSON.parse(values.get(key)!) : undefined),
    set: (key: string, value: unknown) => void values.set(key, JSON.stringify(value)),
    delete: (key: string) => void values.delete(key)
  } as unknown as KeyValueRepo
}

const page = (n: number) => ({ title: `Story ${n}`, url: `https://news.example/${n}`, text: `Something happened ${n}.` })
const input = (patch: Partial<BriefInput> = {}): BriefInput => ({ title: '', topic: 'Research the latest AI news', time: '08:00', frequency: 'daily', weekday: 1, length: 'medium', ...patch })

function service(patch: Partial<BriefDeps> = {}) {
  let now = local(2026, 11, 11, 7, 0)
  const write = vi.fn(async (_system: string, _user: string, _tokens: number) => 'Big news today [1].')
  const search = vi.fn(async (_query: string, _options: { recency: string; read: number }) => [page(1), page(2)])
  const onReady = vi.fn((_issue: BriefIssue, _startup: boolean) => undefined)
  const deps: BriefDeps = { kv: fakeKv(), hosted: () => false, write, search, online: () => true, onChange: vi.fn(), onReady, now: () => now, timers: false, ...patch }
  return { briefs: new BriefService(deps), deps: { ...deps, write, search, onReady }, setNow: (time: number) => (now = time) }
}

describe('brief schedule', () => {
  it('runs later today when the time is still to come, or else tomorrow', () => {
    expect(nextBriefRun({ time: '08:00', frequency: 'daily', weekday: 0 }, local(2026, 11, 11, 7, 0))).toBe(local(2026, 11, 11, 8, 0))
    expect(nextBriefRun({ time: '08:00', frequency: 'daily', weekday: 0 }, local(2026, 11, 11, 8, 0))).toBe(local(2026, 11, 12, 8, 0))
  })

  it('keeps two days between briefs every other day', () => {
    const lastRun = local(2026, 11, 11, 8, 5)
    expect(nextBriefRun({ time: '08:00', frequency: 'every-2-days', weekday: 0 }, lastRun, lastRun)).toBe(local(2026, 11, 13, 8, 0))
    // A first run has nothing to count from.
    expect(nextBriefRun({ time: '08:00', frequency: 'every-2-days', weekday: 0 }, local(2026, 11, 11, 7, 0))).toBe(local(2026, 11, 11, 8, 0))
  })

  it('runs weekly briefs on their day', () => {
    // 11 November 2026 is a Wednesday.
    expect(nextBriefRun({ time: '09:30', frequency: 'weekly', weekday: 1 }, local(2026, 11, 11, 12, 0))).toBe(local(2026, 11, 16, 9, 30))
    expect(nextBriefRun({ time: '09:30', frequency: 'weekly', weekday: 3 }, local(2026, 11, 11, 9, 0))).toBe(local(2026, 11, 11, 9, 30))
    expect(nextBriefRun({ time: '09:30', frequency: 'weekly', weekday: 3 }, local(2026, 11, 11, 10, 0))).toBe(local(2026, 11, 18, 9, 30))
  })

  it('names and searches without the asking words', () => {
    expect(briefQuery('Research the latest AI news.')).toBe('latest AI news')
    expect(briefTitle('find me what is new in Rust')).toBe('What is new in Rust')
    expect(briefTitle('Latest AI News')).toBe('Latest AI News')
  })

  it('checks what a page sends', () => {
    expect(isBriefInput(input())).toBe(true)
    expect(isBriefInput(input({ time: '25:00' }))).toBe(false)
    expect(isBriefInput(input({ topic: '   ' }))).toBe(false)
    expect(isBriefInput(input({ frequency: 'hourly' as never }))).toBe(false)
    expect(isBriefInput(input({ length: 'huge' as never }))).toBe(false)
  })
})

describe('brief service', () => {
  it('writes a brief when its time comes, from a web search, and sets the next time', async () => {
    const { briefs, deps, setNow } = service()
    const schedule = briefs.save(null, input())
    expect(schedule.title).toBe('Latest AI news')
    expect(schedule.nextRunAt).toBe(local(2026, 11, 11, 8, 0))

    await briefs.tick()
    expect(deps.write).not.toHaveBeenCalled()

    setNow(local(2026, 11, 11, 8, 0))
    await briefs.tick()
    expect(deps.search).toHaveBeenCalledWith('latest AI news', { recency: 'd', read: 5, sites: [] })
    const [system, user, tokens] = deps.write.mock.calls[0]!
    expect(system).toContain('Medium length')
    expect(user).toContain('<page id="1"')
    expect(user).toContain('Write my medium brief on: Research the latest AI news')
    expect(tokens).toBe(10_000)

    const [issue] = briefs.issues()
    expect(issue).toMatchObject({ title: 'Latest AI news', text: 'Big news today [1].', unseen: true })
    expect(issue!.sources.map((source) => source.n)).toEqual([1, 2])
    expect(briefs.schedules()[0]!.nextRunAt).toBe(local(2026, 11, 12, 8, 0))
    expect(briefs.summary()).toMatchObject({ unseen: 1, latest: { id: issue!.id } })
    expect(deps.onReady).toHaveBeenCalledWith(issue, false)
  })

  it('runs a brief missed while closed once, and counts it as one opened at the start', async () => {
    const { briefs, deps, setNow } = service()
    briefs.save(null, input())
    // Three days later, still within moments of starting.
    const kv = deps.kv
    setNow(local(2026, 11, 14, 10, 0))
    const later = new BriefService({ ...deps, kv })
    await later.tick()
    expect(deps.write).toHaveBeenCalledTimes(1)
    expect(deps.onReady.mock.calls[0]![1]).toBe(true)
    expect(later.schedules()[0]!.nextRunAt).toBe(local(2026, 11, 15, 8, 0))

    setNow(local(2026, 11, 14, 10, 0) + STARTUP_WINDOW_MS + 1)
    await later.run(later.schedules()[0]!.id)
    expect(deps.onReady.mock.calls[1]![1]).toBe(false)
  })

  it(`allows ${HOSTED_BRIEFS_PER_DAY} a day on scTerra AI, and tries again tomorrow`, async () => {
    const { briefs, deps, setNow } = service({ hosted: () => true })
    const { id } = briefs.save(null, input())
    for (let i = 0; i < HOSTED_BRIEFS_PER_DAY; i++) await briefs.run(id)
    expect(briefs.state().hostedLeft).toBe(0)
    await expect(briefs.run(id)).rejects.toThrow(/today's 5 briefs/)
    expect(deps.write).toHaveBeenCalledTimes(HOSTED_BRIEFS_PER_DAY)

    setNow(local(2026, 11, 11, 8, 0))
    await briefs.tick()
    expect(deps.write).toHaveBeenCalledTimes(HOSTED_BRIEFS_PER_DAY)
    expect(briefs.schedules()[0]).toMatchObject({ nextRunAt: local(2026, 11, 12, 8, 0) })
    expect(briefs.schedules()[0]!.error).toMatch(/own API key/)

    setNow(local(2026, 11, 12, 8, 0))
    expect(briefs.state().hostedLeft).toBe(HOSTED_BRIEFS_PER_DAY)
    await briefs.tick()
    expect(deps.write).toHaveBeenCalledTimes(HOSTED_BRIEFS_PER_DAY + 1)
    expect(briefs.schedules()[0]!.error).toBeNull()
  })

  it('has no limit on your own key', async () => {
    const { briefs, deps } = service()
    const { id } = briefs.save(null, input())
    for (let i = 0; i < HOSTED_BRIEFS_PER_DAY + 3; i++) await briefs.run(id)
    expect(deps.write).toHaveBeenCalledTimes(HOSTED_BRIEFS_PER_DAY + 3)
  })

  it('asks nothing of the AI when the search finds nothing, and tries again later', async () => {
    const { briefs, deps, setNow } = service({ search: vi.fn(async () => []) })
    briefs.save(null, input())
    setNow(local(2026, 11, 11, 8, 0))
    await briefs.tick()
    expect(deps.write).not.toHaveBeenCalled()
    expect(briefs.schedules()[0]).toMatchObject({ nextRunAt: local(2026, 11, 11, 8, 30), error: expect.stringMatching(/didn't find/) })
  })

  it('needs a model', async () => {
    const { briefs } = service({ hosted: () => null })
    const { id } = briefs.save(null, input())
    await expect(briefs.run(id)).rejects.toThrow(/Choose a model/)
  })

  it('skips paused briefs, and resumes at the next time rather than catching up', async () => {
    const { briefs, deps, setNow } = service()
    const { id } = briefs.save(null, input())
    briefs.pause(id, true)
    setNow(local(2026, 11, 13, 12, 0))
    await briefs.tick()
    expect(deps.write).not.toHaveBeenCalled()
    briefs.pause(id, false)
    expect(briefs.schedules()[0]!.nextRunAt).toBe(local(2026, 11, 14, 8, 0))
  })

  it('opens new briefs at a start only once', async () => {
    const { briefs } = service()
    const { id } = briefs.save(null, input())
    expect(briefs.takeStartupBriefs()).toBe(false)
    await briefs.run(id)
    expect(briefs.takeStartupBriefs()).toBe(true)
    expect(briefs.takeStartupBriefs()).toBe(false)
    briefs.setPrefs({ openOnStart: false })
    await briefs.run(id)
    expect(briefs.takeStartupBriefs()).toBe(false)
  })

  it('marks briefs as seen', async () => {
    const { briefs } = service()
    const { id } = briefs.save(null, input())
    await briefs.run(id)
    await briefs.run(id)
    briefs.markSeen(briefs.issues()[0]!.id)
    expect(briefs.summary().unseen).toBe(1)
    briefs.markSeen(null)
    expect(briefs.summary()).toEqual({ unseen: 0, latest: null })
  })

  it('moves the next time when the schedule changes, and not otherwise', () => {
    const { briefs } = service()
    const { id, nextRunAt } = briefs.save(null, input())
    expect(briefs.save(id, input({ title: 'AI' })).nextRunAt).toBe(nextRunAt)
    expect(briefs.save(id, input({ time: '18:00' })).nextRunAt).toBe(local(2026, 11, 11, 18, 0))
  })

  it('searches the sites it was told to, and leaves out what the last brief said when asked', async () => {
    const { briefs, deps } = service()
    const { id } = briefs.save(null, input({ sites: ['example.com'], onlyNew: true }))
    await briefs.run(id)
    expect(deps.search.mock.calls[0]![1]).toMatchObject({ sites: ['example.com'] })
    expect(deps.write.mock.calls[0]![1]).not.toContain('<previous-brief>')
    await briefs.run(id)
    expect(deps.write.mock.calls[1]![1]).toContain('<previous-brief>\nBig news today [1].')
  })

  it('answers a question about a brief from the brief and its sources', async () => {
    const { briefs, deps } = service()
    const { id } = briefs.save(null, input())
    const issue = await briefs.run(id)
    deps.write.mockResolvedValueOnce(' It was the first one [1]. ')
    expect(await briefs.ask(issue.id, 'Which mattered most?')).toBe('It was the first one [1].')
    const [, user] = deps.write.mock.calls.at(-1)!
    expect(user).toContain('Big news today [1].')
    expect(user).toContain('Question: Which mattered most?')
    await expect(briefs.ask('gone', 'Hello?')).rejects.toThrow('no longer exists')
    await expect(briefs.ask(issue.id, '   ')).rejects.toThrow('Ask a question')
  })

  it('checks sites a page sends', () => {
    expect(isBriefInput(input({ sites: ['example.com'] }))).toBe(true)
    expect(isBriefInput(input({ sites: ['not a host'] }))).toBe(false)
    expect(isBriefInput(input({ sites: Array.from({ length: 6 }, (_, n) => `site${n}.com`) }))).toBe(false)
  })

  it('keeps the newest briefs of each schedule', () => {
    const issue = (scheduleId: string, n: number): BriefIssue => ({ id: `${scheduleId}${n}`, scheduleId, title: '', topic: '', length: 'short', createdAt: n, text: '', sources: [], unseen: false })
    const kept = trimIssues([...Array.from({ length: 40 }, (_, n) => issue('a', n)), issue('b', 0)])
    expect(kept.filter((one) => one.scheduleId === 'a')).toHaveLength(30)
    expect(kept.at(-1)!.scheduleId).toBe('b')
  })
})

describe('brief preview', () => {
  it('reads as plain text', () => {
    expect(briefPreview('- Short one about markets [1].\n## Next\n1. **Bold** move [2: "quote"]')).toBe('Short one about markets. Next Bold move')
  })
})

describe('brief sources and followed stories', () => {
  it('opens a web brief with the stories it follows, each with a search of its own', async () => {
    const { briefs, deps } = service()
    const schedule = briefs.save(null, input())
    briefs.follow(schedule.id, '  the chip [2] export rules ')
    expect(briefs.schedules()[0]!.follows).toEqual(['the chip export rules'])
    await briefs.run(schedule.id)
    expect(deps.search.mock.calls.map((call) => call[0])).toEqual(['latest AI news', 'the chip export rules'])
    expect(deps.write.mock.calls[0]![1]).toContain('Stories you follow')
    briefs.unfollow(schedule.id, 'the chip export rules')
    expect(briefs.schedules()[0]!.follows).toEqual([])
  })

  it('writes a reading list brief from saved pages, with no web search', async () => {
    const readingPages = vi.fn(async () => [page(7)])
    const { briefs, deps } = service({ readingPages })
    const schedule = briefs.save(null, input({ source: 'reading', topic: 'ignored' }))
    expect(schedule).toMatchObject({ title: 'Reading list catch-up', sites: [], onlyNew: false })
    await briefs.run(schedule.id)
    expect(deps.search).not.toHaveBeenCalled()
    expect(deps.write.mock.calls[0]![0]).toContain('reading list')
    expect(() => briefs.follow(schedule.id, 'anything')).toThrow('Only briefs from the web')
  })

  it('recaps the focus week from the timer alone, and says when there is nothing to recap', async () => {
    let week: string | null = null
    const { briefs, deps } = service({ focusWeek: () => week })
    const schedule = briefs.save(null, input({ source: 'focus' }))
    await expect(briefs.run(schedule.id)).rejects.toThrow('nothing from the last two weeks')
    week = 'Total this week: 9 h.'
    const issue = await briefs.run(schedule.id)
    expect(deps.write.mock.calls[0]![1]).toContain('<focus-week>\nTotal this week: 9 h.')
    expect(issue.sources).toEqual([])
    expect(deps.search).not.toHaveBeenCalled()
  })
})
