import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'
import { cx } from '@scbrowser/ui'
import { useApp } from '../state/app'

/** Folds a group down to its name, or opens it again. */
export function toggleGroup(name: string) {
  const collapsed = useApp.getState().settings.collapsedTabGroups
  void window.scb.invoke('settings:set', { collapsedTabGroups: collapsed.includes(name) ? collapsed.filter((other) => other !== name) : [...collapsed, name] })
}

/**
 * A group's name above its tabs. Clicking folds it, double-clicking or Rename edits the name in
 * place, and right-clicking has the rest.
 */
export function TabGroupHeader({ name, count, layout }: { name: string; count: number; layout: 'vertical' | 'horizontal' }) {
  const collapsed = useApp((s) => s.settings.collapsedTabGroups.includes(name))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  // A double-click renames, so a single click waits a moment before folding.
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const startRename = () => {
    clearTimeout(pending.current)
    setDraft(name)
    setEditing(true)
  }
  const finish = (save: boolean) => {
    setEditing(false)
    if (save && draft.trim() && draft.trim() !== name) void window.scb.invoke('tabs:rename-group', name, draft.trim())
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label="Group name"
        value={draft}
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        }}
        className={cx(
          'sc-no-drag shrink-0 rounded-sm border border-(--sc-accent) bg-surface px-1.5 text-xs text-text outline-none',
          layout === 'vertical' ? 'mt-2 h-6 w-full' : 'h-6 w-28'
        )}
      />
    )
  }
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      aria-label={`${name} group, ${count} ${count === 1 ? 'tab' : 'tabs'}`}
      title={collapsed ? `${name}: ${count} ${count === 1 ? 'tab' : 'tabs'}` : name}
      onClick={(e) => {
        clearTimeout(pending.current)
        if (e.detail > 1) return
        pending.current = setTimeout(() => toggleGroup(name), 220)
      }}
      onDoubleClick={startRename}
      onContextMenu={(e) => {
        e.preventDefault()
        void window.scb.invoke('tabs:group-menu', name).then((picked) => picked === 'rename' && startRename())
      }}
      className={cx(
        'sc-no-drag flex shrink-0 items-center gap-1 rounded-sm text-2xs font-medium text-text-faint transition-colors hover:bg-surface-hover hover:text-text-muted',
        layout === 'vertical' ? 'mt-2 h-6 w-full px-1.5' : 'h-6 max-w-36 border border-border px-1.5'
      )}
    >
      <ChevronRight aria-hidden size={11} strokeWidth={2} className={cx('shrink-0 transition-transform duration-(--sc-duration-fast)', !collapsed && 'rotate-90')} />
      <span className="min-w-0 truncate">{name}</span>
      {collapsed && <span className="ml-auto shrink-0 rounded-sm bg-surface-hover px-1 tabular-nums">{count}</span>}
    </button>
  )
}
