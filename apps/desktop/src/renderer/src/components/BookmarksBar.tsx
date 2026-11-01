import { ChevronDown, Folder, Globe } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { barItems, isNewTabUrl, type BarItem, type Bookmark, type BookmarkGroup } from '@scbrowser/shared'
import { cx } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useActiveTab } from '../state/tabs'

const itemClass = 'flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text'

const same = (a: BarItem | null, b: BarItem) => a?.kind === b.kind && a.id === b.id

export function BookmarksBar() {
  const mode = useApp((s) => s.settings.bookmarksBar)
  const bookmarks = useApp((s) => s.bookmarks)
  const groups = useApp((s) => s.bookmarkGroups)
  const tab = useActiveTab()
  const [dragging, setDragging] = useState<BarItem | null>(null)
  const [target, setTarget] = useState<{ item: BarItem; into: boolean } | null>(null)

  const visible =
    mode === 'always' || (mode === 'new-tab' ? !!tab && isNewTabUrl(tab.url) : !!tab?.url.startsWith('sc://bookmarks'))
  if (!visible) return null

  const items = barItems(bookmarks, groups)

  const drop = () => {
    const moved = dragging
    const over = target
    setDragging(null)
    setTarget(null)
    if (!moved || !over || same(moved, over.item)) return
    if (over.into && moved.kind === 'bookmark') {
      void window.scb.invoke('bookmarks:set-group', moved.id, over.item.id)
      return
    }
    const order: BarItem[] = items.map(({ kind, item }) => ({ kind, id: item.id })).filter((item) => !same(moved, item))
    order.splice(order.findIndex((item) => same(over.item, item)), 0, moved)
    void window.scb.invoke('bookmarks:arrange', order)
  }

  const dragProps = (item: BarItem) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      setDragging(item)
    },
    onDragEnd: () => {
      setDragging(null)
      setTarget(null)
    },
    onDragOver: (e: DragEvent) => {
      if (!dragging) return
      e.preventDefault()
      // The middle of a group takes the bookmark in; its left edge places it beside the group.
      const box = e.currentTarget.getBoundingClientRect()
      const into = item.kind === 'group' && dragging.kind === 'bookmark' && e.clientX > box.left + box.width / 4
      setTarget({ item, into })
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      drop()
    }
  })

  const highlight = (item: BarItem) => same(target?.item ?? null, item) && !same(dragging, item) && (target!.into ? 'bg-accent-soft' : 'shadow-[inset_2px_0_0_var(--sc-accent)]')

  const bookmarkButton = (bookmark: Bookmark) => {
    const item: BarItem = { kind: 'bookmark', id: bookmark.id }
    return (
      <button
        key={`bookmark-${bookmark.id}`}
        type="button"
        title={bookmark.url}
        {...dragProps(item)}
        onClick={() => tab && void window.scb.invoke('tabs:navigate', tab.id, bookmark.url)}
        onAuxClick={(e) => {
          if (e.button === 1) void window.scb.invoke('tabs:open-in-background', bookmark.url)
        }}
        onContextMenu={() => void window.scb.invoke('bookmarks:context-menu', bookmark.id)}
        className={cx(itemClass, highlight(item))}
      >
        <Globe aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <span className="truncate">{bookmark.title || bookmark.url}</span>
      </button>
    )
  }

  const groupButton = (group: BookmarkGroup) => {
    const item: BarItem = { kind: 'group', id: group.id }
    return (
      <button
        key={`group-${group.id}`}
        type="button"
        aria-haspopup="menu"
        {...dragProps(item)}
        onClick={(e) => {
          const { left, bottom } = e.currentTarget.getBoundingClientRect()
          void window.scb.invoke('bookmarks:group-menu', group.id, left, bottom)
        }}
        className={cx(itemClass, highlight(item))}
      >
        <Folder aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <span className="truncate">{group.name}</span>
        <ChevronDown aria-hidden size={11} strokeWidth={1.75} className="shrink-0 text-text-faint" />
      </button>
    )
  }

  return (
    <div role="toolbar" aria-label="Bookmarks" className="flex h-8 shrink-0 items-center gap-0.5 overflow-hidden px-1.5 pb-1">
      {items.length === 0 && <span className="px-2 text-xs text-text-faint">Press Ctrl D to bookmark a page</span>}
      {items.map((entry) => (entry.kind === 'group' ? groupButton(entry.item) : bookmarkButton(entry.item)))}
    </div>
  )
}
