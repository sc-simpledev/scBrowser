import { Bookmark as BookmarkIcon, FolderPlus, Globe, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { folderTree, type Bookmark, type BookmarkGroup } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'

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
      {bookmark.icon ? (
        <img src={bookmark.icon} alt="" className="size-4 shrink-0 rounded-sm object-contain" />
      ) : (
        <Globe aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-faint" />
      )}
      <a href={bookmark.url} className="min-w-0 flex-1 truncate">
        {bookmark.title || bookmark.url}
      </a>
      <span className="min-w-0 max-w-52 truncate text-xs text-text-faint">{bookmark.url}</span>
      {groups.length > 0 && (
        <Select
          aria-label={`Folder for ${bookmark.title || bookmark.url}`}
          className="h-7 max-w-32 text-xs"
          value={bookmark.groupId ?? ''}
          onChange={(e) => void api().invoke('bookmarks:set-group', bookmark.id, e.target.value ? Number(e.target.value) : null).then(reload)}
        >
          <option value="">No folder</option>
          {folderTree(groups).map(({ group, path }) => (
            <option key={group.id} value={group.id}>
              {path}
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

/** Where a folder can move to: anywhere but inside itself. */
const folderTargets = (group: BookmarkGroup, groups: BookmarkGroup[]) => {
  const tree = folderTree(groups)
  const self = tree.find((entry) => entry.group.id === group.id)!
  return tree.filter(({ path }) => path !== self.path && !path.startsWith(`${self.path} / `))
}

function FolderHeading({ group, groups, reload }: { group: BookmarkGroup; groups: BookmarkGroup[]; reload: () => void }) {
  const [name, setName] = useState(group.name)
  const [adding, setAdding] = useState(false)
  const [child, setChild] = useState('')
  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          aria-label={`Name of folder ${group.name}`}
          className="min-w-0 flex-1 border-transparent bg-transparent font-medium"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name !== group.name) void api().invoke('bookmarks:rename-group', group.id, name.trim()).then(reload)
          }}
        />
        <Select
          aria-label={`Move folder ${group.name}`}
          className="h-7 max-w-36 text-xs"
          value={group.parentId ?? ''}
          onChange={(e) => void api().invoke('bookmarks:move-group', group.id, e.target.value ? Number(e.target.value) : null).then(reload)}
        >
          <option value="">On the bar</option>
          {folderTargets(group, groups).map(({ group: target, path }) => (
            <option key={target.id} value={target.id}>
              In {path}
            </option>
          ))}
        </Select>
        <IconButton size="sm" label={`Add a folder inside ${group.name}`} onClick={() => setAdding(!adding)}>
          <FolderPlus size={13} strokeWidth={1.75} />
        </IconButton>
        <Button variant="ghost" onClick={() => void api().invoke('bookmarks:remove-group', group.id).then(reload)}>
          Delete folder
        </Button>
      </div>
      {adding && (
        <form
          className="flex gap-2 pl-3"
          onSubmit={(e) => {
            e.preventDefault()
            void api().invoke('bookmarks:add-group', child.trim(), group.id).then(() => {
              setChild('')
              setAdding(false)
              reload()
            })
          }}
        >
          <Input autoFocus aria-label={`New folder inside ${group.name}`} placeholder="Folder name" className="min-w-0 flex-1" value={child} onChange={(e) => setChild(e.target.value)} />
          <Button type="submit" disabled={!child.trim()}>
            Add
          </Button>
        </form>
      )}
    </>
  )
}

/** A folder, then whatever's inside it, each level set in a little further. */
function FolderSection({ group, groups, bookmarks, reload }: { group: BookmarkGroup; groups: BookmarkGroup[]; bookmarks: Bookmark[]; reload: () => void }) {
  return (
    <section aria-label={group.name} className="flex flex-col gap-1">
      <FolderHeading key={group.name} group={group} groups={groups} reload={reload} />
      <div className="ml-3 flex flex-col gap-1 border-l border-border pl-3">
        <ul>
          {bookmarks
            .filter((bookmark) => bookmark.groupId === group.id)
            .map((bookmark) => (
              <BookmarkRow key={bookmark.id} bookmark={bookmark} groups={groups} reload={reload} />
            ))}
        </ul>
        {groups
          .filter((child) => child.parentId === group.id)
          .map((child) => (
            <FolderSection key={child.id} group={child} groups={groups} bookmarks={bookmarks} reload={reload} />
          ))}
      </div>
    </section>
  )
}

export function BookmarksPage() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [groups, setGroups] = useState<BookmarkGroup[]>([])
  const [newFolder, setNewFolder] = useState('')

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
            .invoke('bookmarks:add-group', newFolder.trim(), null)
            .then(() => {
              setNewFolder('')
              load()
            })
        }}
      >
        <Input aria-label="New folder name" placeholder="New folder" className="min-w-0 flex-1" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
        <Button type="submit" disabled={!newFolder.trim()}>
          Add folder
        </Button>
      </form>
      {bookmarks.length === 0 && <EmptyState icon={BookmarkIcon} title="No bookmarks yet">Press Ctrl D on any page to add one.</EmptyState>}
      {groups
        .filter((group) => group.parentId === null)
        .map((group) => (
          <FolderSection key={group.id} group={group} groups={groups} bookmarks={bookmarks} reload={load} />
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
