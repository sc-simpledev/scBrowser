import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'

export function VerticalTabs() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const collapsed = useApp((s) => s.settings.verticalTabsCollapsed)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const toggle = () => void window.scb.invoke('settings:set', { verticalTabsCollapsed: !collapsed })

  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col gap-1 pb-1.5 pl-1.5 transition-[width] duration-(--sc-duration-base)',
        collapsed ? 'w-11 items-center' : 'w-56'
      )}
    >
      <div
        role="tablist"
        aria-label="Tabs"
        aria-orientation="vertical"
        className="flex min-h-0 flex-1 flex-col items-stretch gap-1 overflow-y-auto"
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            index={index}
            active={tab.id === activeId}
            layout={collapsed ? 'rail' : 'vertical'}
            draggingId={draggingId}
            onDragState={setDraggingId}
          />
        ))}
      </div>
      <div className={cx('flex items-center', collapsed ? 'flex-col' : 'justify-between pr-1')}>
        <IconButton label="New tab" shortcut="Ctrl T" onClick={() => void window.scb.invoke('tabs:create')}>
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label={collapsed ? 'Expand tabs' : 'Collapse tabs'} onClick={toggle}>
          {collapsed ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
        </IconButton>
      </div>
    </aside>
  )
}
