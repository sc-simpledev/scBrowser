import { Archive, ArchiveRestore, ChevronRight, Pencil, Pin, PinOff, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button, cx, IconButton } from '@scbrowser/ui'
import { isCodeChat, type ChatSummary } from '@scbrowser/shared'
import { api } from '../api'

const folderName = (path: string | undefined) => (path ? (path.split(/[\\/]/).filter(Boolean).at(-1) ?? path) : 'No folder')

const ago = (time: number) => {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days} d` : new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Which sessions are working, and which wait for an answer, looked at again every few seconds and on every event. */
function useActivity(): { running: Set<string>; waiting: Set<string> } {
  const [activity, setActivity] = useState({ running: new Set<string>(), waiting: new Set<string>() })
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => void api().invoke('coder:activity').then(({ running, waiting }) => setActivity({ running: new Set(running), waiting: new Set(waiting) }), () => undefined)
    const soon = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        load()
      }, 300)
    }
    load()
    const every = setInterval(load, 4000)
    const off = window.scbInternal.onCoderEvent((event) => (event.type === 'approval' || event.type === 'done' || event.type === 'error' || event.type === 'thinking') && soon())
    return () => {
      clearInterval(every)
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])
  return activity
}

function SessionRow({ chat, current, running, waiting, onFlag, onDelete }: { chat: ChatSummary; current: boolean; running: boolean; waiting: boolean; onFlag: (flags: { pinned?: boolean; archived?: boolean; name?: string | null }) => void; onDelete: () => void }) {
  const [renaming, setRenaming] = useState(false)
  if (renaming)
    return (
      <li className="flex items-center rounded-md bg-surface-active px-1 py-0.5">
        <input
          aria-label="Session name"
          autoFocus
          defaultValue={chat.name ?? chat.title}
          maxLength={80}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            setRenaming(false)
            const next = e.currentTarget.value.trim()
            if (next !== (chat.name ?? chat.title)) onFlag({ name: next || null })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              e.currentTarget.value = chat.name ?? chat.title
              e.currentTarget.blur()
            }
          }}
          className="h-6.5 min-w-0 flex-1 rounded-sm border border-border-strong bg-field px-1.5 text-sm outline-none"
        />
      </li>
    )
  return (
    <li className={cx('group relative flex items-center rounded-md transition-colors', current ? 'bg-surface-active' : 'hover:bg-surface-hover')}>
      <a
        href={`sc://assistant/?chat=${encodeURIComponent(chat.id)}`}
        aria-current={current ? 'page' : undefined}
        title={chat.title}
        className={cx('flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 pl-2', current ? 'font-medium text-text' : 'text-text-muted')}
      >
        <span className="grid size-3 shrink-0 place-items-center">
          {waiting ? (
            <span role="img" aria-label="Needs you" title="Waiting for your answer" className="size-2 rounded-full bg-accent ring-2 ring-accent-soft" />
          ) : running ? (
            <span role="img" aria-label="Working" title="Working" className="size-1.5 animate-pulse rounded-full bg-accent" />
          ) : chat.pinned ? (
            <Pin aria-label="Pinned" size={10} strokeWidth={2} className="text-text-faint" />
          ) : (
            <span aria-hidden className="size-1 rounded-full bg-border-strong" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
        <span className={cx('shrink-0 text-2xs tabular-nums group-hover:invisible group-focus-within:invisible', waiting ? 'font-medium text-accent' : 'text-text-faint')}>{waiting ? 'Needs you' : ago(chat.updatedAt)}</span>
      </a>
      <span className="absolute right-1 flex items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton size="sm" label="Rename" className="size-5!" onClick={() => setRenaming(true)}>
          <Pencil size={11} strokeWidth={1.75} />
        </IconButton>
        <IconButton size="sm" label={chat.pinned ? 'Unpin' : 'Pin'} className="size-5!" onClick={() => onFlag({ pinned: !chat.pinned })}>
          {chat.pinned ? <PinOff size={11} strokeWidth={1.75} /> : <Pin size={11} strokeWidth={1.75} />}
        </IconButton>
        <IconButton size="sm" label={chat.archived ? 'Bring back' : 'Archive'} className="size-5!" onClick={() => onFlag({ archived: !chat.archived, pinned: false })}>
          {chat.archived ? <ArchiveRestore size={11} strokeWidth={1.75} /> : <Archive size={11} strokeWidth={1.75} />}
        </IconButton>
        <IconButton size="sm" label="Delete chat" className="size-5!" onClick={onDelete}>
          <Trash2 size={11} strokeWidth={1.75} />
        </IconButton>
      </span>
    </li>
  )
}

