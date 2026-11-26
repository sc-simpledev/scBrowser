import { AlarmClock, Archive, CalendarClock, Layers, RotateCcw, X, Columns2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, cx, IconButton, Input, Select } from '@scbrowser/ui'
import { ARCHIVE_CHOICES, MAX_ROUTINES, routineLabel, type ArchivedTab, type ClosedGroup, type Routine, type Settings, type SnoozedTab } from '@scbrowser/shared'
import { api } from '../api'
import { EmptyState, NoMatches } from '../EmptyState'
import { ConfirmButton } from '../ConfirmButton'

const dayLabel = (time: number) => new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') || url : url)
const choiceLabel = (days: number) => (days === 0 ? 'Never' : days === 1 ? 'After a day unused' : `After ${days} days unused`)

const DAYS = [
  { day: 1, label: 'M', name: 'Monday' },
  { day: 2, label: 'T', name: 'Tuesday' },
  { day: 3, label: 'W', name: 'Wednesday' },
  { day: 4, label: 'T', name: 'Thursday' },
  { day: 5, label: 'F', name: 'Friday' },
  { day: 6, label: 'S', name: 'Saturday' },
  { day: 0, label: 'S', name: 'Sunday' }
]

/** When a tab set opens by itself: days, a time, and the workspace to open it in. */
function RoutineEditor({ routine, workspaces, onSave, onRemove, onClose }: { routine: Routine | null; workspaces: { id: string; name: string }[]; onSave: (routine: Pick<Routine, 'days' | 'time' | 'workspace'>) => void; onRemove: () => void; onClose: () => void }) {
  const [days, setDays] = useState<number[]>(routine?.days ?? [1, 2, 3, 4, 5])
  const [time, setTime] = useState(routine?.time ?? '09:00')
  const [workspace, setWorkspace] = useState<string | null>(routine?.workspace ?? null)
  return (
    <div className="ml-6 flex flex-col gap-2.5 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="Days" className="flex gap-1">
          {DAYS.map(({ day, label, name }) => (
            <button
              key={day}
              type="button"
              aria-pressed={days.includes(day)}
              aria-label={name}
              title={name}
              onClick={() => setDays(days.includes(day) ? days.filter((one) => one !== day) : [...days, day])}
              className={days.includes(day) ? 'grid size-7 place-items-center rounded-md bg-text text-xs font-medium text-surface' : 'grid size-7 place-items-center rounded-md border border-border text-xs text-text-muted hover:text-text'}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-text-muted">
          at
          <Input type="time" aria-label="Time" className="w-28" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        {workspaces.length > 1 && (
          <label className="flex items-center gap-1.5 text-text-muted">
            in
            <Select aria-label="Workspace" className="w-36" value={workspace ?? ''} onChange={(e) => setWorkspace(e.target.value || null)}>
              <option value="">Whichever is open</option>
              {workspaces.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <p className="text-xs text-text-faint">It opens once a day at that time while scTerra is open, or when you open scTerra within three hours of it.</p>
      <div className="flex justify-end gap-2">
        {routine && (
          <Button variant="ghost" className="mr-auto" onClick={onRemove}>
            Stop opening it
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={days.length === 0 || !/^\d\d:\d\d$/.test(time)} onClick={() => onSave({ days: [...days].sort(), time, workspace })}>
          Save
        </Button>
      </div>
    </div>
  )
}

/** Named sets of the tabs open now, to open again whenever. Opening one keeps it on the list. */
function SavedTabSets() {
  const [sets, setSets] = useState<ClosedGroup[]>([])
  const [name, setName] = useState('')
  const [routines, setRoutines] = useState<Routine[]>([])
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const load = useCallback(() => {
    void api().invoke('tabsets:list').then(setSets)
    void api().invoke('settings:get').then((settings) => setRoutines(settings.routines))
    void api().invoke('workspaces:list').then(setWorkspaces)
  }, [])
  useEffect(load, [load])
  const saveRoutines = (next: Routine[]) => {
    setRoutines(next)
    void api().invoke('settings:set', { routines: next })
  }
  return (
    <section aria-label="Saved tab sets" className="flex flex-col gap-3 rounded-lg bg-surface p-4 shadow-1">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          void api().invoke('tabsets:save', name).then(load)
          setName('')
        }}
      >
        <Input aria-label="Name for this set of tabs" className="min-w-0 flex-1" maxLength={80} placeholder="Save the open tabs as…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>
          Save
        </Button>
      </form>
      {sets.length > 0 && (
        <ul className="flex flex-col">
          {sets.map((set) => {
            const routine = routines.find((one) => one.setId === set.id) ?? null
            const where = routine?.workspace ? workspaces.find((one) => one.id === routine.workspace)?.name : null
            return (
              <li key={set.id} className="flex flex-col gap-1.5">
                <div className={cx('flex items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover', routine ? 'min-h-11 py-1' : 'h-9')}>
                  {set.split ? <Columns2 aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" /> : <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{set.name}</span>
                    {routine && (
                      <span className="truncate text-xs text-text-faint">
                        Opens {routineLabel(routine).replace(/^(Every day|Weekends)/, (words) => words.toLowerCase())}
                        {where ? ` in ${where}` : ''}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-text-faint">{set.split ? 'Split view' : `${set.tabs.length} ${set.tabs.length === 1 ? 'tab' : 'tabs'}`}</span>
                  <IconButton size="sm" label={routine ? `Change when ${set.name} opens` : `Set a timetable for ${set.name}`} className={routine ? 'text-accent' : undefined} onClick={() => setEditing(editing === set.id ? null : set.id)}>
                    <CalendarClock size={13} strokeWidth={1.75} />
                  </IconButton>
                  <Button variant="ghost" onClick={() => void api().invoke('tabsets:open', set.id)}>
                    Open
                  </Button>
                  <IconButton size="sm" label={`Remove ${set.name}`} onClick={() => void api().invoke('tabsets:remove', set.id).then(load)}>
                    <X size={13} strokeWidth={1.75} />
                  </IconButton>
                </div>
                {editing === set.id && (
                  <RoutineEditor
                    routine={routine}
                    workspaces={workspaces}
                    onClose={() => setEditing(null)}
                    onRemove={() => {
                      saveRoutines(routines.filter((one) => one.setId !== set.id))
                      setEditing(null)
                    }}
                    onSave={(chosen) => {
                      saveRoutines([...routines.filter((one) => one.setId !== set.id), { setId: set.id, ...chosen, lastRun: routine?.lastRun ?? null }].slice(-MAX_ROUTINES))
                      setEditing(null)
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** Tabs closed after going unused, or by hand, to bring back. */
export function ArchivePage() {
  const [tabs, setTabs] = useState<ArchivedTab[]>([])
  const [query, setQuery] = useState('')
  const [after, setAfter] = useState<Settings['archiveAfterDays'] | null>(null)
  const [groups, setGroups] = useState<ClosedGroup[]>([])
  const [snoozed, setSnoozed] = useState<SnoozedTab[]>([])
  const load = useCallback(() => {
    void api().invoke('snooze:list').then(setSnoozed)
    void api().invoke('archive:list').then(setTabs)
    void api().invoke('groups:closed').then(setGroups)
  }, [])
  useEffect(() => {
    load()
    void api().invoke('settings:get').then((settings) => setAfter(settings.archiveAfterDays))
    // Tabs are archived in the background, so it looks again when the page comes back into view.
    const refresh = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [load])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? tabs.filter((tab) => `${tab.title} ${tab.url}`.toLowerCase().includes(needle)) : tabs
  }, [tabs, query])
  const days = Map.groupBy(shown, (tab) => dayLabel(tab.archivedAt))

  return (
    <>
      <SavedTabSets />
      <section aria-label="Archive options" className="flex flex-col gap-2 rounded-lg bg-surface p-4 shadow-1">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div>Archive unused tabs</div>
            <div className="text-xs text-text-faint">Closes tabs you haven't looked at in a while and keeps them here. Pinned tabs, tabs playing sound and scTerra's own pages always stay.</div>
          </div>
          {after !== null && (
            <Select
              aria-label="Archive unused tabs"
              className="w-48 shrink-0"
              value={after}
              onChange={(e) => {
                const archiveAfterDays = Number(e.target.value) as Settings['archiveAfterDays']
                setAfter(archiveAfterDays)
                void api().invoke('settings:set', { archiveAfterDays })
              }}
            >
              {ARCHIVE_CHOICES.map((days) => (
                <option key={days} value={days}>
                  {choiceLabel(days)}
                </option>
              ))}
            </Select>
          )}
        </div>
      </section>
      {snoozed.length > 0 && (
        <section aria-label="Snoozed tabs" className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-text-muted">Snoozed tabs</h2>
          <ul>
            {snoozed.map((tab) => (
              <li key={tab.id} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
                <AlarmClock aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                <button type="button" className="min-w-0 flex-1 truncate text-left" title={tab.url} onClick={() => void api().invoke('snooze:wake', tab.id).then(load)}>
                  {tab.title || hostOf(tab.url)}
                </button>
                <span className="shrink-0 text-xs text-text-faint">{tab.wakeHost ? `Back when you open ${tab.wakeHost}` : `Back ${new Date(tab.wakeAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}{tab.group ? ` · into ${tab.group}` : ''}</span>
                <Button variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('snooze:wake', tab.id).then(load)}>
                  Open now
                </Button>
                <IconButton size="sm" label={`Forget ${tab.title || hostOf(tab.url)}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('snooze:remove', tab.id).then(load)}>
                  <X size={12} strokeWidth={2} />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.length > 0 && (
        <section aria-label="Closed tab groups" className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-text-muted">Closed tab groups</h2>
          <ul>
            {groups.map((group) => (
              <li key={group.id} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
                <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
                <button type="button" className="min-w-0 flex-1 truncate text-left" title={group.tabs.map((tab) => tab.title || tab.url).join('\n')} onClick={() => void api().invoke('groups:reopen', group.id).then(load)}>
                  {group.name}
                </button>
                <span className="shrink-0 text-xs text-text-faint">
                  {group.tabs.length} {group.tabs.length === 1 ? 'tab' : 'tabs'} · {new Date(group.closedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </span>
                <Button variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('groups:reopen', group.id).then(load)}>
                  <RotateCcw aria-hidden size={12} strokeWidth={1.75} />
                  Reopen
                </Button>
                <IconButton size="sm" label="Forget this group" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('groups:forget', group.id).then(load)}>
                  <X size={12} strokeWidth={2} />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex gap-2">
        <Input aria-label="Search archived tabs" placeholder="Search archived tabs" className="flex-1" value={query} onChange={(e) => setQuery(e.target.value)} />
        <ConfirmButton disabled={tabs.length === 0} confirmLabel="Clear the archive?" onConfirm={() => void api().invoke('archive:clear').then(load)}>
          Clear all
        </ConfirmButton>
      </div>
      {tabs.length === 0 && <EmptyState icon={Archive} title="Nothing archived yet">Right-click a tab and pick Archive tab, or choose above when unused tabs archive themselves.</EmptyState>}
      {tabs.length > 0 && shown.length === 0 && <NoMatches />}
      {[...days].map(([day, entries]) => (
        <section key={day} aria-label={day} className="flex flex-col gap-1">
          <h2 className="text-xs font-medium text-text-muted">{day}</h2>
          <ul>
            {entries.map((tab) => (
              <li key={tab.id} className="group flex h-9 items-center gap-3 rounded-md px-2 hover:bg-surface-hover">
                <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => void api().invoke('archive:restore', tab.id).then(load)}>
                  {tab.title || tab.url}
                </button>
                <span className="min-w-0 max-w-60 truncate text-xs text-text-faint">{hostOf(tab.url)}</span>
                <Button variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('archive:restore', tab.id).then(load)}>
                  <RotateCcw aria-hidden size={12} strokeWidth={1.75} />
                  Reopen
                </Button>
                <IconButton size="sm" label="Remove from archive" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => void api().invoke('archive:remove', tab.id).then(load)}>
                  <X size={12} strokeWidth={2} />
                </IconButton>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
