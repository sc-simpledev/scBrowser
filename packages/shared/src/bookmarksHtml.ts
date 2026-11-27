import type { Bookmark, BookmarkGroup } from './library'

/**
 * Bookmarks as an HTML file in the Netscape format every browser reads and writes (Chrome, Firefox,
 * Edge, Safari, Brave), so they can go in and out of scTerra with nothing else installed.
 */

export const MAX_BOOKMARK_FILE_BYTES = 20 * 1024 * 1024
export const MAX_IMPORTED_BOOKMARKS = 20_000
const MAX_DEPTH = 8
const BAR = '\u0000bar'

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The bookmarks and their folders as a bookmarks file. Everything sits in the bookmarks bar, as in scTerra. */
export function bookmarksHtml(bookmarks: Bookmark[], groups: BookmarkGroup[], now = Date.now()): string {
  const seconds = (at: number) => String(Math.floor(at / 1000))
  const byPosition = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position)
  const lines: string[] = []
  const folder = (parentId: number | null, depth: number) => {
    const pad = '    '.repeat(depth)
    // Folders and bookmarks share one order on the bar and within a folder.
    const entries = byPosition([
      ...groups.filter((group) => group.parentId === parentId).map((group) => ({ position: group.position, group })),
      ...bookmarks.filter((bookmark) => bookmark.groupId === parentId).map((bookmark) => ({ position: bookmark.position, bookmark }))
    ])
    for (const entry of entries) {
      if ('group' in entry) {
        lines.push(`${pad}<DT><H3 ADD_DATE="${seconds(now)}">${escape(entry.group.name)}</H3>`, `${pad}<DL><p>`)
        folder(entry.group.id, depth + 1)
        lines.push(`${pad}</DL><p>`)
      } else lines.push(`${pad}<DT><A HREF="${escape(entry.bookmark.url)}" ADD_DATE="${seconds(entry.bookmark.createdAt)}">${escape(entry.bookmark.title || entry.bookmark.url)}</A>`)
    }
  }
  lines.push(
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file.',
    '     It will be read and overwritten.',
    '     DO NOT EDIT! -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `    <DT><H3 ADD_DATE="${seconds(now)}" LAST_MODIFIED="${seconds(now)}" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>`,
    '    <DL><p>'
  )
  folder(null, 2)
  lines.push('    </DL><p>', '</DL><p>', '')
  return lines.join('\n')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[name.toLowerCase()] ?? whole
  })

const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return match ? decode(match[2] ?? match[3] ?? match[4] ?? '') : null
}

/**
 * The bookmarks in a bookmarks file, each with the folders it sits in, outermost first. The
 * browser's own bar folder (PERSONAL_TOOLBAR_FOLDER) counts as the bar itself. Only web
 * addresses are kept, and at most 20,000.
 */
export function parseBookmarksHtml(html: string): { url: string; title: string; folder: string[] }[] {
  const found: { url: string; title: string; folder: string[] }[] = []
  // Each open list (<DL>) belongs to the folder heading just before it, or to none.
  const stack: (string | null)[] = []
  let pending: string | null = null
  const tokens = /<h3\b([^>]*)>([\s\S]*?)<\/h3>|<a\b([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    const text = match[0]
    if (match[2] !== undefined) {
      // The browser's bar folder opens a list that is the bar itself, so it adds no folder.
      const bar = /personal_toolbar_folder\s*=\s*"?true/i.test(match[1] ?? '')
      pending = bar ? BAR : decode(match[2].replace(/<[^>]+>/g, '')).trim() || 'Folder'
    } else if (match[4] !== undefined) {
      const url = attribute(match[3] ?? '', 'href')?.trim() ?? ''
      if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) continue
      const folder = stack.filter((name): name is string => !!name && name !== BAR).slice(0, MAX_DEPTH)
      found.push({ url, title: decode(match[4].replace(/<[^>]+>/g, '')).trim().slice(0, 500), folder })
      if (found.length >= MAX_IMPORTED_BOOKMARKS) break
    } else if (/^<dl/i.test(text)) {
      stack.push(pending)
      pending = null
    } else {
      stack.pop()
    }
  }
  return found
}
