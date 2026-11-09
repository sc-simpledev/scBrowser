import { ChevronDown, Ellipsis, Folder, Globe } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { barItems, isNewTabUrl, type BarItem, type Bookmark, type BookmarkGroup } from '@scbrowser/shared'
import { cx, IconButton } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useActiveTab } from '../state/tabs'

const itemClass = 'flex h-6 max-w-44 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text'

/** Room kept at the end of the bar for the button that holds what doesn't fit. */
const MORE_WIDTH = 32

const same = (a: BarItem | null, b: BarItem) => a?.kind === b.kind && a.id === b.id

export function BookmarksBar() {
  const mode = useApp((s) => s.settings.bookmarksBar)
  const bookmarks = useApp((s) => s.bookmarks)
  const groups = useApp((s) => s.bookmarkGroups)
  const tab = useActiveTab()
  const [dragging, setDragging] = useState<BarItem | null>(null)
  const [target, setTarget] = useState<{ item: BarItem; into: boolean } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(Infinity)

  // Everything stays laid out, with the extra items invisible, so they can always be measured.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const measure = () => {
      const children = [...row.children] as HTMLElement[]
      const end = (element: HTMLElement | undefined) => (element ? element.offsetLeft - row.offsetLeft + element.offsetWidth : 0)
      if (end(children.at(-1)) <= row.clientWidth) return setFits(Infinity)
      const count = children.findIndex((child) => end(child) > row.clientWidth - MORE_WIDTH)
      setFits(count === -1 ? children.length : count)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    measure()
    return () => observer.disconnect()
  })

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
    if (over.into) {
      void window.scb.invoke(moved.kind === 'bookmark' ? 'bookmarks:set-group' : 'bookmarks:move-group', moved.id, over.item.id)
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
      // The middle of a folder takes the item in; its left edge places it beside the folder.
      const box = e.currentTarget.getBoundingClientRect()
      const into = item.kind === 'group' && e.clientX > box.left + box.width / 4
      setTarget({ item, into })
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      drop()
    }
  })

  const highlight = (item: BarItem) => same(target?.item ?? null, item) && !same(dragging, item) && (target!.into ? 'bg-accent-soft' : 'shadow-[inset_2px_0_0_var(--sc-accent)]')

  const hiddenItems = items.slice(fits).map(({ kind, item }) => ({ kind, id: item.id }))
  const overflowed = (item: BarItem) => hiddenItems.some((hidden) => same(hidden, item))

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
        className={cx(itemClass, highlight(item), overflowed(item) && 'invisible')}
      >
        {bookmark.icon ? (
          <img src={bookmark.icon} alt="" draggable={false} className="size-3.5 shrink-0 rounded-sm object-contain" />
        ) : (
          <Globe aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        )}
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
        className={cx(itemClass, highlight(item), overflowed(item) && 'invisible')}
      >
        <Folder aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
        <span className="truncate">{group.name}</span>
        <ChevronDown aria-hidden size={11} strokeWidth={1.75} className="shrink-0 text-text-faint" />
      </button>
    )
  }

  // No row of its own until there's something to put in it.
  if (items.length === 0) return null

  return (
    <div role="toolbar" aria-label="Bookmarks" className="relative flex h-8 shrink-0 items-center px-1.5 pb-1">
      <div ref={rowRef} className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
        {items.map((entry) => (entry.kind === 'group' ? groupButton(entry.item) : bookmarkButton(entry.item)))}
      </div>
      {hiddenItems.length > 0 && (
        <IconButton
          size="sm"
          label="More bookmarks"
          className="absolute right-1.5"
          onClick={(e) => {
            const { left, bottom } = e.currentTarget.getBoundingClientRect()
            void window.scb.invoke('bookmarks:overflow-menu', hiddenItems, left, bottom)
          }}
        >
          <Ellipsis size={14} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  )
}
