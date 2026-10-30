import { useEffect } from 'react'
import { TooltipProvider } from '@scbrowser/ui'
import { PageSlot } from './components/PageSlot'
import { TabStrip } from './components/TabStrip'
import { Toolbar } from './components/Toolbar'
import { connectTabs } from './state/tabs'

export function App() {
  useEffect(connectTabs, [])

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TabStrip />
        <Toolbar />
        <PageSlot />
      </div>
    </TooltipProvider>
  )
}
