import { Plus, Search } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { IconButton } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'
import { TabGroupHeader } from './TabGroupHeader'
import { WorkspaceBar } from './WorkspaceBar'

export function TabStrip() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitIds = useTabs((s) => s.splitIds)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const folded = useApp((s) => s.settings.collapsedTabGroups)
  const list = useRef<HTMLDivElement>(null)
  // With more tabs than fit, the row scrolls, and keeps the open one in view.
  useEffect(() => {
    // A frame later, once new tabs have taken their room and the others have shrunk.
    const frame = requestAnimationFrame(() => {
      const row = list.current
      const tab = row?.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`)
      if (!row || !tab) return
      // Past the open tab's flares, which stick out either side of it.
      const left = tab.offsetLeft - 12
      const right = tab.offsetLeft + tab.offsetWidth + 12 - row.clientWidth
      if (row.scrollLeft > left) row.scrollLeft = left
      else if (row.scrollLeft < right) row.scrollLeft = right
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, tabs.length])

  return (
    <div className="sc-drag sc-wco-inset relative z-10 flex h-(--sc-tabstrip-height) shrink-0 items-end pl-2">
      <div className="mb-1 flex self-center">
        <WorkspaceBar direction="row" showAdd={false} />
      </div>
      {/* A pixel taller than the strip, so the open tab can cover the line along the toolbar's top. */}
      <div
        ref={list}
        role="tablist"
        aria-label="Tabs"
        onWheel={(e) => {
          if (e.deltaY !== 0 && e.currentTarget.scrollWidth > e.currentTarget.clientWidth) e.currentTarget.scrollLeft += e.deltaY
        }}
        className="relative -mb-px flex h-[calc(100%+1px)] min-w-0 items-end overflow-x-auto overflow-y-hidden px-2.5 [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => (
          <Fragment key={tab.id}>
            {tab.group && tab.group !== tabs[index - 1]?.group && <TabGroupHeader name={tab.group} count={tabs.filter((other) => other.group === tab.group).length} layout="horizontal" />}
            {!(tab.group && folded.includes(tab.group) && tab.id !== activeId) && (
              <Tab
                tab={tab}
                index={index}
                active={tab.id === activeId}
                split={splitIds.includes(tab.id)}
                layout="horizontal"
                draggingId={draggingId}
                onDragState={setDraggingId}
              />
            )}
          </Fragment>
        ))}
      </div>
      <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
        <IconButton label="New tab" shortcut="Ctrl T" onClick={() => void window.scb.invoke('tabs:create')}>
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Search tabs" shortcut="Ctrl Shift E" onClick={() => void window.scb.invoke('tabs:search')}>
          <Search size={15} strokeWidth={1.75} />
        </IconButton>
      </div>
      {/* Always leave a strip of empty space to drag the window by. */}
      <div className="min-w-12 flex-1" />
    </div>
  )
}
