import { Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import type { Bookmark, BookmarkGroup } from '@scbrowser/shared'
import { api } from '../api'

function BookmarkRow({ bookmark, groups, reload }: { bookmark: Bookmark; groups: BookmarkGroup[]; reload: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [problem, setProblem] = useState(false)

  if (editing) {
    const save = () =>
      void api()
        .invoke('bookmarks:edit', bookmark.id, title, url)
        .then(() => {
          setEditing(false)
          reload()
        })
        .catch(() => setProblem(true))
    return (
      <li className="flex items-center gap-2 py-1">
        <Input autoFocus aria-label="Bookmark name" className="min-w-0 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Input aria-label="Bookmark address" className="min-w-0 flex-1" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button variant="primary" onClick={save}>
          Save
        </Button>
        <Button variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {problem && <span role="alert" className="text-xs text-danger">Check the address</span>}
      </li>
    )
  }

  return (
    <li className="group flex h-10 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
      <a href={bookmark.url} className="min-w-0 flex-1 truncate">
        {bookmark.title || bookmark.url}
      </a>
      <span className="min-w-0 max-w-52 truncate text-xs text-text-faint">{bookmark.url}</span>
      {groups.length > 0 && (
        <Select
          aria-label={`Group for ${bookmark.title || bookmark.url}`}
          className="h-7 max-w-32 text-xs"
          value={bookmark.groupId ?? ''}
          onChange={(e) => void api().invoke('bookmarks:set-group', bookmark.id, e.target.value ? Number(e.target.value) : null).then(reload)}
        >
          <option value="">No group</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </Select>
      )}
      <IconButton
        size="sm"
        label="Edit"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          setTitle(bookmark.title)
          setUrl(bookmark.url)
          setProblem(false)
          setEditing(true)
        }}
      >
        <Pencil size={12} strokeWidth={2} />
      </IconButton>
      <IconButton
        size="sm"
        label="Delete bookmark"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => void api().invoke('bookmarks:remove', bookmark.id).then(reload)}
      >
        <X size={12} strokeWidth={2} />
      </IconButton>
    </li>
  )
}

function GroupHeading({ group, reload }: { group: BookmarkGroup; reload: () => void }) {
  const [name, setName] = useState(group.name)
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={`Name of group ${group.name}`}
        className="min-w-0 flex-1 border-transparent bg-transparent font-medium"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (name.trim() && name !== group.name) void api().invoke('bookmarks:rename-group', group.id, name.trim()).then(reload)
        }}
      />
      <Button variant="ghost" onClick={() => void api().invoke('bookmarks:remove-group', group.id).then(reload)}>
        Delete group
      </Button>
    </div>
  )
}

export function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [groups, setGroups] = useState<BookmarkGroup[]>([])
  const [newGroup, setNewGroup] = useState('')

  const load = useCallback(() => {
    void api().invoke('bookmarks:list').then(setBookmarks)
    void api().invoke('bookmarks:groups').then(setGroups)
  }, [])
  useEffect(load, [load])

  const loose = bookmarks.filter((bookmark) => bookmark.groupId === null)

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void api()
            .invoke('bookmarks:add-group', newGroup.trim())
            .then(() => {
              setNewGroup('')
              load()
            })
        }}
      >
        <Input aria-label="New group name" placeholder="New group" className="min-w-0 flex-1" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
        <Button type="submit" disabled={!newGroup.trim()}>
          Add group
        </Button>
      </form>
      {bookmarks.length === 0 && <p className="text-text-muted">No bookmarks yet. Press Ctrl D on any page to add one.</p>}
      {groups.map((group) => (
        <section key={group.id} aria-label={group.name} className="flex flex-col gap-1">
          <GroupHeading group={group} reload={load} />
          <ul>
            {bookmarks
              .filter((bookmark) => bookmark.groupId === group.id)
              .map((bookmark) => (
                <BookmarkRow key={bookmark.id} bookmark={bookmark} groups={groups} reload={load} />
              ))}
          </ul>
        </section>
      ))}
      {loose.length > 0 && (
        <ul>
          {loose.map((bookmark) => (
            <BookmarkRow key={bookmark.id} bookmark={bookmark} groups={groups} reload={load} />
          ))}
        </ul>
      )}
    </div>
  )
}
