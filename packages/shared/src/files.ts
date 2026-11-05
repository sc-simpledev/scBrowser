/**
 * Files the assistant writes, like a web page or a script. A reply holds them in fenced blocks,
 * and edits to them in blocks of their own, so the conversation is the file's whole history.
 */

export const FILE_FENCE = 'scterra-file'
export const EDIT_FENCE = 'scterra-edit'
const MAX_FILE_CHARS = 400_000
const MAX_NAME = 80

export interface FileEdit {
  find: string
  replace: string
}

export type ReplySegment =
  | { kind: 'text'; text: string }
  | { kind: 'file'; name: string; content: string; done: boolean }
  | { kind: 'edit'; name: string; edits: FileEdit[]; done: boolean }

export interface FileVersion {
  name: string
  content: string
  /** Which assistant reply made it, counting every turn. */
  turn: number
  how: 'created' | 'rewritten' | 'edited'
}

/** One of a reply's file or edit blocks, as its card describes it. */
export interface FileChange {
  name: string
  how: FileVersion['how'] | 'failed'
  /** Why an edit couldn't be applied. */
  error?: string
  /** The version this block made, which is what its card opens. */
  version?: FileVersion
}

/** Only a plain name: never a folder, and nothing a file system treats specially. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).at(-1) ?? ''
  const cleaned = base.replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '').slice(0, MAX_NAME)
  return cleaned || 'file.txt'
}

const EXTENSION_LANGUAGES: Record<string, string> = {
  html: 'html', htm: 'html', svg: 'svg', css: 'css', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', sh: 'shell',
  bash: 'shell', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', txt: 'text', csv: 'text'
}

export const languageOf = (name: string): string => EXTENSION_LANGUAGES[name.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'text'

/** What the preview can show: a page, a picture, a document, or a script's output. */
export function previewKind(name: string): 'html' | 'svg' | 'markdown' | 'script' | null {
  const language = languageOf(name)
  if (language === 'html' || language === 'svg' || language === 'markdown') return language
  return language === 'javascript' ? 'script' : null
}

const OPENING = new RegExp(`(?:^|\\n)([ \\t]*)(\`{3,}|~{3,})[ \\t]*(${FILE_FENCE}|${EDIT_FENCE})\\b([^\\n]*)\\n`, 'i')

function nameFrom(attributes: string): string {
  const quoted = /(?:name|file|path)\s*=\s*["']([^"'\n]+)["']/i.exec(attributes) ?? /(?:name|file|path)\s*=\s*(\S+)/i.exec(attributes)
  return safeFileName(quoted?.[1] ?? attributes.trim().split(/\s+/)[0] ?? '')
}

/** FIND and REPLACE pairs, in the order they're to be applied. Unfinished pairs are left out. */
export function parseEdits(body: string): FileEdit[] {
  const edits: FileEdit[] = []
  const pattern = /^<{5,}[ \t]*FIND[ \t]*\n([\s\S]*?)\n?^={5,}[ \t]*\n([\s\S]*?)\n?^>{5,}[ \t]*REPLACE[ \t]*$/gm
  for (const match of body.matchAll(pattern)) edits.push({ find: match[1] ?? '', replace: match[2] ?? '' })
  return edits
}

/** Splits a reply into its text and the files and edits written in it. `complete` means it has finished arriving. */
export function splitFiles(text: string, complete = false): ReplySegment[] {
  const segments: ReplySegment[] = []
  let rest = text
  for (;;) {
    const open = OPENING.exec(rest)
    if (!open) break
    const before = rest.slice(0, open.index)
    if (before.trim()) segments.push({ kind: 'text', text: before })
    const fence = open[2]!
    const body = rest.slice(open.index + open[0].length)
    // The closing fence is the same marks on a line of their own.
    const close = new RegExp(`(?:^|\\n)[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*(?:\\n|$)`).exec(body)
    const content = (close ? body.slice(0, close.index) : body).slice(0, MAX_FILE_CHARS)
    const done = !!close || complete
    const name = nameFrom(open[4] ?? '')
    if (open[3]!.toLowerCase() === EDIT_FENCE) segments.push({ kind: 'edit', name, edits: parseEdits(content), done })
    else segments.push({ kind: 'file', name, content, done })
    if (!close) return segments
    rest = body.slice(close.index + close[0].length)
  }
  if (rest.trim()) segments.push({ kind: 'text', text: rest })
  return segments
}

