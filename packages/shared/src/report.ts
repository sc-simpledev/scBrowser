export const REPORT_THEMES = [
  { id: 'clean', name: 'Clean' },
  { id: 'editorial', name: 'Editorial' },
  { id: 'brief', name: 'Brief' }
] as const

export type ReportThemeId = (typeof REPORT_THEMES)[number]['id']

export type ReportBlock =
  | { type: 'heading'; text: string; level: 2 | 3 }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'quote'; text: string }
  | { type: 'callout'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'spacer' }
  | { type: 'divider' }

export interface Report {
  title: string
  summary: string
  theme: ReportThemeId
  blocks: ReportBlock[]
}

const FENCE = 'scdelta-report'
const MAX_BLOCKS = 300
const MAX_TEXT = 8000

const string = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.slice(0, MAX_TEXT) : null)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap((v) => (string(v) === null ? [] : [string(v)!])) : [])

/** Only known blocks with plain text survive, so a report can never carry markup or styles. */
function toBlock(value: unknown): ReportBlock | null {
  const block = value as Record<string, unknown> | null
  const text = string(block?.text)
  switch (block?.type) {
    case 'heading':
      return text ? { type: 'heading', text, level: block.level === 3 ? 3 : 2 } : null
    case 'paragraph':
    case 'quote':
    case 'callout':
      return text ? { type: block.type, text } : null
    case 'list': {
      const items = strings(block.items)
      return items.length > 0 ? { type: 'list', items, ordered: block.ordered === true } : null
    }
    case 'table': {
      const headers = strings(block.headers)
      const rows = Array.isArray(block.rows) ? block.rows.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '').slice(0, MAX_TEXT)) : [])) : []
      return headers.length > 0 ? { type: 'table', headers, rows: rows.filter((row) => row.length > 0) } : null
    }
    case 'spacer':
      return { type: 'spacer' }
    case 'divider':
      return { type: 'divider' }
    default:
      return null
  }
}

export function toReport(json: string): Report | null {
  let data: Record<string, unknown>
  try {
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  const blocks = Array.isArray(data?.blocks) ? data.blocks.slice(0, MAX_BLOCKS).flatMap((b) => toBlock(b) ?? []) : []
  if (blocks.length === 0) return null
  return {
    title: string(data.title) ?? 'Report',
    summary: string(data.summary) ?? '',
    theme: REPORT_THEMES.some((theme) => theme.id === data.theme) ? (data.theme as ReportThemeId) : 'clean',
    blocks
  }
}

export interface ReplyParts {
  before: string
  after: string
  report: Report | null
  /** The report is still being written. */
  writing: boolean
}

/** Splits a reply into plain text around an optional report block. */
export function splitReply(text: string): ReplyParts {
  const open = new RegExp('```' + FENCE + '[^\\n]*\\n').exec(text)
  if (!open) return { before: text, after: '', report: null, writing: false }
  const before = text.slice(0, open.index).trimEnd()
  const start = open.index + open[0].length
  const close = text.indexOf('```', start)
  if (close === -1) return { before, after: '', report: null, writing: true }
  const report = toReport(text.slice(start, close))
  const after = text.slice(close + 3).trimStart()
  // A report that can't be read still shows what was written rather than nothing.
  return report ? { before, after, report, writing: false } : { before: text, after: '', report: null, writing: false }
}

export const REPORT_INSTRUCTIONS = `Usually answer in normal text. When the answer is long, a plan, a comparison or an overview of a topic, write a report instead: a short sentence introducing it, then one fenced block tagged ${FENCE} holding only JSON.

\`\`\`${FENCE}
{"title":"Title","summary":"One sentence.","theme":"clean","blocks":[
{"type":"heading","level":2,"text":"Section"},
{"type":"paragraph","text":"Plain text."},
{"type":"list","ordered":false,"items":["One","Two"]},
{"type":"table","headers":["A","B"],"rows":[["1","2"]]},
{"type":"callout","text":"Something important."},
{"type":"quote","text":"A quotation."},
{"type":"spacer"},
{"type":"divider"}
]}
\`\`\`

Theme is clean for general use, editorial for long reading, or brief for short decisions. Heading levels are 2 or 3. All text is plain: never write HTML, CSS, Markdown or styling, because the design is applied for you.`
