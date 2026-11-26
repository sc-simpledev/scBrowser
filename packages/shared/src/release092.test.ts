import { describe, expect, it } from 'vitest'
import { contextWindowFor, isCompactCommand, noteFileName, noteMarkdown, shortCount, splitRemember, withSummary } from './chatExtras'
import { coderStylePrompt, prCommentsTask, securityReviewTask, CODER_BUILTIN_COMMANDS } from './coder'
import { isSiteAction, siteControlsHeight, SITE_POPUP } from './overlay'
import { dataCodewords, encodeQr, formatBits, versionBits, type QrCode } from './qr'
import { sanitizeSettings } from './settings'
import { isRoutine, routineDue, routineLabel, routineRan, type Routine } from './tabs'

/**
 * A QR reader written apart from the encoder, from the standard's own description: format bits
 * from the second copy, its own map of the fixed patterns, its own zigzag, block sizes from the
 * standard's table, and Reed–Solomon checked by evaluating each block at the generator's roots.
 */
const EXP: number[] = []
const LOG: number[] = new Array(256).fill(0)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[(LOG[a]! + LOG[b]!) % 255]!)

/** [blocks, codewords per block, data codewords per block] for level M, from the standard's table. */
const BLOCKS_M: Record<number, [number, number, number][]> = {
  1: [[1, 26, 16]],
  4: [[2, 50, 32]],
  7: [[4, 49, 31]],
  10: [[4, 69, 43], [1, 70, 44]]
}
const ALIGN: Record<number, number[]> = { 1: [], 4: [6, 26], 7: [6, 22, 38], 10: [6, 28, 50] }

function read(code: QrCode): { level: string; mask: number; text: string } {
  const { size, modules } = code
  const version = (size - 17) / 4
  const at = (x: number, y: number) => modules[y]![x]!
  let format = 0
  for (let i = 0; i < 8; i++) format |= (at(size - 1 - i, 8) ? 1 : 0) << i
  for (let i = 8; i < 15; i++) format |= (at(8, size - 15 + i) ? 1 : 0) << i
  const unmasked = format ^ 0x5412
  const level = ['M', 'L', 'H', 'Q'][unmasked >>> 13]!
  const mask = (unmasked >>> 10) & 7

  const fixed = (x: number, y: number) => {
    if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) return true
    if (x === 6 || y === 6) return true
    if (version >= 7 && ((x >= size - 11 && x < size - 8 && y < 6) || (y >= size - 11 && y < size - 8 && x < 6))) return true
    const align = ALIGN[version]!
    for (const ay of align)
      for (const ax of align) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === align.at(-1)) || (ay === 6 && ax === align.at(-1))) continue
        if (Math.abs(x - ax) <= 2 && Math.abs(y - ay) <= 2) return true
      }
    return false
  }
  const masked = (x: number, y: number) => [(y + x) % 2 === 0, y % 2 === 0, x % 3 === 0, (y + x) % 3 === 0, (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, ((y * x) % 2) + ((y * x) % 3) === 0, (((y * x) % 2) + ((y * x) % 3)) % 2 === 0, (((y + x) % 2) + ((y * x) % 3)) % 2 === 0][mask]!
  const bits: number[] = []
  let upward = true
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step
      for (const column of [x, x - 1]) if (!fixed(column, y)) bits.push((at(column, y) !== masked(column, y)) ? 1 : 0)
    }
    upward = !upward
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((sum, bit) => sum * 2 + bit, 0))

  // Undo the interleaving: data codewords column by column, then error correction the same way.
  const shape = BLOCKS_M[version]!.flatMap(([count, total, data]) => Array.from({ length: count }, () => ({ total, data })))
  const blocks = shape.map(() => [] as number[])
  let k = 0
  const longest = Math.max(...shape.map((one) => one.data))
  for (let i = 0; i < longest; i++) shape.forEach((one, b) => i < one.data && blocks[b]!.push(bytes[k++]!))
  const ecc = shape[0]!.total - shape[0]!.data
  for (let i = 0; i < ecc; i++) shape.forEach((_one, b) => blocks[b]!.push(bytes[k++]!))
  for (const block of blocks) {
    for (let root = 0; root < ecc; root++) {
      let value = 0
      for (const codeword of block) value = mul(value, EXP[root]!) ^ codeword
      expect(value, `syndrome ${root}`).toBe(0)
    }
  }
  const data = blocks.flatMap((block, b) => block.slice(0, shape[b]!.data))
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >>> (7 - i)) & 1))
  const take = (count: number) => stream.splice(0, count).reduce((sum, bit) => sum * 2 + bit, 0)
  expect(take(4)).toBe(0b0100)
  const length = take(version < 10 ? 8 : 16)
  const text = new TextDecoder().decode(new Uint8Array(Array.from({ length }, () => take(8))))
  return { level, mask, text }
}

