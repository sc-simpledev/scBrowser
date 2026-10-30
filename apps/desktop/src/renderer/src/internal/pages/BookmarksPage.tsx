import { Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { IconButton, Input } from '@scbrowser/ui'
import type { Bookmark } from '@scbrowser/shared'
import { api } from '../api'

export function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [title, setTitle] = useState('')

  const load = useCallback(() => void api().invoke('bookmarks:list').then(setBookmarks), [])
  useEffect(load, [load])

  const commit = () => {
    if (editing === null) return
    const id = editing
    setEditing(null)
    void api().invoke('bookmarks:rename', id, title).then(load)
  }

  if (bookmarks.length === 0) return <p className="text-text-muted">No bookmarks yet. Press Ctrl D on any page to add one.</p>

  return (
    <ul>
      {bookmarks.map((bookmark) => (
        <li key={bookmark.id} className="group flex h-10 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
          {editing === bookmark.id ? (
            <Input
              autoFocus
              aria-label="Bookmark name"
              className="flex-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <a href={bookmark.url} className="min-w-0 flex-1 truncate">
              {bookmark.title || bookmark.url}
            </a>
          )}
          <span className="min-w-0 max-w-60 truncate text-xs text-text-faint">{bookmark.url}</span>
          <IconButton
            size="sm"
            label="Rename"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => {
              setTitle(bookmark.title)
              setEditing(bookmark.id)
            }}
          >
            <Pencil size={12} strokeWidth={2} />
          </IconButton>
          <IconButton
            size="sm"
            label="Delete bookmark"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => void api().invoke('bookmarks:remove', bookmark.id).then(load)}
          >
            <X size={12} strokeWidth={2} />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
