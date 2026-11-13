import { BrushCleaning, Layers, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react'
import { Fragment, useState } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { ResizeHandle } from '../shared/ResizeHandle'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'
import { TabGroupHeader } from './TabGroupHeader'
import { VerticalBookmarks, useVerticalBookmarks } from './VerticalBookmarks'
import { WorkspaceBar } from './WorkspaceBar'
import { SidebarTimer } from './SidebarTimer'

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
  const sideBookmarks = useVerticalBookmarks()
  const showTimer = useApp((s) => s.settings.sidebarTimer)
  const folded = useApp((s) => s.settings.collapsedTabGroups)
  const groupSize = (name: string) => tabs.filter((tab) => tab.group === name).length

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
      {sideBookmarks && <VerticalBookmarks rail={collapsed} />}
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
              ) : tab.group ? (
                <TabGroupHeader name={tab.group} count={groupSize(tab.group)} layout="vertical" />
              ) : (
                <div role="presentation" className="mt-2 shrink-0 truncate px-2 pb-0.5 text-2xs font-medium text-text-faint">
                  Other
                </div>
              ))}
            {/* A folded group still shows its open tab, so the page in view is never hidden. */}
            {!(tab.group && folded.includes(tab.group) && tab.id !== activeId && !collapsed) && <Tab
              tab={tab}
              index={index}
              active={tab.id === activeId}
              split={splitIds.includes(tab.id)}
              layout={collapsed ? 'rail' : 'vertical'}
              draggingId={draggingId}
              onDragState={setDraggingId}
            />}
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
      {showTimer && <SidebarTimer rail={collapsed} />}
      {collapsed && (
        <div className="shrink-0 self-center border-t border-border pt-1">
          <WorkspaceBar direction="column" showAdd />
        </div>
      )}
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
        <div className="group/footer flex shrink-0 items-center gap-0.5 border-t border-border pt-1">
          <div className="min-w-0 flex-1">
            <WorkspaceBar direction="row" showAdd />
          </div>
          {/* The two less used ones stay out of sight until the pointer is here. */}
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/footer:opacity-100 group-hover/footer:opacity-100">
            <IconButton size="sm" label="Clean up tabs" onClick={() => void window.scb.invoke('tabs:cleanup')}>
              <BrushCleaning size={14} strokeWidth={1.75} />
            </IconButton>
            <IconButton size="sm" label="Organise tabs" onClick={() => void window.scb.invoke('tabs:organise')}>
              <Layers size={14} strokeWidth={1.75} />
            </IconButton>
          </div>
          <IconButton size="sm" label="Search tabs" shortcut="Ctrl Shift E" onClick={searchTabs}>
            <Search size={14} strokeWidth={1.75} />
          </IconButton>
          <IconButton size="sm" label="Collapse tabs" onClick={toggle}>
            <PanelLeftClose size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </aside>
  )
}