describe('QR codes for pages', () => {
  it('codes format and version information as the standard’s tables have it', () => {
    expect(formatBits('M', 0)).toBe(0b101010000010010)
    expect(formatBits('L', 0)).toBe(0b111011111000100)
    expect(formatBits('M', 5)).toBe(0b100000011001110)
    expect(versionBits(7)).toBe(0x07c94)
    expect(versionBits(10)).toBe(0x0a4d3)
    // Byte capacities at level M.
    expect(dataCodewords(1, 'M')).toBe(16)
    expect(dataCodewords(10, 'M')).toBe(216)
  })

  it('reads back what it was given, with every block’s error correction right', () => {
    for (const [text, version] of [
      ['https://a.io', 1],
      ['https://example.com/a/path?query=1&b=two&c=three', 4],
      [`https://www.example.org/articles/${'x'.repeat(80)}`, 7],
      [`https://scterra.example/${'é'.repeat(40)}/${'y'.repeat(90)}`, 10]
    ] as const) {
      const code = encodeQr(text)!
      expect(code.version, text).toBe(version)
      expect(code.size).toBe(version * 4 + 17)
      const back = read(code)
      expect(back).toEqual({ level: 'M', mask: code.mask, text })
    }
  })

  it('draws the three finders and the dark module', () => {
    const code = encodeQr('https://example.com')!
    const finder = (x0: number, y0: number) => [0, 1, 2, 3, 4, 5, 6].every((i) => code.modules[y0]![x0 + i] && code.modules[y0 + 6]![x0 + i] && code.modules[y0 + i]![x0] && code.modules[y0 + i]![x0 + 6])
    expect(finder(0, 0) && finder(code.size - 7, 0) && finder(0, code.size - 7)).toBe(true)
    expect(code.modules[code.size - 8]![8]).toBe(true)
  })

  it('gives up on an address too long for any code', () => {
    expect(encodeQr('x'.repeat(3000))).toBeNull()
  })
})

describe('the assistant’s new pieces', () => {
  it('takes a remember block off the end of a reply, and hides one still arriving', () => {
    expect(splitRemember('Sure, in kilometres.\n\n```scterra-remember\nPrefers metric units.\n```')).toEqual({ text: 'Sure, in kilometres.', remember: 'Prefers metric units.' })
    expect(splitRemember('Sure.\n```scterra-remember\nPrefers')).toEqual({ text: 'Sure.', remember: null })
    expect(splitRemember('No block here.')).toEqual({ text: 'No block here.', remember: null })
  })

  it('sends a summary in place of the messages it covers', () => {
    const messages = [
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
      { role: 'user' as const, content: 'c' },
      { role: 'assistant' as const, content: 'd' },
      { role: 'user' as const, content: 'e' }
    ]
    expect(withSummary(messages, null)).toBe(messages)
    const sent = withSummary(messages, { text: 'They asked a, b and c.', upTo: 3 })
    expect(sent.map((message) => message.content)).toEqual(['(Earlier in this chat, summed up to make room:)\nThey asked a, b and c.', 'Understood. I’ll carry on from there.', 'd', 'e'])
    expect(isCompactCommand('/compact')).toBe(true)
    expect(isCompactCommand('/compact this')).toBe(false)
  })

  it('guesses context windows and writes counts short', () => {
    expect(contextWindowFor('claude-sonnet-5-5')).toBe(200_000)
    expect(contextWindowFor('claude-opus-5-5[1m]')).toBe(1_000_000)
    expect(contextWindowFor('gpt-5')).toBe(400_000)
    expect(contextWindowFor(null)).toBe(128_000)
    expect([shortCount(950), shortCount(1234), shortCount(48_200), shortCount(1_250_000)]).toEqual(['950', '1.2k', '48k', '1.3M'])
  })

  it('names and writes notes as Markdown with front matter', () => {
    const date = new Date(2026, 10, 26, 9, 30)
    expect(noteFileName('What is a "QR" code? / how', date)).toBe('2026-11-26 What is a QR code how.md')
    expect(noteFileName('', date)).toBe('2026-11-26 Note.md')
    const note = noteMarkdown('It is a matrix code.', { question: 'What is a QR code?', page: { title: 'QR [code]', url: 'https://example.com/"qr"' }, date })
    expect(note).toContain('source: "https://example.com/%22qr%22"')
    expect(note).toContain('> What is a QR code?')
    expect(note).toContain('From [QR code](https://example.com/"qr")')
    expect(note.trim().endsWith('It is a matrix code.')).toBe(true)
  })
})

