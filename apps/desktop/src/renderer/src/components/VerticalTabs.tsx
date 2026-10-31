import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'

export function VerticalTabs() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitIds = useTabs((s) => s.splitIds)
  const collapsed = useApp((s) => s.settings.verticalTabsCollapsed)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const toggle = () => void window.scb.invoke('settings:set', { verticalTabsCollapsed: !collapsed })

  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col gap-1 pb-1.5 pl-1.5 transition-[width] duration-(--sc-duration-base) ease-out',
        collapsed ? 'w-12' : 'w-60'
      )}
    >
      <div
        role="tablist"
        aria-label="Tabs"
        aria-orientation="vertical"
        // Like Firefox, double-clicking the empty space opens a new tab.
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) void window.scb.invoke('tabs:create')
        }}
        className="sc-scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            index={index}
            active={tab.id === activeId}
            split={splitIds.includes(tab.id)}
            layout={collapsed ? 'rail' : 'vertical'}
            draggingId={draggingId}
            onDragState={setDraggingId}
          />
        ))}
      </div>
      {collapsed ? (
        <IconButton label="Expand tabs" className="size-9 self-center" onClick={toggle}>
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      ) : (
        <button
          type="button"
          aria-label="Collapse tabs"
          onClick={toggle}
          className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <span className="grid size-5 place-items-center">
            <PanelLeftClose aria-hidden size={15} strokeWidth={1.75} />
          </span>
          Collapse sidebar
        </button>
      )}
    </aside>
  )
}
