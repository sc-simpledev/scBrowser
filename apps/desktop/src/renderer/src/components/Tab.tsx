import { X } from 'lucide-react'
import { cx } from '@scbrowser/ui'
import { CONTAINERS, isNewTabUrl, type TabState } from '@scbrowser/shared'
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

/** Side tabs close from the favicon: it turns into an X when the pointer is on it. */
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
  const container = CONTAINERS.find((c) => c.id === tab.container)

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
        const past = side ? e.clientY - rect.top > rect.height / 2 : e.clientX - rect.left > rect.width / 2
        const from = Number(e.currentTarget.parentElement?.querySelector(`[data-tab-id="${draggingId}"]`)?.getAttribute('data-index'))
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
      className={cx(
        'sc-no-drag group @container relative flex items-center rounded-md',
        'transition-[background-color,color,box-shadow] duration-(--sc-duration-fast)',
        layout === 'horizontal' && 'h-8 min-w-10 flex-[0_1_220px] gap-2 pr-1 pl-2.5',
        layout === 'vertical' && 'h-9 w-full shrink-0 gap-2 px-2',
        layout === 'rail' && 'size-9 shrink-0 justify-center self-center',
        draggingId === tab.id && 'opacity-50',
        active
          ? 'bg-surface font-medium text-text shadow-1'
          : split
            ? 'bg-surface-hover text-text'
            : 'text-text-muted hover:bg-surface-hover hover:text-text',
        // The accent marks the active side tab, as the design rules reserve it for.
        side && active && 'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
      )}
    >
      {side ? (
        <FaviconCloseButton tab={tab} onClose={close} />
      ) : (
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={tab.isLoading} />
      )}
      {layout !== 'rail' && (
        <span className={cx('min-w-0 flex-1 truncate @max-[64px]:hidden', tab.isSleeping && 'text-text-faint')}>
          {tabTitle(tab)}
        </span>
      )}
      {container && (
        <span
          role="img"
          aria-label={`${container.name} container`}
          title={`${container.name} container`}
          className={cx('size-2 shrink-0 rounded-full', layout === 'rail' && 'absolute right-1 bottom-1')}
          style={{ backgroundColor: `oklch(0.65 0.15 ${container.hue})` }}
        />
      )}
      {layout === 'horizontal' && (
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
