import { Plus, Search } from 'lucide-react'
import { Fragment, useState } from 'react'
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

  return (
    <div className="sc-drag sc-wco-inset flex h-(--sc-tabstrip-height) shrink-0 items-center pl-1.5">
      <WorkspaceBar direction="row" showAdd={false} />
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 flex-1 items-center gap-1">
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
        <IconButton label="New tab" shortcut="Ctrl T" onClick={() => void window.scb.invoke('tabs:create')}>
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Search tabs" shortcut="Ctrl Shift E" onClick={() => void window.scb.invoke('tabs:search')}>
          <Search size={15} strokeWidth={1.75} />
        </IconButton>
      </div>
      {/* Always leave a strip of empty space to drag the window by. */}
      <div className="w-12 shrink-0" />
    </div>
  )
}
