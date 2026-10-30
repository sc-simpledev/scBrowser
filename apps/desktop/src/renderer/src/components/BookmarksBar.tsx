import { Globe } from 'lucide-react'
import { useApp } from '../state/app'
import { useActiveTab } from '../state/tabs'

export function BookmarksBar() {
  const visible = useApp((s) => s.settings.showBookmarksBar)
  const bookmarks = useApp((s) => s.bookmarks)
  const tab = useActiveTab()

  if (!visible) return null
  return (
    <div role="toolbar" aria-label="Bookmarks" className="flex h-8 shrink-0 items-center gap-0.5 overflow-hidden px-1.5 pb-1">
      {bookmarks.length === 0 && <span className="px-2 text-xs text-text-faint">Press Ctrl D to bookmark a page</span>}
      {bookmarks.map((bookmark) => (
        <button
          key={bookmark.id}
          type="button"
          title={bookmark.url}
          onClick={() => tab && void window.scb.invoke('tabs:navigate', tab.id, bookmark.url)}
          onAuxClick={(e) => {
            if (e.button === 1) void window.scb.invoke('tabs:open-in-background', bookmark.url)
          }}
          onContextMenu={() => void window.scb.invoke('bookmarks:context-menu', bookmark.id)}
          className="flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <Globe aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          <span className="truncate">{bookmark.title || bookmark.url}</span>
        </button>
      ))}
    </div>
  )
}
