import { describe, expect, it } from 'vitest'
import { ASK_COMMAND, bookmarkKey, DEFAULT_STUDY_PREFS, duplicateBookmarks, isNewTabConfig, matchPalette, sanitizeStudyPrefs } from '@scbrowser/shared'
import { checkLinks } from './linkCheck'
import { StudyService } from './study'
import type { KeyValueRepo } from './storage/kv'

const memoryKv = () => {
  const map = new Map<string, unknown>()
  return { get: (key: string) => map.get(key), set: (key: string, value: unknown) => void map.set(key, value) } as unknown as KeyValueRepo
}

function timer() {
  let now = new Date(2026, 10, 23, 9).getTime()
  let focus = false
  const said: string[] = []
  const sounds: [string, number][] = []
  const study = new StudyService({
    kv: memoryKv(),
    idleSeconds: () => 0,
    focusMode: () => focus,
    setFocusMode: (on) => (focus = on),
    onChange: () => undefined,
    notify: (text) => said.push(text),
    sound: (sound, volume) => sounds.push([sound, volume]),
    now: () => now,
    timers: false
  })
  return { study, said, sounds, advance: (ms: number) => (now += ms), focus: () => focus }
}

describe('focus timer: breaks, sounds and distraction times', () => {
  it('takes a break from the stopwatch and carries on as a stopwatch afterwards', () => {
    const t = timer()
    const [subject] = t.study.subjects()
    t.study.start(subject!.id)
    t.advance(20 * 60_000)
    t.study.takeBreak()
    expect(t.study.state().running).toBeNull()
    expect(t.study.state().onBreak).toMatchObject({ subjectId: subject!.id, mode: 'stopwatch' })
    expect(t.study.state().today).toHaveLength(1)
    t.advance(DEFAULT_STUDY_PREFS.breakMinutes * 60_000)
    t.study.tick()
    const running = t.study.state().running
    expect(running?.subjectId).toBe(subject!.id)
    expect(running?.endsAt).toBeUndefined()
    expect(t.said.at(-1)).toContain('running again')
    expect(t.sounds).toEqual([['chime', 60]])
  })

  it('plays the chosen sound at a round’s end, and none when asked for none', () => {
    const t = timer()
    const [subject] = t.study.subjects()
    t.study.setPrefs({ mode: 'countdown', rounds: 2, sound: 'bell', volume: 30 })
    t.study.start(subject!.id)
    t.advance(DEFAULT_STUDY_PREFS.focusMinutes * 60_000)
    t.study.tick()
    expect(t.sounds).toEqual([['bell', 30]])
    t.study.setPrefs({ sound: 'none' })
    t.advance(DEFAULT_STUDY_PREFS.breakMinutes * 60_000)
    t.study.tick()
    expect(t.sounds).toHaveLength(1)
  })

  it('keeps when each blocked site was tried, for the timeline', () => {
    const t = timer()
    const [subject] = t.study.subjects()
    t.study.start(subject!.id)
    t.advance(60_000)
    t.study.noteDistraction('https://www.example.com/feed')
    t.advance(60_000)
    t.study.noteDistraction('https://example.com/')
    const times = t.study.state().running?.distractionTimes ?? []
    expect(times).toHaveLength(2)
    t.advance(60_000)
    t.study.stop()
    expect(t.study.state().today[0]?.distractionTimes).toEqual(times)
  })

  it('checks sound and volume like the other prefs', () => {
    expect(sanitizeStudyPrefs({ sound: 'airhorn', volume: 400 }, DEFAULT_STUDY_PREFS)).toMatchObject({ sound: 'chime', volume: 60 })
    expect(sanitizeStudyPrefs({ sound: 'soft', volume: 0 }, DEFAULT_STUDY_PREFS)).toMatchObject({ sound: 'soft', volume: 0 })
    // Prefs saved before 0.8.0 have neither.
    const { sound: _sound, volume: _volume, ...old } = DEFAULT_STUDY_PREFS
    expect(sanitizeStudyPrefs({}, old as typeof DEFAULT_STUDY_PREFS)).toMatchObject({ sound: 'chime', volume: 60 })
  })
})

describe('bookmark tidy-up', () => {
  it('counts the same page saved two ways as one, keeping the oldest', () => {
    expect(bookmarkKey('https://WWW.Example.com/a/#top')).toBe(bookmarkKey('https://example.com/a'))
    expect(bookmarkKey('https://example.com/a?x=1')).not.toBe(bookmarkKey('https://example.com/a'))
    const sets = duplicateBookmarks([
      { id: 3, url: 'https://example.com/a/' },
      { id: 1, url: 'https://example.com/a' },
      { id: 2, url: 'https://example.com/b' }
    ])
    expect(sets).toEqual([[{ id: 1, url: 'https://example.com/a' }, { id: 3, url: 'https://example.com/a/' }]])
  })

  it('calls only 404, 410 and vanished sites dead, and leaves slow ones alone', async () => {
    const answers: Record<string, () => Promise<Response>> = {
      'https://ok.example/': async () => new Response(null, { status: 200 }),
      'https://gone.example/': async () => new Response(null, { status: 404 }),
      'https://nohead.example/': async () => new Response(null, { status: 405 }),
      'https://nosuch.example/': async () => {
        throw new TypeError('fetch failed', { cause: new Error('net::ERR_NAME_NOT_RESOLVED') })
      },
      'https://slow.example/': async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
    }
    const asked: string[] = []
    const results = await checkLinks([...Object.keys(answers), 'javascript:alert(1)', 'https://ok.example/'], async (url, init) => {
      asked.push(`${init.method} ${url}`)
      if (url === 'https://nohead.example/' && init.method === 'GET') return new Response(null, { status: 200 })
      return answers[url]!()
    })
    const state = Object.fromEntries(results.map((result) => [result.url, result.state]))
    expect(state).toEqual({ 'https://ok.example/': 'ok', 'https://gone.example/': 'dead', 'https://nohead.example/': 'ok', 'https://nosuch.example/': 'dead', 'https://slow.example/': 'unknown' })
    expect(asked).toContain('GET https://nohead.example/')
    expect(asked.some((line) => line.includes('javascript:'))).toBe(false)
  })
})

describe('palette and new tab', () => {
  it('offers to ask scAI when no command matches', () => {
    const [row] = matchPalette('zqxj')
    expect(row?.id).toBe(`${ASK_COMMAND}zqxj`)
    expect(row?.label).toContain('Ask scAI')
    expect(matchPalette('new tab').some((command) => command.id.startsWith(ASK_COMMAND))).toBe(false)
    expect(matchPalette('')).not.toHaveLength(0)
  })

  it('keeps removed top sites in the new tab settings', () => {
    expect(isNewTabConfig({ hiddenSites: ['https://example.com/'] })).toBe(true)
    expect(isNewTabConfig({ hiddenSites: [42] })).toBe(false)
  })
})
