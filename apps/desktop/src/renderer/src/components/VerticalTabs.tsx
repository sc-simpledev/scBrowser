import { Layers, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { Fragment, useState } from 'react'
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
  const newTab = () => void window.scb.invoke('tabs:create')
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
          <Fragment key={tab.id}>
            {tab.group !== (tabs[index - 1]?.group ?? null) &&
              (collapsed ? (
                <div aria-hidden className="mx-3 my-1 shrink-0 border-t border-border-strong" />
              ) : (
                <div role="presentation" className="mt-2 shrink-0 truncate px-2 pb-0.5 text-2xs font-medium text-text-faint">
                  {tab.group ?? 'Other'}
                </div>
              ))}
            <Tab
              tab={tab}
              index={index}
              active={tab.id === activeId}
              split={splitIds.includes(tab.id)}
              layout={collapsed ? 'rail' : 'vertical'}
              draggingId={draggingId}
              onDragState={setDraggingId}
            />
          </Fragment>
        ))}
        {collapsed ? (
          <IconButton label="New tab" shortcut="Ctrl T" className="size-9 self-center" onClick={newTab}>
            <Plus size={15} strokeWidth={1.75} />
          </IconButton>
        ) : (
          // Laid out like a tab, so the icon and text line up with the tabs above.
          <button
            type="button"
            onClick={newTab}
            className="flex h-9 w-full shrink-0 items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <span className="grid size-5 shrink-0 place-items-center">
              <Plus aria-hidden size={15} strokeWidth={1.75} />
            </span>
            New tab
          </button>
        )}
      </div>
      {collapsed ? (
        <IconButton label="Expand tabs" className="size-9 self-center" onClick={toggle}>
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Collapse tabs"
            onClick={toggle}
            className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <span className="grid size-5 place-items-center">
              <PanelLeftClose aria-hidden size={15} strokeWidth={1.75} />
            </span>
            Collapse sidebar
          </button>
          <IconButton label="Organise tabs" onClick={() => void window.scb.invoke('tabs:organise')}>
            <Layers size={15} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </aside>
  )
}
