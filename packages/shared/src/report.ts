import { shownFileMessage } from './files'
import { shownPresetMessage } from './reportPresets'

export const REPORT_THEMES = [
  { id: 'clean', name: 'Clean' },
  { id: 'editorial', name: 'Editorial' },
  { id: 'brief', name: 'Brief' },
  { id: 'modern', name: 'Modern' },
  { id: 'magazine', name: 'Magazine' },
  { id: 'academic', name: 'Academic' },
  { id: 'notebook', name: 'Notebook' }
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
  /** Big figures, like "42%" over "of visitors". */
  | { type: 'stats'; items: { value: string; label: string }[] }
  | { type: 'timeline'; items: { when: string; text: string }[] }
  | { type: 'proscons'; pros: string[]; cons: string[] }
  /** A grid of short titled notes, such as the four parts of a SWOT. */
  | { type: 'cards'; items: { title: string; text: string }[] }
  | { type: 'steps'; items: { title: string; text: string }[] }

export interface Report {
  /** What kind of report it is, like "SWOT analysis", shown small above the title. */
  kind?: string
  title: string
  summary: string
  theme: ReportThemeId
  blocks: ReportBlock[]
}

export const REPORT_FORMATS = {
  pdf: { extension: 'pdf', label: 'PDF' },
  html: { extension: 'html', label: 'Web page (HTML)' },
  md: { extension: 'md', label: 'Markdown' },
  docx: { extension: 'docx', label: 'Word document' }
} as const

export type ReportFormat = keyof typeof REPORT_FORMATS

const FENCE = 'scterra-report'
/** Chats saved under the old name still hold the old tag. */
const FENCES = '(?:scterra|scdelta)-report'
const MAX_BLOCKS = 300
const MAX_TEXT = 8000
const MAX_ITEMS = 24

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
  hr: 'divider', separator: 'divider', rule: 'divider',
  stat: 'stats', metrics: 'stats', kpis: 'stats', figures: 'stats',
  events: 'timeline', milestones: 'timeline', chronology: 'timeline',
  pros_cons: 'proscons', 'pros-cons': 'proscons', procon: 'proscons', proandcon: 'proscons',
  grid: 'cards', swot: 'cards', card: 'cards', boxes: 'cards',
  howto: 'steps', procedure: 'steps', instructions: 'steps'
}

/** Pairs like `{"value": "42%", "label": "share"}`, which models also write as two-item arrays. */
function pairs<A extends string, B extends string>(value: unknown, first: A, second: B, firstNames: string[], secondNames: string[]): ({ [K in A | B]: string })[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ITEMS).flatMap((item) => {
    if (Array.isArray(item)) {
      const [a, b] = item.map((part) => itemText(part) ?? '')
      return a || b ? [{ [first]: a ?? '', [second]: b ?? '' } as { [K in A | B]: string }] : []
    }
    const record = item as Record<string, unknown> | null
    if (typeof record !== 'object' || record === null) {
      const text = itemText(item)
      return text ? [{ [first]: '', [second]: text } as { [K in A | B]: string }] : []
    }
    const pick = (names: string[]) => names.map((name) => string(record[name])).find((text) => text !== null) ?? ''
    const a = pick([first, ...firstNames])
    const b = pick([second, ...secondNames])
    return a || b ? [{ [first]: a, [second]: b } as { [K in A | B]: string }] : []
  })
}

