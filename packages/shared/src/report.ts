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

/** Models add Markdown despite being told not to, and reports show text literally. */
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`/g, (_, a, b, c) => a ?? b ?? c).replace(/^#{1,6}\s+/, '')

const string = (value: unknown): string | null => {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return typeof value === 'string' && value.trim() ? plain(value.slice(0, MAX_TEXT)) : null
}
/** Models sometimes wrap each item as `{"text": "..."}`. */
const itemText = (value: unknown): string | null => string(value) ?? textOf(value as Record<string, unknown> | null)
const textOf = (block: Record<string, unknown> | null): string | null =>
  string(block?.text) ?? string(block?.content) ?? string(block?.value) ?? string(block?.body)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap((v) => itemText(v) ?? []) : [])

/** Other names models use for our block types. */
const BLOCK_NAMES: Record<string, string> = {
  h1: 'heading', h2: 'heading', h3: 'heading', title: 'heading', subheading: 'heading', section: 'heading',
  p: 'paragraph', para: 'paragraph', text: 'paragraph',
  ul: 'list', ol: 'list', bullets: 'list', bullet_list: 'list', bulleted_list: 'list', numbered_list: 'list', ordered_list: 'list',
  blockquote: 'quote',
  note: 'callout', tip: 'callout', warning: 'callout', info: 'callout', important: 'callout',
  hr: 'divider', separator: 'divider', rule: 'divider'
}

function tableRows(value: unknown, headers: string[]): string[][] {
  if (!Array.isArray(value)) return []
  const rows = value.map((row) => {
    if (Array.isArray(row)) return row.map((cell) => String(cell ?? '').slice(0, MAX_TEXT))
    // A row can also arrive as an object keyed by its column.
    if (typeof row === 'object' && row !== null) return headers.map((header) => String((row as Record<string, unknown>)[header] ?? '').slice(0, MAX_TEXT))
    return []
  })
  return rows.filter((row) => row.length > 0)
}

/** Only known blocks with plain text survive, so a report can never carry markup or styles. */
function toBlock(value: unknown): ReportBlock | null {
  const block = value as Record<string, unknown> | null
  const raw = typeof block?.type === 'string' ? block.type.toLowerCase() : ''
  const type = BLOCK_NAMES[raw] ?? raw
  const text = textOf(block)
  switch (type) {
    case 'heading':
      return text ? { type: 'heading', text, level: block!.level === 3 || block!.level === '3' || raw === 'h3' ? 3 : 2 } : null
    case 'paragraph':
    case 'quote':
    case 'callout':
      return text ? { type, text } : null
    case 'list': {
      const items = strings(block!.items ?? block!.list ?? block!.bullets)
      return items.length > 0 ? { type: 'list', items, ordered: block!.ordered === true || raw === 'ol' || raw === 'numbered_list' || raw === 'ordered_list' } : null
    }
    case 'table': {
      const headers = strings(block!.headers ?? block!.columns)
      return headers.length > 0 ? { type: 'table', headers, rows: tableRows(block!.rows, headers) } : null
    }
    case 'spacer':
      return { type: 'spacer' }
    case 'divider':
      return { type: 'divider' }
    default:
      return null
  }
}

/**
 * Repairs the mistakes models make when writing JSON by hand: raw line breaks in strings,
 * unescaped quotes, trailing commas, comments, and output cut off at the length limit.
 */
export function repairJson(source: string): string {
  let out = ''
  const closers: string[] = []
  let inString = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (inString) {
      if (char === '\\') {
        const next = source[i + 1]
        if (next === undefined) break
        // An escape JSON doesn't allow, like \', keeps just the character.
        out += '"\\/bfnrtu'.includes(next) ? char + next : next
        i++
      } else if (char === '"') {
        const after = /^\s*(.?)/.exec(source.slice(i + 1, i + 40))![1]
        // A real closing quote is followed by punctuation; anything else is a stray quote.
        if (after === '' || ',:}]'.includes(after!)) {
          inString = false
          out += char
        } else out += '\\"'
      } else if (char === '\n') out += '\\n'
      else if (char === '\r') continue
      else if (char === '\t') out += '\\t'
      else out += char
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '{' || char === '[') {
      closers.push(char === '{' ? '}' : ']')
      out += char
    } else if (char === '}' || char === ']') {
      out = out.replace(/,\s*$/, '')
      if (closers.at(-1) === char) closers.pop()
      out += char
    } else out += char
  }
  if (inString) out += '"'
  // Whatever was mid-way through writing when the text ran out can't be finished.
  out = out.replace(/,\s*$/, '').replace(/,?\s*"[^"]*"\s*:\s*$/, '').replace(/[:,]\s*$/, '')
  return out + closers.reverse().join('')
}

function parseJson(json: string): Record<string, unknown> | null {
  for (const attempt of [json, repairJson(json)]) {
    try {
      const data = JSON.parse(attempt) as unknown
      if (typeof data === 'object' && data !== null) return data as Record<string, unknown>
    } catch {
      // Try the next form.
    }
  }
  return null
}

export function toReport(json: string): Report | null {
  const data = parseJson(json)
  const list = Array.isArray(data) ? data : data?.blocks
  const blocks = Array.isArray(list) ? list.slice(0, MAX_BLOCKS).flatMap((b) => toBlock(b) ?? []) : []
  if (!data || blocks.length === 0) return null
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

/** Where the JSON object starting at `start` ends, skipping any braces or fences inside strings. */
function jsonEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (char === '\\') i++
      else if (char === '"') inString = false
    } else if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}' && --depth === 0) return i + 1
  }
  return -1
}

/**
 * Finds where a report starts. The usual form is our own tag, but models also use a `json`
 * fence, write the tag on one line with the JSON, or leave the fence out altogether.
 */
function findOpening(text: string): { index: number; start: number; fence: string } | null {
  const tagged = new RegExp('(?:^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*' + FENCE + '[^\\n{]*', 'i').exec(text)
  const named = new RegExp('(?:^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*(?:json)?[ \\t]*\\r?\\n?(?=\\s*\\{\\s*"(?:title|summary|theme|blocks)")', 'i').exec(text)
  const bare = /(?:^|\n)[ \t]*(?=\{\s*"(?:title|summary|theme|blocks)")/.exec(text)
  const match = tagged ?? named ?? bare
  if (!match) return null
  return { index: match.index, start: match.index + match[0].length, fence: match[1] ?? '' }
}

/** Splits a reply into plain text around an optional report block. `complete` means the reply has finished arriving. */
export function splitReply(text: string, complete = false): ReplyParts {
  const open = findOpening(text)
  if (!open) return { before: text, after: '', report: null, writing: false }
  const before = text.slice(0, open.index).trimEnd()
  const brace = text.indexOf('{', open.start)
  const end = brace === -1 ? -1 : jsonEnd(text, brace)
  if (end === -1) {
    if (!complete) return { before, after: '', report: null, writing: true }
    // The reply was cut off. Keep what was written instead of leaving a report that never arrives.
    const closing = open.fence ? text.lastIndexOf(open.fence) : -1
    const partial = text.slice(brace === -1 ? open.start : brace, closing > open.start ? closing : undefined)
    const report = toReport(partial)
    return report ? { before, after: '', report, writing: false } : { before: text, after: '', report: null, writing: false }
  }
  const report = toReport(text.slice(brace, end))
  // A report that can't be read still shows what was written rather than nothing.
  if (!report) return { before: text, after: '', report: null, writing: false }
  const rest = text.slice(end)
  const fence = open.fence && new RegExp('^\\s*' + open.fence).exec(rest)
  const after = (fence ? rest.slice(fence[0].length) : rest).trimStart()
  return { before, after, report, writing: false }
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

Theme is clean for general use, editorial for long reading, or brief for short decisions. Heading levels are 2 or 3. All text is plain: never write HTML, CSS, Markdown or styling, because the design is applied for you.

The block must be valid JSON. Use straight double quotes, escape any double quote inside text as \\", write line breaks as \\n, and leave no trailing commas. Don't put backticks or code fences inside text. Stay under about 1,500 words so the report isn't cut off, and write the whole block before any closing remarks.`