describe('Terra Code additions', () => {
  it('has the new commands, styles and tasks', () => {
    const names = CODER_BUILTIN_COMMANDS.map((command) => command.name)
    for (const name of ['server', 'context', 'doctor', 'style', 'security-review', 'pr-comments']) expect(names).toContain(name)
    expect(coderStylePrompt('default')).toBe('')
    expect(coderStylePrompt('explanatory')).toMatch(/Insight/)
    expect(coderStylePrompt('learning')).toMatch(/TODO\(you\)/)
    expect(securityReviewTask('main')).toMatch(/git diff main\.\.\.HEAD/)
    expect(prCommentsTask(12)).toMatch(/pull request #12/)
    expect(prCommentsTask(null)).toMatch(/for this branch/)
  })

  it('keeps the new settings only when they’re valid', () => {
    expect(sanitizeSettings({ coderServer: 'me@box', coderServerPush: true, coderStyle: 'learning', coderLspProblems: false, assistantStatusLine: false, notesFolder: '/notes', memorySuggestions: false })).toEqual({ coderServer: 'me@box', coderServerPush: true, coderStyle: 'learning', coderLspProblems: false, assistantStatusLine: false, notesFolder: '/notes', memorySuggestions: false })
    expect(sanitizeSettings({ coderServer: '-oProxyCommand=x', coderStyle: 'loud' })).toEqual({})
    expect(sanitizeSettings({ siteWorkspaces: { 'github.com': 'work-1' } })).toEqual({ siteWorkspaces: { 'github.com': 'work-1' } })
    expect(sanitizeSettings({ siteWorkspaces: { 'github.com': 'no spaces allowed' } })).toEqual({})
  })
})

describe('the padlock’s panel', () => {
  it('takes the new actions and sizes itself for the QR code', () => {
    for (const action of ['qr-toggle', 'copy-link', 'workspace:', 'workspace:work-1']) expect(isSiteAction(action), action).toBe(true)
    expect(isSiteAction('workspace:not ok')).toBe(false)
    expect(siteControlsHeight({ permissions: [], qrOpen: true })).toBe(SITE_POPUP.header + SITE_POPUP.qr + SITE_POPUP.footer)
    // A workspace row only when there's more than one to choose from.
    expect(siteControlsHeight({ permissions: [], workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }) - siteControlsHeight({ permissions: [], workspaces: [] })).toBe(SITE_POPUP.row)
  })
})

describe('routines', () => {
  const routine: Routine = { setId: 'set-1', days: [1, 2, 3, 4, 5], time: '09:00', workspace: null, lastRun: null }
  it('runs once on its days, from its time, for a few hours', () => {
    const monday = (hours: number, minutes = 0) => new Date(2026, 10, 23, hours, minutes)
    expect(routineDue(routine, monday(8, 59))).toBe(false)
    expect(routineDue(routine, monday(9))).toBe(true)
    expect(routineDue(routine, monday(11, 59))).toBe(true)
    expect(routineDue(routine, monday(12, 1))).toBe(false)
    expect(routineDue(routineRan(routine, monday(9)), monday(9, 30))).toBe(false)
    // Saturday isn't one of its days.
    expect(routineDue(routine, new Date(2026, 10, 28, 9, 30))).toBe(false)
    expect(routineLabel(routine)).toBe('Mon–Fri at 09:00')
    expect(routineLabel({ days: [6, 0], time: '10:30' })).toBe('Weekends at 10:30')
  })

  it('checks what it’s given', () => {
    expect(isRoutine(routine)).toBe(true)
    expect(isRoutine({ ...routine, days: [] })).toBe(false)
    expect(isRoutine({ ...routine, time: '25:00' })).toBe(false)
    expect(sanitizeSettings({ routines: [routine] })).toEqual({ routines: [routine] })
  })
})
