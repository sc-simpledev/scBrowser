import { BrushCleaning, Layers, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'
import { WorkspaceBar } from './WorkspaceBar'

const MIN_SIDEBAR = 180
const MAX_SIDEBAR = 480

export function VerticalTabs() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitIds = useTabs((s) => s.splitIds)
  // A narrow window has no room for titles, whatever the setting says.
  const compact = useApp((s) => s.compact)
  const collapsed = useApp((s) => s.settings.verticalTabsCollapsed) || compact
  const savedWidth = useApp((s) => s.settings.sidebarWidth)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const newTab = () => void window.scb.invoke('tabs:create')
  const searchTabs = () => void window.scb.invoke('tabs:search')
  const pinnedCount = tabs.filter((tab) => tab.pinned).length
  const toggle = () => void window.scb.invoke('settings:set', { verticalTabsCollapsed: !collapsed })

  return (
    <aside
      className={cx(
        'relative flex shrink-0 flex-col gap-1 border-r border-border px-1.5 py-1.5 ease-out',
        collapsed && 'w-12',
        dragWidth === null && 'transition-[width] duration-(--sc-duration-base)'
      )}
      style={collapsed ? undefined : { width: dragWidth ?? savedWidth }}
    >
      {!collapsed && (
        <ResizeHandle
          label="Sidebar width"
          edge="right"
          width={dragWidth ?? savedWidth}
          min={MIN_SIDEBAR}
          max={MAX_SIDEBAR}
          onWidth={setDragWidth}
          onCommit={(sidebarWidth) => {
            void window.scb.invoke('settings:set', { sidebarWidth })
            setDragWidth(null)
          }}
          onDragging={(dragging) => void window.scb.invoke('layout:resizing', dragging)}
        />
      )}
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
        {/* Pinned tabs are icons, so with room to spare they fill rows. */}
        {pinnedCount > 0 && (
          <div className={cx('flex shrink-0 flex-wrap gap-0.5 border-b border-border pb-1', collapsed && 'flex-col items-center')}>
            {tabs.slice(0, pinnedCount).map((tab, index) => (
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
        )}
        {tabs.map((tab, index) => index < pinnedCount ? null : (
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
      <div className={cx('shrink-0 border-t border-border pt-1', collapsed && 'self-center')}>
        <WorkspaceBar direction={collapsed ? 'column' : 'row'} showAdd />
      </div>
      {collapsed ? (
        <>
          <IconButton label="Search tabs" shortcut="Ctrl Shift E" className="size-9 self-center" onClick={searchTabs}>
            <Search size={15} strokeWidth={1.75} />
          </IconButton>
          {!compact && (
            <IconButton label="Expand tabs" className="size-9 self-center" onClick={toggle}>
              <PanelLeftOpen size={16} strokeWidth={1.75} />
            </IconButton>
          )}
        </>
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
            <span className="truncate">Collapse</span>
          </button>
          <IconButton label="Search tabs" shortcut="Ctrl Shift E" onClick={searchTabs}>
            <Search size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Clean up tabs" onClick={() => void window.scb.invoke('tabs:cleanup')}>
            <BrushCleaning size={15} strokeWidth={1.75} />
          </IconButton>
          <IconButton label="Organise tabs" onClick={() => void window.scb.invoke('tabs:organise')}>
            <Layers size={15} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </aside>
  )
}
