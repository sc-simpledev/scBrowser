import { ExternalLink, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, IconButton, Select } from '@scbrowser/ui'
import { scheduleCron, type CoderAutomations, type CoderSchedule } from '@scbrowser/shared'
import { api } from '../api'
import { SwitchRow } from './PanelSettings'

const cleanError = (message: string) => message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const EVERY = [
  ['day', 'Every day'],
  ['weekday', 'Every weekday'],
  ['week', 'Every Monday'],
  ['month', 'Every month']
] as const

export type AutomationsState = { repo: string | null; saved: CoderAutomations | null; prUrl: string | null }

/**
 * Terra Code on GitHub by itself: started by an @terra comment, or on a timetable. Installed
 * through a pull request the person merges, so nothing changes their branch without them.
 */
export function AutomationsSettings({ canAct, onState }: { canAct: boolean; onState?: (state: AutomationsState) => void }) {
  const [state, setState] = useState<AutomationsState | null>(null)
  const [comments, setComments] = useState(true)
  const [schedules, setSchedules] = useState<CoderSchedule[]>([])
  const [adding, setAdding] = useState(false)
  const [task, setTask] = useState('')
  const [every, setEvery] = useState<(typeof EVERY)[number][0]>('week')
  const [hour, setHour] = useState(9)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api()
      .invoke('coder:automations')
      .then((found) => {
        setState(found)
        onState?.(found)
        if (found.saved) {
          setComments(found.saved.comments)
          setSchedules(found.saved.schedules)
        }
      })
  }, [onState])
  if (!state) return null
  if (!state.repo) return <p className="text-2xs text-text-faint">This project isn’t on GitHub, so there’s nothing to install it on.</p>
  const add = () => {
    const words = task.trim()
    if (!words) return
    const { cron, label } = scheduleCron(every, hour, new Date().getTimezoneOffset())
    setSchedules([...schedules, { cron, label, task: words, pr: true }])
    setTask('')
    setAdding(false)
  }
  const install = () => {
    setBusy(true)
    setError(null)
    void api()
      .invoke('coder:automations-install', { comments, schedules })
      .then(
        (prUrl) => {
          const next = { ...state, saved: { comments, schedules }, prUrl }
          setState(next)
          onState?.(next)
        },
        (failure: Error) => setError(cleanError(failure.message))
      )
      .finally(() => setBusy(false))
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-text-faint">Terra Code works on {state.repo} in GitHub Actions by itself, and opens pull requests. It’s added through a pull request you merge.</p>
      <SwitchRow label="Start from @terra comments" hint="On issues and pull requests, by people who can push" checked={comments} onChange={setComments} />
      <div className="flex flex-col gap-1">
        <span className="text-xs">Scheduled tasks</span>
        {schedules.length === 0 && !adding && <span className="text-2xs text-text-faint">None yet, such as “update dependencies” every Monday.</span>}
        <ul className="flex flex-col">
          {schedules.map((one, index) => (
            <li key={index} className="group -mx-1 flex min-w-0 items-start gap-2 rounded-md px-1 py-1 hover:bg-surface-hover">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs">{one.task}</span>
                <span className="text-2xs text-text-faint">{one.label}</span>
              </span>
              <IconButton size="sm" label={`Remove ${one.task}`} className="size-5! opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setSchedules(schedules.filter((_, at) => at !== index))}>
                <X size={11} strokeWidth={1.75} />
              </IconButton>
            </li>
          ))}
        </ul>
        {adding ? (
          <div role="group" aria-label="New scheduled task" className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
            <textarea autoFocus aria-label="Task" rows={2} value={task} placeholder="Update dependencies that are safe to move, and fix what breaks" onChange={(event) => setTask(event.target.value)} className="resize-none rounded-md border border-border bg-field px-2 py-1.5 text-xs outline-none placeholder:text-text-faint focus:border-border-strong" />
            <div className="flex gap-1">
              <Select aria-label="How often" value={every} onChange={(event) => setEvery(event.target.value as typeof every)} className="h-7 min-w-0 flex-1 text-xs">
                {EVERY.map(([id, words]) => (
                  <option key={id} value={id}>
                    {words}
                  </option>
                ))}
              </Select>
              <Select aria-label="At" value={hour} onChange={(event) => setHour(Number(event.target.value))} className="h-7 w-22 text-xs">
                {Array.from({ length: 24 }, (_, at) => (
                  <option key={at} value={at}>
                    {at}:00
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!task.trim()} onClick={add}>
                Add
              </Button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="-mx-1 flex h-6 w-fit items-center gap-1.5 rounded-md px-1 text-xs text-text-faint transition-colors hover:bg-surface-hover hover:text-text">
            <Plus aria-hidden size={13} strokeWidth={1.5} />
            Add a scheduled task
          </button>
        )}
      </div>
      {!canAct && <p className="text-2xs text-text-muted">Choose Look and act for GitHub above to install this.</p>}
      {error && <p className="text-2xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="primary" disabled={busy || !canAct || (!comments && schedules.length === 0)} onClick={install}>
          {busy ? 'Opening a pull request…' : state.saved ? 'Update on GitHub' : 'Install on GitHub'}
        </Button>
        {state.prUrl && (
          <Button variant="ghost" onClick={() => void api().invoke('browser:open', state.prUrl!)}>
            Its pull request
            <ExternalLink aria-hidden size={11} strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </div>
  )
}
