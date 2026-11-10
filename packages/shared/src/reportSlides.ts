import type { Report, ReportBlock } from './report'

/**
 * A report split into slides, for the PowerPoint download and for presenting it in the app. Each
 * level-two heading starts a slide, so a report written as "Slide 1", "Slide 2" comes out as those.
 */

/** Roughly what fits in the body at 18 pt before a slide carries on to the next. */
const LINES_PER_SLIDE = 11
const CHARS_PER_LINE = 88

export interface SlideLine {
  text: string
  /** A bold lead-in before the rest of the line, like a card's title. */
  lead?: string
  bullet?: boolean
  numbered?: boolean
  level?: 0 | 1
  bold?: boolean
  italic?: boolean
  accent?: boolean
}

export type Slide =
  | { kind: 'title'; title: string; subtitle: string; label: string }
  | { kind: 'text'; title: string; lines: SlideLine[] }
  | { kind: 'table'; title: string; headers: string[]; rows: string[][] }
  | { kind: 'stats'; title: string; items: { value: string; label: string }[] }

export const slideWeight = (line: SlideLine) => Math.max(1, Math.ceil(((line.lead?.length ?? 0) + line.text.length + 2) / CHARS_PER_LINE))

function linesOf(block: ReportBlock): SlideLine[] {
  switch (block.type) {
    case 'heading':
      return [{ text: block.text, bold: true }]
    case 'paragraph':
      return [{ text: block.text }]
    case 'quote':
      return [{ text: `“${block.text}”`, italic: true }]
    case 'callout':
      return [{ text: block.text, accent: true, bold: true }]
    case 'list':
      return block.items.map((text) => ({ text, bullet: !block.ordered, numbered: block.ordered }))
    case 'timeline':
      return block.items.map((item) => ({ lead: item.when, text: item.text, bullet: true }))
    case 'cards':
      return block.items.map((item) => ({ lead: item.title, text: item.text, bullet: true }))
    case 'steps':
      return block.items.map((item) => ({ lead: item.title, text: item.text, numbered: true }))
    case 'proscons':
      return [
        ...(block.pros.length ? [{ text: 'Pros', bold: true }, ...block.pros.map((text) => ({ text, bullet: true, level: 1 as const }))] : []),
        ...(block.cons.length ? [{ text: 'Cons', bold: true }, ...block.cons.map((text) => ({ text, bullet: true, level: 1 as const }))] : [])
      ]
    case 'quiz':
      return block.items.flatMap((item) => [
        { text: item.question, numbered: true },
        { text: item.answer, bullet: true, level: 1 as const, italic: true }
      ])
    case 'stats':
    case 'table':
    case 'spacer':
    case 'divider':
      return []
  }
}

/** Splits a report into slides, carrying long sections on to more slides rather than shrinking them. */
export function reportSlides(report: Report): Slide[] {
  const slides: Slide[] = [{ kind: 'title', title: report.title, subtitle: report.summary, label: report.kind ?? '' }]
  let title = 'Overview'
  let lines: SlideLine[] = []
  let used = 0
  let part = 0
  const flush = () => {
    if (lines.length === 0) return
    slides.push({ kind: 'text', title: part > 0 ? `${title} (continued)` : title, lines })
    lines = []
    used = 0
    part++
  }
  for (const block of report.blocks) {
    if (block.type === 'heading' && block.level === 2) {
      flush()
      title = block.text
      part = 0
      continue
    }
    if (block.type === 'table') {
      flush()
      // Big tables go over several slides, with the header on each.
      for (let start = 0; start < Math.max(1, block.rows.length); start += 8) {
        slides.push({ kind: 'table', title: part > 0 ? `${title} (continued)` : title, headers: block.headers, rows: block.rows.slice(start, start + 8) })
        part++
      }
      continue
    }
    if (block.type === 'stats') {
      flush()
      slides.push({ kind: 'stats', title: part > 0 ? `${title} (continued)` : title, items: block.items.slice(0, 4) })
      part++
      continue
    }
    for (const line of linesOf(block)) {
      if (used + slideWeight(line) > LINES_PER_SLIDE && lines.length > 0) flush()
      lines.push(line)
      used += slideWeight(line)
    }
  }
  flush()
  if (report.sources?.length) {
    slides.push({ kind: 'text', title: 'Sources', lines: report.sources.map((source) => ({ lead: `${source.n}.`, text: `${source.title ? `${source.title}, ` : ''}${source.url}` })) })
  }
  return slides
}

/** A slide as plain text, for the model writing its speaker notes. */
export function slideText(slide: Slide): string {
  switch (slide.kind) {
    case 'title':
      return [slide.label, slide.title, slide.subtitle].filter(Boolean).join('\n')
    case 'text':
      return [slide.title, ...slide.lines.map((line) => `${line.bullet || line.numbered ? '- ' : ''}${line.lead ? `${line.lead}: ` : ''}${line.text}`)].join('\n')
    case 'table':
      return [slide.title, slide.headers.join(' | '), ...slide.rows.map((row) => row.join(' | '))].join('\n')
    case 'stats':
      return [slide.title, ...slide.items.map((item) => `${item.value}: ${item.label}`)].join('\n')
  }
}