/** Applies edits in order. Each FIND must appear exactly once, or nothing changes. */
export function applyEdits(content: string, edits: FileEdit[]): { content: string } | { error: string } {
  if (edits.length === 0) return { error: 'The edit had nothing in it.' }
  let next = content
  for (const { find, replace } of edits) {
    if (!find) return { error: 'An edit didn’t say what to replace.' }
    let at = next.indexOf(find)
    let length = find.length
    if (at === -1) {
      // Models often get indentation or trailing spaces slightly wrong, so try line by line.
      const loose = looseMatch(next, find)
      if (!loose) return { error: 'An edit didn’t match the file, so the file was left as it was.' }
      ;[at, length] = loose
    } else if (next.indexOf(find, at + 1) !== -1) {
      return { error: 'An edit matched more than one place, so the file was left as it was.' }
    } else if (/^[ \t]/.test(find)) {
      // A FIND that starts with less indentation than the line has takes the line's whole indentation.
      const lineStart = next.lastIndexOf('\n', at - 1) + 1
      if (/^[ \t]*$/.test(next.slice(lineStart, at))) {
        length += at - lineStart
        at = lineStart
      }
    }
    next = next.slice(0, at) + replace + next.slice(at + length)
  }
  return { content: next }
}

/** Finds `find` comparing lines with their surrounding spaces trimmed. Returns where it starts and its length. */
function looseMatch(content: string, find: string): [number, number] | null {
  const lines = content.split('\n')
  const wanted = find.split('\n').map((line) => line.trim())
  while (wanted.length > 0 && !wanted.at(-1)) wanted.pop()
  if (wanted.length === 0) return null
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  let found: [number, number] | null = null
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((line, j) => lines[i + j]!.trim() === line)) {
      if (found) return null
      const end = starts[i + wanted.length - 1]! + lines[i + wanted.length - 1]!.length
      found = [starts[i]!, end - starts[i]!]
    }
  }
  return found
}

/** Every version of every file in a conversation, oldest first, and what each block in each reply did. */
export function conversationFiles(turns: { role: string; content: string }[]): { files: Map<string, FileVersion[]>; changes: Map<number, FileChange[]> } {
  const files = new Map<string, FileVersion[]>()
  const changes = new Map<number, FileChange[]>()
  turns.forEach((turn, index) => {
    if (turn.role !== 'assistant') return
    const made: FileChange[] = []
    for (const segment of splitFiles(turn.content, true)) {
      if (segment.kind === 'text') continue
      const versions = files.get(segment.name) ?? []
      const latest = versions.at(-1)
      if (segment.kind === 'file') {
        const version: FileVersion = { name: segment.name, content: segment.content, turn: index, how: latest ? 'rewritten' : 'created' }
        files.set(segment.name, [...versions, version])
        made.push({ name: segment.name, how: version.how, version })
      } else if (!latest) {
        made.push({ name: segment.name, how: 'failed', error: 'There’s no file by that name to edit.' })
      } else {
        const result = applyEdits(latest.content, segment.edits)
        if ('error' in result) made.push({ name: segment.name, how: 'failed', error: result.error })
        else {
          const version: FileVersion = { name: segment.name, content: result.content, turn: index, how: 'edited' }
          files.set(segment.name, [...versions, version])
          made.push({ name: segment.name, how: 'edited', version })
        }
      }
    }
    if (made.length > 0) changes.set(index, made)
  })
  return { files, changes }
}

/** The change box on a file asks for this, with the whole current file so nothing has to be remembered. */
export const reviseFilePrompt = (name: string, content: string, change: string) =>
  `Change the file ${name} with this change: ${change}\n\nHere is the current file:\n\n~~~~text\n${content}\n~~~~\n\nReply with one short sentence, then a ${EDIT_FENCE} block for ${name}, or the whole file again if most of it changes.`

const REVISE_FILE_ASK = /^Change the file (\S+) with this change: ([\s\S]*?)\n\nHere is the current file:/

export function shownFileMessage(content: string): string | null {
  const asked = REVISE_FILE_ASK.exec(content)
  return asked ? `Change to ${asked[1]}: ${asked[2]}` : null
}

export const FILE_INSTRUCTIONS = `When the person asks you to make a web page, app, game, tool, script, document or other file they could save, write it as a file. Open the block with four backticks and ${FILE_FENCE}, then the file name, and close it with four backticks:

\`\`\`\`${FILE_FENCE} name="index.html"
...the whole file...
\`\`\`\`

Write the whole file, never a fragment or "..." in place of code. For anything visual or interactive, prefer one self-contained HTML file with its CSS and JavaScript inside it. It's previewed with no internet access, so don't load scripts, fonts or images from other sites: draw with CSS, SVG or canvas instead. Keep it polished and working.

To change a file you wrote earlier, keep its name and either write it out again in full, or for small changes use an edit block with one or more FIND and REPLACE pairs. Each FIND must copy the current text exactly and appear only once in the file:

\`\`\`\`${EDIT_FENCE} name="index.html"
<<<<<<< FIND
the exact lines to replace
=======
the new lines
>>>>>>> REPLACE
\`\`\`\`

Say in a sentence what you made or changed, outside the block. Don't repeat the code in normal text.`
