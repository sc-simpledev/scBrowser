import { Plus } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { useTabs } from '../state/tabs'

const POPUP_GAP = 8

/** One letter for each workspace. Right-click to rename one or switch its Focus Mode. */
export function WorkspaceBar({ direction, showAdd }: { direction: 'row' | 'column'; showAdd: boolean }) {
  const workspaces = useTabs((s) => s.workspaces)
  const active = useTabs((s) => s.activeWorkspace)
  const edit = (id: string | null, element: HTMLElement) => {
    const { left, top, bottom } = element.getBoundingClientRect()
    void window.scb.invoke('workspaces:edit', id, left, direction === 'row' ? top - 188 - POPUP_GAP : bottom + POPUP_GAP)
  }
  if (!showAdd && workspaces.length < 2) return null

  return (
    <div role="toolbar" aria-label="Workspaces" className={cx('sc-no-drag flex shrink-0 items-center gap-0.5', direction === 'column' && 'flex-col')}>
      {workspaces.map((workspace, index) => (
        <IconButton
          key={workspace.id}
          label={workspace.name}
          shortcut={index < 9 ? `Ctrl Alt ${index + 1}` : undefined}
          aria-pressed={workspace.id === active}
          className={cx('relative text-xs font-medium', workspace.id === active && 'bg-surface text-text shadow-1')}
          onClick={() => void window.scb.invoke('workspaces:switch', workspace.id)}
          onContextMenu={(e) => edit(workspace.id, e.currentTarget)}
        >
          {[...workspace.name][0]?.toUpperCase()}
          {workspace.focus && <span aria-hidden className="absolute top-1 right-1 size-1 rounded-full bg-accent" />}
        </IconButton>
      ))}
      {showAdd && (
        <IconButton label="New workspace" onClick={(e) => edit(null, e.currentTarget)}>
          <Plus size={14} strokeWidth={1.75} />
        </IconButton>
      )}
    </div>
  )
}
