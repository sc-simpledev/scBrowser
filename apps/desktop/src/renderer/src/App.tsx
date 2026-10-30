import { useEffect } from 'react'
import { TooltipProvider } from '@scbrowser/ui'
import { AssistantPanel } from './components/AssistantPanel'
import { BookmarksBar } from './components/BookmarksBar'
import { FindBar } from './components/FindBar'
import { PageSlot } from './components/PageSlot'
import { TabStrip } from './components/TabStrip'
import { Toolbar } from './components/Toolbar'
import { VerticalTabs } from './components/VerticalTabs'
import { connectApp, useApp } from './state/app'
import { connectAssistant } from './state/assistant'
import { connectOverlay, overlayTooltipHost } from './state/overlay'
import { connectTabs } from './state/tabs'

export function App() {
  useEffect(connectTabs, [])
  useEffect(connectApp, [])
  useEffect(connectOverlay, [])
  useEffect(connectAssistant, [])
  const vertical = useApp((s) => s.settings.tabLayout === 'vertical')

  return (
    <TooltipProvider host={overlayTooltipHost}>
      <div className="flex h-full flex-col">
        {!vertical && <TabStrip />}
        <Toolbar titleBar={vertical} />
        <BookmarksBar />
        <FindBar />
        <div className="flex min-h-0 flex-1">
          {vertical && <VerticalTabs />}
          <PageSlot />
          <AssistantPanel />
        </div>
      </div>
    </TooltipProvider>
  )
}