const TITLE_NAMES = ['heading', 'name', 'label', 'step']
const BODY_NAMES = ['body', 'description', 'content', 'detail', 'value']

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
      // An empty corner cell is normal in a comparison, and dropping it would shift every column.
      const columns: unknown = block!.headers ?? block!.columns
      const headers = Array.isArray(columns) ? columns.map((column) => itemText(column) ?? '') : []
      return headers.some(Boolean) ? { type: 'table', headers, rows: tableRows(block!.rows, headers) } : null
    }
    case 'spacer':
      return { type: 'spacer' }
    case 'divider':
      return { type: 'divider' }
    case 'stats': {
      const items = pairs(block!.items ?? block!.stats, 'value', 'label', ['number', 'figure', 'stat'], ['text', 'caption', 'description', 'name'])
      return items.length > 0 ? { type: 'stats', items } : null
    }
    case 'timeline': {
      const items = pairs(block!.items ?? block!.events, 'when', 'text', ['date', 'time', 'year', 'period', 'label'], ['event', 'description', 'title', 'body'])
      return items.length > 0 ? { type: 'timeline', items } : null
    }
    case 'proscons': {
      const pros = strings(block!.pros ?? block!.advantages ?? block!.for).slice(0, MAX_ITEMS)
      const cons = strings(block!.cons ?? block!.disadvantages ?? block!.against).slice(0, MAX_ITEMS)
      return pros.length + cons.length > 0 ? { type: 'proscons', pros, cons } : null
    }
    case 'cards':
    case 'steps': {
      const items = pairs(block!.items ?? block!.cards ?? block!.steps, 'title', 'text', TITLE_NAMES, BODY_NAMES)
      return items.length > 0 ? { type, items } : null
    }
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
  const kind = string(data.kind)
  return {
    ...(kind ? { kind: kind.slice(0, 60) } : {}),
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
  const tagged = new RegExp('(?:^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*' + FENCES + '[^\\n{]*', 'i').exec(text)
  const named = new RegExp('(?:^|\\n)[ \\t]*(`{3,}|~{3,})[ \\t]*(?:json)?[ \\t]*\\r?\\n?(?=\\s*\\{\\s*"(?:kind|title|summary|theme|blocks)")', 'i').exec(text)
  const bare = /(?:^|\n)[ \t]*(?=\{\s*"(?:kind|title|summary|theme|blocks)")/.exec(text)
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
{"type":"stats","items":[{"value":"42%","label":"What it measures"}]},
{"type":"timeline","items":[{"when":"2024","text":"What happened"}]},
{"type":"proscons","pros":["A strength"],"cons":["A weakness"]},
{"type":"cards","items":[{"title":"Short title","text":"A sentence or two."}]},
{"type":"steps","items":[{"title":"Do this","text":"How, briefly."}]},
{"type":"spacer"},
{"type":"divider"}
]}
\`\`\`

Use stats for a few key figures, timeline for dates in order, proscons for trade-offs, cards for a grid of 2 to 6 short notes, and steps for instructions. Only use them where they fit, and never invent figures. "kind" is optional: a short label for what sort of report it is.

Theme is clean for general use, editorial for long reading, brief for short decisions, modern for bold overviews, magazine for features and stories, academic for formal or scholarly writing, or notebook for study notes. Heading levels are 2 or 3. All text is plain: never write HTML, CSS, Markdown or styling, because the design is applied for you.

The block must be valid JSON. Use straight double quotes, escape any double quote inside text as \\", write line breaks as \\n, and leave no trailing commas. Don't put backticks or code fences inside text. Stay under about 1,500 words so the report isn't cut off, and write the whole block before any closing remarks.`

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function blockHtml(block: ReportBlock): string {
  const e = escapeHtml
  switch (block.type) {
    case 'heading':
      return block.level === 3 ? `<h3>${e(block.text)}</h3>` : `<h2>${e(block.text)}</h2>`
    case 'paragraph':
      return `<p>${e(block.text)}</p>`
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map((item) => `<li>${e(item)}</li>`).join('')}</${tag}>`
    }
    case 'quote':
      return `<blockquote>${e(block.text)}</blockquote>`
    case 'callout':
      return `<div class="callout">${e(block.text)}</div>`
    case 'table':
      return `<div class="table"><table><thead><tr>${block.headers.map((header) => `<th>${e(header)}</th>`).join('')}</tr></thead><tbody>${block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${e(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`
    case 'spacer':
      return '<div class="spacer"></div>'
    case 'divider':
      return '<hr>'
    case 'stats':
      return `<div class="stats">${block.items.map((item) => `<div class="stat"><div class="stat-value">${e(item.value)}</div><div class="stat-label">${e(item.label)}</div></div>`).join('')}</div>`
    case 'timeline':
      return `<ol class="timeline">${block.items.map((item) => `<li><div class="when">${e(item.when)}</div><div>${e(item.text)}</div></li>`).join('')}</ol>`
    case 'proscons':
      return `<div class="proscons"><div class="pros"><div class="side">Pros</div><ul>${block.pros.map((item) => `<li>${e(item)}</li>`).join('')}</ul></div><div class="cons"><div class="side">Cons</div><ul>${block.cons.map((item) => `<li>${e(item)}</li>`).join('')}</ul></div></div>`
    case 'cards':
      return `<div class="cards">${block.items.map((item) => `<div class="card"><div class="card-title">${e(item.title)}</div><div>${e(item.text)}</div></div>`).join('')}</div>`
    case 'steps':
      return `<ol class="steps">${block.items.map((item) => `<li><div class="step-title">${e(item.title)}</div><div>${e(item.text)}</div></li>`).join('')}</ol>`
  }
}

/** A report as one file with no scripts or outside requests, safe to send to someone. */
export function reportHtml(report: Report, css: string): string {
  const e = escapeHtml
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${e(report.title)}</title>
<style>
${css}
body { margin: 0; padding: 40px 24px; background: var(--sc-surface); color: var(--sc-text); font-family: var(--sc-font-sans); font-size: var(--sc-text-sm); }
.sc-report { max-width: 720px; margin: 0 auto; }
@media print { body { padding: 0; } .sc-report { max-width: none; } }
</style>
</head>
<body>
<article class="sc-report" data-theme="${e(report.theme)}">
${report.kind ? `<p class="kind">${e(report.kind)}</p>` : ''}
<h1>${e(report.title)}</h1>
${report.summary ? `<p class="summary">${e(report.summary)}</p>` : ''}
${report.blocks.map(blockHtml).join('\n')}
</article>
</body>
</html>
`
}

/** Table cells can't hold pipes or line breaks. */
const markdownCell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

function blockMarkdown(block: ReportBlock): string {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`
    case 'paragraph':
      return block.text
    case 'list':
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`).join('\n')
    case 'quote':
    case 'callout':
      return block.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'table': {
      const row = (cells: string[]) => `| ${cells.map(markdownCell).join(' | ')} |`
      return [row(block.headers), row(block.headers.map(() => '---')), ...block.rows.map(row)].join('\n')
    }
    case 'spacer':
      return ''
    case 'divider':
      return '---'
    case 'stats':
      return block.items.map((item) => `- **${item.value}** ${item.label}`).join('\n')
    case 'timeline':
      return block.items.map((item) => `- **${item.when}**: ${item.text}`).join('\n')
    case 'proscons':
      return [`**Pros**`, ...block.pros.map((item) => `- ${item}`), '', `**Cons**`, ...block.cons.map((item) => `- ${item}`)].join('\n')
    case 'cards':
      return block.items.map((item) => `**${item.title}**\n${item.text}`).join('\n\n')
    case 'steps':
      return block.items.map((item, index) => `${index + 1}. **${item.title}** ${item.text}`).join('\n')
  }
}

/** A report as Markdown, for pasting into other tools. */
export function reportMarkdown(report: Report): string {
  const parts = [...(report.kind ? [`*${report.kind}*`] : []), `# ${report.title}`, report.summary, ...report.blocks.map(blockMarkdown)]
  return `${parts.filter(Boolean).join('\n\n')}\n`
}

/** Every report in a reply, in the order written. */
export function repliesReports(text: string): Report[] {
  const { report, after } = splitReply(text, true)
  return [...(report ? [report] : []), ...(after ? repliesReports(after) : [])]
}

/** Every report in a conversation, oldest first. */
export function conversationReports(turns: { role: string; content: string }[]): Report[] {
  return turns.flatMap((turn) => (turn.role === 'assistant' ? repliesReports(turn.content) : []))
}

/** Earlier and later drafts of a report: asking for changes keeps its title. */
export const reportVersions = (turns: { role: string; content: string }[], title: string) => conversationReports(turns).filter((report) => report.title === title)

const REVISE_ASK = /^Rewrite the report titled "(.*)" with this change: ([\s\S]*)\n\nReply with one short sentence, then the complete updated report/

/** What to show for a message in the conversation: a change request reads as what the person asked for. */
export function shownMessage(content: string): string {
  const asked = REVISE_ASK.exec(content)
  if (asked) return `Change to “${asked[1]}”: ${asked[2]}`
  return shownPresetMessage(content) ?? shownFileMessage(content) ?? content
}

/** Asks for a whole new draft, so each version stands alone. */
export const reviseReportPrompt = (title: string, change: string) =>
  `Rewrite the report titled "${title}" with this change: ${change}\n\nReply with one short sentence, then the complete updated report as a new ${FENCE} block. Keep exactly the same title, and keep everything else that wasn't asked to change.`
