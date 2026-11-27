import { Bookmark as BookmarkIcon, FolderPlus, Globe, Pencil, Sparkles, X, FileDown, FileUp } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { duplicateBookmarks, folderTree, type Bookmark, type BookmarkGroup, type LinkCheck } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState } from '../EmptyState'
import { ConfirmButton } from '../ConfirmButton'

/** An address without the parts everyone knows: the scheme, "www." and a lone trailing slash. */
const shortAddress = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

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
      <span title={bookmark.url} className="min-w-0 max-w-52 truncate text-xs text-text-faint">{shortAddress(bookmark.url)}</span>
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
  const [fileNote, setFileNote] = useState<{ text: string; error: boolean } | null>(null)

  const load = useCallback(() => {
    void api().invoke('bookmarks:list').then(setBookmarks)
    void api().invoke('bookmarks:groups').then(setGroups)
  }, [])
  useEffect(load, [load])

  const loose = bookmarks.filter((bookmark) => bookmark.groupId === null)
  const cleanError = (error: Error) => error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  // A bookmarks file is the HTML every browser saves and reads, so nothing is locked in here.
  const importFile = () =>
    void api()
      .invoke('bookmarks:import-html')
      .then(
        (added) => {
          if (added === null) return
          setFileNote({ text: added === 0 ? 'Everything in that file was already bookmarked.' : `Imported ${added} ${added === 1 ? 'bookmark' : 'bookmarks'}, in their folders.`, error: false })
          load()
        },
        (error: Error) => setFileNote({ text: cleanError(error), error: true })
      )
  const exportFile = () =>
    void api()
      .invoke('bookmarks:export-html')
      .then((saved) => saved && setFileNote({ text: 'Saved. Any browser can import that file.', error: false }), (error: Error) => setFileNote({ text: cleanError(error), error: true }))

  return (
    <div className="flex flex-col gap-6">
      {/* Folders only mean something once there are bookmarks to put in them. */}
      {(bookmarks.length > 0 || groups.length > 0) && <form
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
      </form>}
      {bookmarks.length === 0 && <EmptyState icon={BookmarkIcon} title="No bookmarks yet">
          Press <kbd className="sc-kbd">Ctrl</kbd> <kbd className="sc-kbd">D</kbd> on any page to add one, import them from another browser in Settings, or from a bookmarks file below.
        </EmptyState>}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <Button variant="ghost" onClick={importFile}>
          <FileUp aria-hidden size={13} strokeWidth={1.75} />
          Import a bookmarks file
        </Button>
        {bookmarks.length > 0 && (
          <Button variant="ghost" onClick={exportFile}>
            <FileDown aria-hidden size={13} strokeWidth={1.75} />
            Export as a file
          </Button>
        )}
        {fileNote && (
          <p role="status" className={fileNote.error ? 'px-2 text-xs text-danger' : 'px-2 text-xs text-text-muted'}>
            {fileNote.text}
          </p>
        )}
      </div>
      {bookmarks.length > 1 && <TidyUp bookmarks={bookmarks} reload={load} />}
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

/**
 * Finds bookmarks saved twice and pages that are gone, and removes them only when asked: each one,
 * or all of a kind after a second press.
 */
function TidyUp({ bookmarks, reload }: { bookmarks: Bookmark[]; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [checks, setChecks] = useState<LinkCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const duplicates = duplicateBookmarks(bookmarks)
  const extra = duplicates.flatMap((set) => set.slice(1))
  const deadUrls = new Set((checks ?? []).filter((check) => check.state === 'dead').map((check) => check.url))
  const dead = bookmarks.filter((bookmark) => deadUrls.has(bookmark.url))
  const unknown = (checks ?? []).filter((check) => check.state === 'unknown').length
  const remove = (ids: number[]) => void Promise.all(ids.map((id) => api().invoke('bookmarks:remove', id))).then(reload)
  const check = () => {
    setChecking(true)
    void api()
      .invoke('bookmarks:check-links', [...new Set(bookmarks.map((bookmark) => bookmark.url))])
      .then(setChecks, () => setChecks([]))
      .finally(() => setChecking(false))
  }
  if (!open)
    return (
      <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        <Sparkles aria-hidden size={13} strokeWidth={1.75} />
        Tidy up: find duplicates and dead links
      </Button>
    )
  const row = (bookmark: Bookmark, note: string) => (
    <li key={bookmark.id} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
      <a href={bookmark.url} className="min-w-0 flex-1 truncate">
        {bookmark.title || bookmark.url}
      </a>
      <span className="min-w-0 max-w-64 truncate text-xs text-text-faint">{note}</span>
      <Button variant="ghost" className="h-7 px-2" onClick={() => remove([bookmark.id])}>
        Remove
      </Button>
    </li>
  )
  return (
    <section aria-label="Tidy up bookmarks" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Tidy up</h2>
          <p className="text-xs text-text-faint">Nothing is removed until you press Remove.</p>
        </div>
        <IconButton size="sm" label="Close tidy up" onClick={() => setOpen(false)}>
          <X size={13} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm">Saved more than once</h3>
          {extra.length > 1 && (
            <ConfirmButton variant="ghost" confirmLabel={`Remove ${extra.length}?`} onConfirm={() => remove(extra.map((bookmark) => bookmark.id))}>
              Remove all {extra.length} copies
            </ConfirmButton>
          )}
        </div>
        {extra.length === 0 ? <p className="text-xs text-text-muted">No duplicates.</p> : <ul>{extra.map((bookmark) => row(bookmark, 'A copy; the first one stays'))}</ul>}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm">Pages that are gone</h3>
          {checks === null ? (
            <Button disabled={checking} onClick={check}>
              {checking ? 'Checking…' : `Check ${bookmarks.length} links`}
            </Button>
          ) : (
            dead.length > 1 && (
              <ConfirmButton variant="ghost" confirmLabel={`Remove ${dead.length}?`} onConfirm={() => remove(dead.map((bookmark) => bookmark.id))}>
                Remove all {dead.length}
              </ConfirmButton>
            )
          )}
        </div>
        {checks === null ? (
          <p className="text-xs text-text-muted">Asks each site whether the page is still there. Sites see a visit from scTerra, without your sign-ins.</p>
        ) : dead.length === 0 ? (
          <p role="status" className="text-xs text-text-muted">Every page answered{unknown > 0 ? `, apart from ${unknown} that didn’t reply in time, so they’re left alone` : ''}.</p>
        ) : (
          <ul aria-label="Pages that are gone">{dead.map((bookmark) => row(bookmark, (checks.find((one) => one.url === bookmark.url)?.status ?? 0) ? `Answered ${checks.find((one) => one.url === bookmark.url)!.status}` : 'The site no longer exists'))}</ul>
        )}
      </div>
    </section>
  )
}