/**
 * Terra Code's sessions, as in Claude's Code tab: grouped by project, the ones that are working or
 * waiting for an answer marked, with search, pinning and an archive for ones done with.
 */
export function CodeSessions({ chats, current, onDelete, onChanged }: { chats: ChatSummary[]; current: string | null; onDelete: (id: string) => void; onChanged: () => void }) {
  const { running, waiting } = useActivity()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const flag = (id: string, flags: { pinned?: boolean; archived?: boolean; name?: string | null }) => void api().invoke('chats:flag', id, flags).then(onChanged)

  const sessions = useMemo(() => {
    const wanted = query.trim().toLowerCase()
    return chats.filter((chat) => isCodeChat(chat.id) && (!wanted || chat.title.toLowerCase().includes(wanted) || folderName(chat.folder).toLowerCase().includes(wanted)))
  }, [chats, query])
  const live = sessions.filter((chat) => !chat.archived)
  const archived = sessions.filter((chat) => chat.archived)
  const pinned = live.filter((chat) => chat.pinned)
  // Projects in the order they were last worked in.
  const groups = useMemo(() => {
    const byFolder = new Map<string, ChatSummary[]>()
    for (const chat of live.filter((candidate) => !candidate.pinned)) byFolder.set(chat.folder ?? '', [...(byFolder.get(chat.folder ?? '') ?? []), chat])
    return [...byFolder]
  }, [live])

  const row = (chat: ChatSummary) => <SessionRow key={chat.id} chat={chat} current={chat.id === current} running={running.has(chat.id)} waiting={waiting.has(chat.id)} onFlag={(flags) => flag(chat.id, flags)} onDelete={() => onDelete(chat.id)} />
  const toggleGroup = (folder: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })

  return (
    <div className="flex w-60 shrink-0 flex-col gap-2 border-r border-border bg-bg p-3 text-sm">
      <nav aria-label="Saved chats" className="flex min-h-0 flex-1 flex-col gap-2">
        <Button onClick={() => (location.href = 'sc://assistant/?mode=code')}>
          <Plus aria-hidden size={14} strokeWidth={1.75} />
          New session
        </Button>
        <label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-field px-2 focus-within:border-border-strong">
          <Search aria-hidden size={12} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          <input aria-label="Search sessions" value={query} placeholder="Search sessions" onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-text-faint" />
        </label>
        <div className="sc-scroll-quiet flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {sessions.length === 0 && <p className="px-2 py-1.5 text-xs text-text-faint">{query ? 'No sessions match.' : 'Your Terra Code sessions will appear here.'}</p>}
          {pinned.length > 0 && (
            <section aria-label="Pinned">
              <h3 className="px-2 pb-1 text-2xs font-medium text-text-faint">Pinned</h3>
              <ul className="flex flex-col gap-0.5">{pinned.map(row)}</ul>
            </section>
          )}
          {groups.map(([folder, list]) => (
            <section key={folder} aria-label={folderName(folder)}>
              <button type="button" aria-expanded={!folded.has(folder)} onClick={() => toggleGroup(folder)} title={folder || undefined} className="flex w-full items-center gap-1 px-2 pb-1 text-left text-2xs font-medium text-text-faint hover:text-text-muted">
                <ChevronRight aria-hidden size={10} strokeWidth={2} className={cx('shrink-0 transition-transform', !folded.has(folder) && 'rotate-90')} />
                <span className="min-w-0 flex-1 truncate">{folderName(folder)}</span>
                {list.some((chat) => waiting.has(chat.id) || running.has(chat.id)) && folded.has(folder) && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
              </button>
              {!folded.has(folder) && <ul className="flex flex-col gap-0.5">{list.map(row)}</ul>}
            </section>
          ))}
          {archived.length > 0 && (
            <section aria-label="Archived">
              <button type="button" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)} className="flex w-full items-center gap-1 px-2 pb-1 text-left text-2xs font-medium text-text-faint hover:text-text-muted">
                <ChevronRight aria-hidden size={10} strokeWidth={2} className={cx('shrink-0 transition-transform', showArchived && 'rotate-90')} />
                Archived
                <span className="tabular-nums">{archived.length}</span>
              </button>
              {showArchived && <ul className="flex flex-col gap-0.5">{archived.map(row)}</ul>}
            </section>
          )}
        </div>
      </nav>
      <a href="sc://settings/" className="flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
        <Settings aria-hidden size={14} strokeWidth={1.75} />
        Settings
      </a>
    </div>
  )
}
