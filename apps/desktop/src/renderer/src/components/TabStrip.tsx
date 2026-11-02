import { Plus } from 'lucide-react'
import { useState } from 'react'
import { IconButton } from '@scbrowser/ui'
import { useTabs } from '../state/tabs'
import { Tab } from './Tab'
import { WorkspaceBar } from './WorkspaceBar'

export function TabStrip() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitIds = useTabs((s) => s.splitIds)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  return (
    <div className="sc-drag sc-wco-inset flex h-(--sc-tabstrip-height) shrink-0 items-center pl-1.5">
      <WorkspaceBar direction="row" showAdd={false} />
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 flex-1 items-center gap-1">
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            index={index}
            active={tab.id === activeId}
            split={splitIds.includes(tab.id)}
            layout="horizontal"
            draggingId={draggingId}
            onDragState={setDraggingId}
          />
        ))}
        <IconButton label="New tab" shortcut="Ctrl T" onClick={() => void window.scb.invoke('tabs:create')}>
          <Plus size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {/* Always leave a strip of empty space to drag the window by. */}
      <div className="w-12 shrink-0" />
    </div>
  )
}
