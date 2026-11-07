/** Words someone marked on a page, kept on this computer and shown again when they come back. */
export interface Highlight {
  id: string
  /** The page without its fragment, so a highlight still shows after following an anchor. */
  url: string
  title: string
  text: string
  note: string
  createdAt: number
}

export const MAX_HIGHLIGHTS = 2000
export const MAX_HIGHLIGHT_CHARS = 2000
export const MAX_NOTE_CHARS = 2000

/** The page a highlight belongs to: the address without its fragment. */
export const highlightPage = (url: string) => (URL.canParse(url) ? Object.assign(new URL(url), { hash: '' }).toString() : url)

/** Only the marked words and notes go to the AI, each page's words as untrusted material. */
export function highlightsReportPrompt(highlights: Highlight[]): string {
  const pages = new Map<string, Highlight[]>()
  for (const highlight of highlights) pages.set(highlight.url, [...(pages.get(highlight.url) ?? []), highlight])
  const parts = [...pages].map(([url, marks]) => {
    const title = marks[0]?.title || url
    const lines = marks.map((mark) => `- ${mark.text.replace(/\s+/g, ' ').trim()}${mark.note ? `\n  My note: ${mark.note.trim()}` : ''}`)
    return `<selection>\nFrom "${title.replace(/"/g, "'")}" (${url}):\n${lines.join('\n').replace(/<\/?(page|selection)\b/gi, (tag: string) => tag.replace('<', '&lt;'))}\n</selection>`
  })
  return `Write a report from my highlights and notes below. Group related points, keep my notes' views, and say which page each point came from.\n\n${parts.join('\n\n')}`
}
