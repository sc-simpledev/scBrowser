import { useEffect } from 'react'
import { TooltipProvider } from '@scbrowser/ui'
import { AppWindowBar } from './components/AppWindowBar'
import { AssistantPanel, AssistantReport } from './components/AssistantPanel'
import { BookmarksBar } from './components/BookmarksBar'
import { ExtensionPanel } from './components/ExtensionPanel'
import { FindBar } from './components/FindBar'
import { PageSlot } from './components/PageSlot'
import { TabStrip } from './components/TabStrip'
import { Toolbar } from './components/Toolbar'
import { UpdatingScreen } from './components/UpdatingScreen'
import { BookmarksSidebar, useVerticalBookmarks } from './components/VerticalBookmarks'
import { VerticalTabs } from './components/VerticalTabs'
import { connectApp, useApp } from './state/app'
import { connectAssistant } from './state/assistant'
import { connectOverlay, overlayTooltipHost } from './state/overlay'
import { connectTabs } from './state/tabs'

/** An installed site's window, which only has the page and a slim bar above it. */
const isAppWindow = new URLSearchParams(location.search).get('window') === 'app'

export function App() {
  useEffect(connectTabs, [])
  useEffect(connectApp, [])
  useEffect(connectOverlay, [])
  useEffect(connectAssistant, [])
  const vertical = useApp((s) => s.settings.tabLayout === 'vertical')
  const sideBookmarks = useVerticalBookmarks()
  const bookmarksDown = useApp((s) => s.settings.bookmarksLayout === 'vertical')

  if (isAppWindow) {
    return (
      <TooltipProvider host={overlayTooltipHost}>
        <UpdatingScreen />
        <div className="flex h-full flex-col">
          <AppWindowBar />
          <FindBar />
          <div className="flex min-h-0 flex-1">
            <PageSlot />
          </div>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider host={overlayTooltipHost}>
      <UpdatingScreen />
      <div className="flex h-full flex-col">
        {!vertical && <TabStrip />}
        <Toolbar titleBar={vertical} />
        {!bookmarksDown && <BookmarksBar />}
        <FindBar />
        <div className="flex min-h-0 flex-1">
          {vertical && <VerticalTabs />}
          {!vertical && sideBookmarks && <BookmarksSidebar />}
          <PageSlot />
          <AssistantReport />
          <AssistantPanel />
          <ExtensionPanel />
        </div>
      </div>
    </TooltipProvider>
  )
}
