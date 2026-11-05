import { ChevronRight, Folder, FolderOpen, Globe } from 'lucide-react'
import { useState } from 'react'
import { isNewTabUrl, type Bookmark, type BookmarkGroup } from '@scbrowser/shared'
import { cx } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useActiveTab } from '../state/tabs'

const byPosition = <T extends { position: number }>(items: T[]) => [...items].sort((a, b) => a.position - b.position)

function open(url: string, tabId: number | undefined) {
  if (tabId !== undefined) void window.scb.invoke('tabs:navigate', tabId, url)
}

function Icon({ bookmark, size }: { bookmark: Bookmark; size: number }) {
  return bookmark.icon ? (
    <img src={bookmark.icon} alt="" draggable={false} className="shrink-0 rounded-sm object-contain" style={{ width: size, height: size }} />
  ) : (
    <Globe aria-hidden size={size - 2} strokeWidth={1.75} className="shrink-0 text-text-faint" />
  )
}

/** A square for each loose bookmark, four to a row, like Arc's and Dia's favourites. */
function Tile({ bookmark, tabId, active }: { bookmark: Bookmark; tabId: number | undefined; active: boolean }) {
  return (
    <button
      type="button"
      title={bookmark.title || bookmark.url}
      aria-label={bookmark.title || bookmark.url}
      onClick={() => open(bookmark.url, tabId)}
      onAuxClick={(e) => e.button === 1 && void window.scb.invoke('tabs:open-in-background', bookmark.url)}
      onContextMenu={() => void window.scb.invoke('bookmarks:context-menu', bookmark.id)}
      className={cx(
        'grid h-10 min-w-0 place-items-center rounded-md border transition-colors',
        active ? 'border-border-strong bg-surface-hover' : 'border-border bg-surface hover:bg-surface-hover'
      )}
    >
      <Icon bookmark={bookmark} size={16} />
    </button>
  )
}

function Row({ bookmark, depth, tabId }: { bookmark: Bookmark; depth: number; tabId: number | undefined }) {
  return (
    <button
      type="button"
      title={bookmark.url}
      onClick={() => open(bookmark.url, tabId)}
      onAuxClick={(e) => e.button === 1 && void window.scb.invoke('tabs:open-in-background', bookmark.url)}
      onContextMenu={() => void window.scb.invoke('bookmarks:context-menu', bookmark.id)}
      className="flex h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-md pr-2 text-left text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="grid size-5 shrink-0 place-items-center">
        <Icon bookmark={bookmark} size={14} />
      </span>
      <span className="truncate">{bookmark.title || bookmark.url}</span>
    </button>
  )
}

function FolderRow({ group, depth, groups, bookmarks, tabId }: { group: BookmarkGroup; depth: number; groups: BookmarkGroup[]; bookmarks: Bookmark[]; tabId: number | undefined }) {
  const [open, setOpen] = useState(false)
  const children = byPosition(groups.filter((child) => child.parentId === group.id))
  const inside = byPosition(bookmarks.filter((bookmark) => bookmark.groupId === group.id))
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex h-8 w-full min-w-0 shrink-0 items-center gap-2 rounded-md pr-2 text-left text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="grid size-5 shrink-0 place-items-center">
          {open ? <FolderOpen aria-hidden size={15} strokeWidth={1.75} /> : <Folder aria-hidden size={15} strokeWidth={1.75} />}
        </span>
        <span className="min-w-0 truncate">{group.name}</span>
        <ChevronRight aria-hidden size={12} strokeWidth={1.75} className={cx('shrink-0 text-text-faint transition-transform duration-(--sc-duration-fast)', open && 'rotate-90')} />
      </button>
      {open && (
        <div role="group" aria-label={group.name} className="flex flex-col">
          {children.map((child) => (
            <FolderRow key={child.id} group={child} depth={depth + 1} groups={groups} bookmarks={bookmarks} tabId={tabId} />
          ))}
          {inside.map((bookmark) => (
            <Row key={bookmark.id} bookmark={bookmark} depth={depth + 1} tabId={tabId} />
          ))}
          {children.length + inside.length === 0 && (
            <span className="h-7 truncate text-xs leading-7 text-text-faint" style={{ paddingLeft: 36 + depth * 14 }}>
              Empty
            </span>
          )}
        </div>
      )}
    </>
  )
}

/** Whether bookmarks go down the side, and whether they show on the page in view. */
export function useVerticalBookmarks(): boolean {
  const layout = useApp((s) => s.settings.bookmarksLayout)
  const mode = useApp((s) => s.settings.bookmarksBar)
  const tab = useActiveTab()
  if (layout !== 'vertical') return false
  return mode === 'always' || (mode === 'new-tab' ? !!tab && isNewTabUrl(tab.url) : !!tab?.url.startsWith('sc://bookmarks'))
}

/**
 * Bookmarks down the side: loose ones as a grid of icons, then folders that open in place.
 * `rail` is the narrow sidebar, which only has room for the icons.
 */
export function VerticalBookmarks({ rail = false, alone = false }: { rail?: boolean; alone?: boolean }) {
  const bookmarks = useApp((s) => s.bookmarks)
  const groups = useApp((s) => s.bookmarkGroups)
  const tab = useActiveTab()
  const loose = byPosition(bookmarks.filter((bookmark) => bookmark.groupId === null))
  const folders = byPosition(groups.filter((group) => group.parentId === null))
  const host = (url: string) => (URL.canParse(url) ? new URL(url).host : url)
  const activeHost = tab ? host(tab.url) : ''

  if (rail) {
    if (loose.length === 0) return null
    return (
      <nav aria-label="Bookmarks" className="flex shrink-0 flex-col items-center gap-1 border-b border-border pb-1">
        {loose.slice(0, 8).map((bookmark) => (
          <button
            key={bookmark.id}
            type="button"
            title={bookmark.title || bookmark.url}
            aria-label={bookmark.title || bookmark.url}
            onClick={() => open(bookmark.url, tab?.id)}
            className="grid size-9 place-items-center rounded-md text-text-muted hover:bg-surface-hover"
          >
            <Icon bookmark={bookmark} size={16} />
          </button>
        ))}
      </nav>
    )
  }

  return (
    <nav aria-label="Bookmarks" className={cx('sc-scroll-quiet flex flex-col gap-1 overflow-y-auto', alone ? 'min-h-0 flex-1' : 'max-h-[45%] shrink-0 border-b border-border pb-1.5')}>
      {bookmarks.length === 0 && groups.length === 0 && <p className="px-2 py-1 text-xs text-text-faint">Press Ctrl D to bookmark a page</p>}
      {loose.length > 0 && (
        <div className="grid shrink-0 grid-cols-4 gap-1.5 p-0.5">
          {loose.map((bookmark) => (
            <Tile key={bookmark.id} bookmark={bookmark} tabId={tab?.id} active={host(bookmark.url) === activeHost} />
          ))}
        </div>
      )}
      {folders.map((group) => (
        <FolderRow key={group.id} group={group} depth={0} groups={groups} bookmarks={bookmarks} tabId={tab?.id} />
      ))}
    </nav>
  )
}

/** With tabs along the top, bookmarks down the side get a column of their own. */
export function BookmarksSidebar() {
  return (
    <aside aria-label="Bookmarks sidebar" className="flex w-60 shrink-0 flex-col gap-1 border-r border-border px-1.5 py-1.5">
      <VerticalBookmarks alone />
    </aside>
  )
}
