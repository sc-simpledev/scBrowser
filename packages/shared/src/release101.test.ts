import { describe, expect, it } from 'vitest'
import { bookmarksHtml, DEFAULT_NEW_TAB, DEFAULT_SETTINGS, PALETTE_COMMANDS, parseBookmarksHtml, sanitizeSettings, WHATS_NEW, type Bookmark, type BookmarkGroup } from './index'

const bookmark = (id: number, url: string, title: string, groupId: number | null, position: number): Bookmark => ({ id, url, title, createdAt: 1_700_000_000_000, groupId, position })

describe('bookmarks as a file', () => {
  it('writes folders and bookmarks in order, and reads them back as they were', () => {
    const groups: BookmarkGroup[] = [
      { id: 1, name: 'Work', parentId: null, position: 1 },
      { id: 2, name: 'Docs & guides', parentId: 1, position: 0 }
    ]
    const bookmarks = [bookmark(10, 'https://news.example.com/', 'News', null, 0), bookmark(11, 'https://work.example.com/?a=1&b=2', 'Board <team>', 1, 1), bookmark(12, 'https://docs.example.com/', 'Docs', 2, 0)]
    const html = bookmarksHtml(bookmarks, groups, 1_700_000_000_000)
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true)
    expect(html).toContain('PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>')
    expect(html).toContain('HREF="https://work.example.com/?a=1&amp;b=2"')
    expect(html).toContain('>Board &lt;team&gt;</A>')
    expect(parseBookmarksHtml(html)).toEqual([
      { url: 'https://news.example.com/', title: 'News', folder: [] },
      { url: 'https://docs.example.com/', title: 'Docs', folder: ['Work', 'Docs & guides'] },
      { url: 'https://work.example.com/?a=1&b=2', title: 'Board <team>', folder: ['Work'] }
    ])
  })

  it('reads what Chrome and Firefox save: their bar is the bar, other folders stay folders', () => {
    const chrome = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" LAST_MODIFIED="2" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://a.example/" ADD_DATE="1" ICON="data:image/png;base64,AAA">A&#39;s page</A>
        <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    </DL><p>
    <DT><H3 ADD_DATE="1">Other bookmarks</H3>
    <DL><p>
        <DT><A HREF='https://b.example/x'>B</A>
        <DT><A HREF="place:sort=8">Recent tags</A>
    </DL><p>
</DL><p>`
    expect(parseBookmarksHtml(chrome)).toEqual([
      { url: 'https://a.example/', title: "A's page", folder: [] },
      { url: 'https://b.example/x', title: 'B', folder: ['Other bookmarks'] }
    ])
    const firefox = `<DL><p><DT><H3>Bookmarks Menu</H3><DL><p><DT><A HREF="https://c.example/">C</A></DL><p><DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3><DL><p><DT><A HREF="https://d.example/">D</A></DL><p></DL>`
    expect(parseBookmarksHtml(firefox)).toEqual([
      { url: 'https://c.example/', title: 'C', folder: ['Bookmarks Menu'] },
      { url: 'https://d.example/', title: 'D', folder: [] }
    ])
    expect(parseBookmarksHtml('<html><body>No bookmarks here</body></html>')).toEqual([])
  })
})

describe('1.0.1 settings and defaults', () => {
  it('takes the autoplay switch, off by default', () => {
    expect(DEFAULT_SETTINGS.blockAutoplay).toBe(false)
    expect(sanitizeSettings({ blockAutoplay: true })).toEqual({ blockAutoplay: true })
    expect(sanitizeSettings({ blockAutoplay: 'yes' })).toEqual({})
  })

  it('starts the new tab page without a greeting, which can still be added', () => {
    expect(DEFAULT_NEW_TAB.widgets.map((widget) => widget.id)).not.toContain('greeting')
  })

  it('offers bookmarking all tabs in the palette, and leads What’s New with 1.0.1', () => {
    expect(PALETTE_COMMANDS.map((command) => command.id)).toContain('bookmark-all-tabs')
    expect(WHATS_NEW[0]!.version).toBe('1.0.1')
  })
})
