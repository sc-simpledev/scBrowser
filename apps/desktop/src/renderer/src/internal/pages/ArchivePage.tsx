import { Layers, RotateCcw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, IconButton, Input, Select } from '@scbrowser/ui'
import { ARCHIVE_CHOICES, type ArchivedTab, type ClosedGroup, type Settings } from '@scbrowser/shared'
import { api } from '../api'
import { ConfirmButton } from '../ConfirmButton'

const dayLabel = (time: number) => new Date(time).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') || url : url)
const choiceLabel = (days: number) => (days === 0 ? 'Never' : days === 1 ? 'After a day unused' : `After ${days} days unused`)

/** Named sets of the tabs open now, to open again whenever. Opening one keeps it on the list. */
function SavedTabSets() {
  const [sets, setSets] = useState<ClosedGroup[]>([])
  const [name, setName] = useState('')
  const load = useCallback(() => void api().invoke('tabsets:list').then(setSets), [])
  useEffect(load, [load])
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
          {sets.map((set) => (
            <li key={set.id} className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-surface-hover">
              <Layers aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
              <span className="min-w-0 flex-1 truncate">{set.name}</span>
              <span className="shrink-0 text-xs text-text-faint">
                {set.tabs.length} {set.tabs.length === 1 ? 'tab' : 'tabs'}
              </span>
              <Button variant="ghost" onClick={() => void api().invoke('tabsets:open', set.id)}>
                Open
              </Button>
              <IconButton size="sm" label={`Remove ${set.name}`} onClick={() => void api().invoke('tabsets:remove', set.id).then(load)}>
                <X size={13} strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
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
  const load = useCallback(() => {
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
          <div className="min-w-0">
            <div>Archive unused tabs</div>
            <div className="text-xs text-text-faint">Closes tabs you haven't looked at in a while and keeps them here. Pinned tabs, tabs playing sound and scTerra's own pages always stay.</div>
          </div>
          {after !== null && (
            <Select
              aria-label="Archive unused tabs"
              className="w-56 shrink-0"
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
      {tabs.length === 0 && <p className="text-text-muted">Nothing archived yet. Right-click a tab and pick Archive tab, or choose when unused tabs archive themselves above.</p>}
      {tabs.length > 0 && shown.length === 0 && <p className="text-text-muted">Nothing matches that search.</p>}
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
