import { X } from 'lucide-react'
import { cx } from '@scbrowser/ui'
import { isNewTabUrl, type TabState } from '@scbrowser/shared'
import { Favicon } from './Favicon'

const tabTitle = (tab: TabState) => tab.title || (isNewTabUrl(tab.url) ? 'New tab' : tab.url)

interface TabProps {
  tab: TabState
  active: boolean
  layout: 'horizontal' | 'vertical' | 'rail'
  index: number
  draggingId: number | null
  onDragState: (id: number | null) => void
}

export function Tab({ tab, active, layout, index, draggingId, onDragState }: TabProps) {
  const close = () => void window.scb.invoke('tabs:close', tab.id)
  const axisVertical = layout !== 'horizontal'

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
        const past = axisVertical ? e.clientY - rect.top > rect.height / 2 : e.clientX - rect.left > rect.width / 2
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
        'sc-no-drag group @container relative flex h-8 min-w-10 items-center gap-2 rounded-md',
        'transition-colors duration-(--sc-duration-fast)',
        layout === 'horizontal' && 'flex-[0_1_220px] pr-1 pl-2.5',
        layout === 'vertical' && 'w-full shrink-0 pr-1 pl-2.5',
        layout === 'rail' && 'size-8 min-w-0 shrink-0 justify-center',
        draggingId === tab.id && 'opacity-50',
        active ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:bg-surface-hover hover:text-text'
      )}
    >
      <Favicon url={tab.faviconUrl} isLoading={tab.isLoading} />
      {layout !== 'rail' && (
        <>
          <span className={cx('min-w-0 flex-1 truncate @max-[64px]:hidden', tab.isSleeping && 'text-text-faint')}>
            {tabTitle(tab)}
          </span>
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
        </>
      )}
    </div>
  )
}
