import { useEffect, useRef, useState } from 'react'
import { Button, cx, Input, Switch } from '@scbrowser/ui'
import { DEFAULT_WORKSPACE_SCHEDULE, WORKSPACE_POPUP, type WorkspaceEditorState, type WorkspaceSchedule } from '@scbrowser/shared'

/** Monday first, as most calendars here start the week. */
const DAYS: [number, string, string][] = [
  [1, 'M', 'Monday'],
  [2, 'T', 'Tuesday'],
  [3, 'W', 'Wednesday'],
  [4, 'T', 'Thursday'],
  [5, 'F', 'Friday'],
  [6, 'S', 'Saturday'],
  [0, 'S', 'Sunday']
]

export function WorkspaceEditor({ editor, x, y }: { editor: WorkspaceEditorState; x: number; y: number }) {
  const [name, setName] = useState(editor.name)
  const [focus, setFocus] = useState(editor.focus)
  const [scheduled, setScheduled] = useState(editor.schedule !== null)
  const [schedule, setSchedule] = useState<WorkspaceSchedule>(editor.schedule ?? DEFAULT_WORKSPACE_SCHEDULE)
  const nameRef = useRef<HTMLInputElement>(null)
  const close = () => void window.scbOverlay.invoke('overlay:workspace-close')
  useEffect(() => nameRef.current?.select(), [])
  const scheduleReady = !scheduled || (schedule.days.length > 0 && schedule.from !== schedule.to)

  return (
    <form
      role="dialog"
      aria-label={editor.id ? 'Edit workspace' : 'New workspace'}
      className="sc-glass-strong sc-tooltip absolute flex flex-col gap-3 rounded-lg p-3.5 shadow-3"
      style={{ left: x, top: y, width: WORKSPACE_POPUP.width, height: WORKSPACE_POPUP.height }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim() && scheduleReady) void window.scbOverlay.invoke('overlay:workspace-save', { id: editor.id, name, focus, schedule: scheduled ? schedule : null })
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs font-medium text-text-muted">
        Name
        <Input ref={nameRef} autoFocus maxLength={40} placeholder="Work, study, travel…" aria-label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div>Focus Mode</div>
          <div className="truncate text-xs text-text-faint">On while this workspace is open</div>
        </div>
        <Switch label="Focus Mode in this workspace" checked={focus} onChange={setFocus} />
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div>Switch to it by itself</div>
            <div className="truncate text-xs text-text-faint">At these hours, then back after</div>
          </div>
          <Switch label="Switch to this workspace on a schedule" checked={scheduled} onChange={setScheduled} />
        </div>
        <div className={cx('flex flex-col gap-2 transition-opacity', !scheduled && 'pointer-events-none opacity-40')} aria-disabled={!scheduled}>
          <div role="group" aria-label="Days" className="flex gap-1">
            {DAYS.map(([day, letter, full]) => {
              const on = schedule.days.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-label={full}
                  aria-pressed={on}
                  tabIndex={scheduled ? 0 : -1}
                  onClick={() => setSchedule({ ...schedule, days: on ? schedule.days.filter((other) => other !== day) : [...schedule.days, day] })}
                  className={cx('h-7 flex-1 rounded-md border text-xs font-medium transition-colors', on ? 'border-transparent bg-text text-surface' : 'border-border text-text-muted hover:bg-surface-hover')}
                >
                  {letter}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Input aria-label="From" type="time" tabIndex={scheduled ? 0 : -1} className="h-8 flex-1" value={schedule.from} onChange={(e) => e.target.value && setSchedule({ ...schedule, from: e.target.value })} />
            to
            <Input aria-label="To" type="time" tabIndex={scheduled ? 0 : -1} className="h-8 flex-1" value={schedule.to} onChange={(e) => e.target.value && setSchedule({ ...schedule, to: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="mt-auto flex justify-between gap-2">
        {editor.canRemove ? (
          <Button variant="ghost" onClick={() => void window.scbOverlay.invoke('overlay:workspace-remove', editor.id!)}>
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!name.trim() || !scheduleReady}>
            {editor.id ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </form>
  )
}
