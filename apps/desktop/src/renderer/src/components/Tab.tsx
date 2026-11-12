import { Moon, Volume2, VolumeX, X } from 'lucide-react'
import { cx } from '@scbrowser/ui'
import { CONTAINERS, isNewTabUrl, type TabState } from '@scbrowser/shared'
import { useApp } from '../state/app'
import { Favicon } from './Favicon'

const tabTitle = (tab: TabState) => tab.title || (isNewTabUrl(tab.url) ? 'New tab' : tab.url)

interface TabProps {
  tab: TabState
  active: boolean
  /** Showing beside the active tab in split view. */
  split: boolean
  layout: 'horizontal' | 'vertical' | 'rail'
  index: number
  draggingId: number | null
  onDragState: (id: number | null) => void
}

/** Shows when a tab has sound or is muted, and switches that with a click. */
function AudioButton({ tab, corner }: { tab: TabState; corner: boolean }) {
  if (!tab.audible && !tab.muted) return null
  const Icon = tab.muted ? VolumeX : Volume2
  return (
    <button
      type="button"
      aria-label={tab.muted ? 'Unmute tab' : 'Mute tab'}
      title={tab.muted ? 'Unmute tab' : 'Mute tab'}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => void window.scb.invoke('tabs:mute', tab.id, !tab.muted)}
      className={cx(
        'grid shrink-0 place-items-center rounded-sm transition-colors hover:bg-surface-active hover:text-text',
        tab.muted ? 'text-text-faint' : 'text-accent',
        // Tabs that are only an icon carry it on a corner.
        corner ? 'absolute top-0.5 right-0.5 size-3.5 bg-surface' : 'size-5 @max-[64px]:hidden'
      )}
    >
      <Icon aria-hidden size={corner ? 10 : 13} strokeWidth={2} />
    </button>
  )
}

/** The rail has no room for a button, so the favicon turns into an X when the pointer is on it. */
function FaviconCloseButton({ tab, onClose }: { tab: TabState; onClose: () => void }) {
  return (
    <span className="group/icon relative grid size-5 shrink-0 place-items-center">
      <span className="grid place-items-center group-hover/icon:opacity-0 group-focus-within/icon:opacity-0">
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      </span>
      <button
        type="button"
        aria-label="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onClose}
        className="absolute inset-0 grid place-items-center rounded-sm bg-surface-active text-text opacity-0 transition-opacity group-hover/icon:opacity-100 focus-visible:opacity-100"
      >
        <X size={12} strokeWidth={2.25} />
      </button>
    </span>
  )
}

export function Tab({ tab, active, split, layout, index, draggingId, onDragState }: TabProps) {
  const close = () => void window.scb.invoke('tabs:close', tab.id)
  const side = layout !== 'horizontal'
  const iconOnly = tab.pinned || layout === 'rail'
  const container = CONTAINERS.find((c) => c.id === tab.container)
  const sleepButton = useApp((s) => s.settings.tabSleepButton) && !iconOnly && !tab.isSleeping
  // The tab tree: branches step in under the tab they were opened from. Only where there's room for it.
  const depth = useApp((s) => s.settings.tabTree) && layout === 'vertical' && !tab.pinned ? (tab.depth ?? 0) : 0

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tabTitle(tab)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragState(tab.id)
      }}
      onDragEnd={() => onDragState(null)}
      onDragOver={(e) => {
        if (draggingId === null) return
        e.preventDefault()
        if (draggingId === tab.id) return
        // Reorder once the pointer passes the middle of the tab it's moving over.
        const rect = e.currentTarget.getBoundingClientRect()
        // Pinned side tabs sit in rows, where it's across that counts.
        const past = side && !(tab.pinned && layout === 'vertical') ? e.clientY - rect.top > rect.height / 2 : e.clientX - rect.left > rect.width / 2
        const from = Number(e.currentTarget.closest('[role="tablist"]')?.querySelector(`[data-tab-id="${draggingId}"]`)?.getAttribute('data-index'))
        if ((from < index && past) || (from > index && !past)) void window.scb.invoke('tabs:move', draggingId, index)
      }}
      data-tab-id={tab.id}
      data-index={index}
      onMouseDown={(e) => {
        if (e.button === 0) void window.scb.invoke('tabs:activate', tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) close()
      }}
      onContextMenu={() => void window.scb.invoke('tabs:context-menu', tab.id)}
      data-active={active || undefined}
      data-depth={depth || undefined}
      style={depth > 0 ? { marginLeft: depth * 12, width: `calc(100% - ${depth * 12}px)` } : undefined}
      className={cx(
        'sc-no-drag group @container relative flex items-center',
        'transition-[background-color,color,box-shadow] duration-(--sc-duration-fast)',
        side && 'rounded-md',
        // Across the top, the open tab joins the toolbar under it, with curved feet (sc-htab in index.css).
        layout === 'horizontal' && 'sc-htab',
        layout === 'horizontal' && !tab.pinned && 'min-w-10 flex-[0_1_224px] gap-2 pr-1.5 pl-3',
        layout === 'horizontal' && tab.pinned && 'w-10 shrink-0 justify-center',
        layout === 'horizontal' && (active ? 'h-8.75 rounded-t-[10px]' : 'mb-1 h-7.5 rounded-md'),
        layout === 'vertical' && !tab.pinned && 'h-9 w-full shrink-0 gap-2 pr-1 pl-2',
        layout === 'vertical' && tab.pinned && 'size-9 shrink-0 justify-center',
        layout === 'rail' && 'size-9 shrink-0 justify-center self-center',
        draggingId === tab.id && 'opacity-50',
        active
          ? cx('bg-surface font-medium text-text', side && 'shadow-1')
          : split
            ? 'bg-surface-hover text-text'
            : 'text-text-muted hover:bg-surface-hover hover:text-text',
        // The accent marks the active side tab, as the design rules reserve it for.
        side && active && !iconOnly && 'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
      )}
    >
      {layout === 'rail' && !tab.pinned ? (
        <FaviconCloseButton tab={tab} onClose={close} />
      ) : layout === 'vertical' && !tab.pinned ? (
        // The same box as the New tab row's icon, so the two line up.
        <span className="grid size-5 shrink-0 place-items-center">
          <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
        </span>
      ) : (
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      )}
      {!iconOnly && (
        <span className={cx('min-w-0 flex-1 truncate @max-[64px]:hidden', tab.isSleeping && 'text-text-faint')}>
          {tabTitle(tab)}
        </span>
      )}
      {container && (
        <span
          role="img"
          aria-label={`${container.name} container`}
          title={`${container.name} container`}
          className={cx('size-2 shrink-0 rounded-full', iconOnly && 'absolute right-1 bottom-1')}
          style={{ backgroundColor: `oklch(0.65 0.15 ${container.hue})` }}
        />
      )}
      <AudioButton tab={tab} corner={iconOnly} />
      {sleepButton && (
        <button
          type="button"
          aria-label="Sleep tab"
          title="Sleep tab, to free its memory"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => void window.scb.invoke('tabs:sleep', tab.id)}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text @max-[96px]:hidden',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <Moon size={11} strokeWidth={2} />
        </button>
      )}
      {!iconOnly && (
        <button
          type="button"
          aria-label="Close tab"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={close}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text @max-[64px]:hidden',
            active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
