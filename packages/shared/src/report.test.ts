import { describe, expect, it } from 'vitest'
import { splitReply, toReport } from './report'

const block = (json: string) => '```scdelta-report\n' + json + '\n```'
const valid = '{"title":"Plan","summary":"S","theme":"brief","blocks":[{"type":"heading","text":"One"},{"type":"paragraph","text":"Two"}]}'

describe('splitReply', () => {
  it('leaves plain text alone', () => {
    expect(splitReply('Hello')).toEqual({ before: 'Hello', after: '', report: null, writing: false })
  })

  it('finds a report and the text around it', () => {
    const parts = splitReply(`Here it is.\n\n${block(valid)}\n\nAnything else?`)
    expect(parts.before).toBe('Here it is.')
    expect(parts.after).toBe('Anything else?')
    expect(parts.report?.title).toBe('Plan')
    expect(parts.report?.theme).toBe('brief')
  })

  it('reports progress while the block is unfinished', () => {
    expect(splitReply('Intro\n```scdelta-report\n{"title":"Pl')).toMatchObject({ before: 'Intro', writing: true, report: null })
  })

  it('falls back to the raw text if the report is unreadable', () => {
    const text = block('{not json')
    expect(splitReply(text)).toMatchObject({ before: text, report: null, writing: false })
  })
})

describe('toReport', () => {
  it('drops unknown blocks and fields, so markup and styles cannot get in', () => {
    const report = toReport('{"blocks":[{"type":"html","text":"<script>"},{"type":"paragraph","text":"ok","style":"color:red"}],"css":"x"}')
    expect(report?.blocks).toEqual([{ type: 'paragraph', text: 'ok' }])
    expect(report).not.toHaveProperty('css')
  })

  it('uses defaults for a missing title and unknown theme', () => {
    expect(toReport('{"theme":"neon","blocks":[{"type":"divider"}]}')).toMatchObject({ title: 'Report', theme: 'clean' })
  })

  it('needs at least one usable block', () => {
    expect(toReport('{"blocks":[{"type":"nope"}]}')).toBeNull()
    expect(toReport('nope')).toBeNull()
  })

  it('tidies lists and tables', () => {
    const report = toReport('{"blocks":[{"type":"list","items":["a",2,""]},{"type":"table","headers":["h"],"rows":[["c",1],"x"]}]}')
    expect(report?.blocks).toEqual([
      { type: 'list', items: ['a'], ordered: false },
      { type: 'table', headers: ['h'], rows: [['c', '1']] }
    ])
  })
})
