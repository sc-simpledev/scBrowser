import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Report } from '@scbrowser/shared'
import { reportPptx, reportSlides } from './reportPptx'
import { parseNotes, speakerNotes } from './reportNotes'

const SAMPLE: Report = {
  kind: 'Study notes',
  title: 'Limited Public Transport',
  summary: 'How access to public transport affects daily life.',
  theme: 'notebook',
  blocks: [
    { type: 'callout', text: 'Without a nearby, frequent service, getting to work, school and care takes longer & costs more.' },
    { type: 'heading', level: 2, text: 'Slide 1: Define the issue' },
    { type: 'paragraph', text: 'Limited public transport means services are infrequent, far away or missing.' },
    { type: 'list', ordered: false, items: ['Long waits between buses', 'Few routes outside town centres', 'No evening or weekend services'] },
    { type: 'heading', level: 2, text: 'Slide 2: In the chosen location' },
    { type: 'stats', items: [{ value: '38%', label: 'live more than 800 m from a stop' }, { value: '40 min', label: 'between buses' }] },
    { type: 'table', headers: ['Year', 'What changed'], rows: [['2012', 'Route 12 cut'], ['2019', 'Evening buses stopped']] },
    { type: 'heading', level: 2, text: 'Test yourself' },
    { type: 'quiz', items: [{ question: 'What is a headway?', answer: 'The time between buses on a route.' }] }
  ],
  sources: [{ n: 1, title: 'Transport survey', url: 'https://example.com/survey' }]
}

describe('reportPptx', () => {
  it('starts a slide at each section, and gives tables and figures slides of their own', () => {
    expect(reportSlides(SAMPLE).map((slide) => `${slide.kind}: ${'title' in slide ? slide.title : ''}`)).toEqual([
      'title: Limited Public Transport',
      'text: Overview',
      'text: Slide 1: Define the issue',
      'stats: Slide 2: In the chosen location',
      'table: Slide 2: In the chosen location (continued)',
      'text: Test yourself',
      'text: Sources'
    ])
  })

  it('carries a long section on to more slides', () => {
    const long: Report = { ...SAMPLE, sources: undefined, blocks: [{ type: 'heading', level: 2, text: 'Long' }, { type: 'list', ordered: false, items: Array.from({ length: 30 }, (_, i) => `Point ${i}`) }] }
    const titles = reportSlides(long).map((slide) => ('title' in slide ? slide.title : ''))
    expect(titles.slice(1)).toEqual(['Long', 'Long (continued)', 'Long (continued)'])
  })

  it('writes a zip with escaped text', () => {
    const file = reportPptx(SAMPLE)
    expect(file.subarray(0, 2).toString()).toBe('PK')
    expect(file.includes(Buffer.from('ppt/slides/slide7.xml'))).toBe(true)
    if (process.env.SCB_PPTX_OUT) writeFileSync(join(process.env.SCB_PPTX_OUT, 'sample.pptx'), file)
  })
})

describe('speaker notes', () => {
  it('adds a notes page to each slide when there are notes', () => {
    const notes = reportSlides(SAMPLE).map((_, i) => `Say this about slide ${i + 1} & more`)
    const file = reportPptx(SAMPLE, notes)
    expect(file.includes(Buffer.from('ppt/notesSlides/notesSlide1.xml'))).toBe(true)
    expect(file.includes(Buffer.from('ppt/notesMasters/notesMaster1.xml'))).toBe(true)
    expect(reportPptx(SAMPLE).includes(Buffer.from('notesSlide'))).toBe(false)
    if (process.env.SCB_PPTX_OUT) writeFileSync(join(process.env.SCB_PPTX_OUT, 'notes.pptx'), file)
  })

  it('reads the notes the model sends, however it wraps them', () => {
    expect(parseNotes('Here you go:\n```json\n["One **bold**", "Two",]\n```', 3)).toEqual(['One bold', 'Two', ''])
    expect(parseNotes('No list here', 2)).toEqual([])
  })

  it('sends the slides as material and asks for one note each', async () => {
    let sent = ''
    const notes = await speakerNotes(SAMPLE, async (_system, user) => {
      sent = user
      return JSON.stringify(reportSlides(SAMPLE).map((_, i) => `Note ${i + 1}`))
    })
    expect(sent).toContain('Slide 3\nSlide 1: Define the issue')
    expect(notes[0]).toBe('Note 1')
    expect(notes).toHaveLength(reportSlides(SAMPLE).length)
  })
})
