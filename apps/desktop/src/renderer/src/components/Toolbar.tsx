import { ArrowLeft, ArrowRight, RotateCw, X } from 'lucide-react'
import { IconButton } from '@scbrowser/ui'
import { useActiveTab } from '../state/tabs'
import { Omnibox } from './Omnibox'

export function Toolbar() {
  const tab = useActiveTab()
  const invoke = (channel: 'tabs:back' | 'tabs:forward' | 'tabs:reload' | 'tabs:stop') => {
    if (tab) void window.scb.invoke(channel, tab.id)
  }

  return (
    <div className="relative flex h-(--sc-toolbar-height) shrink-0 items-center gap-1 px-1.5">
      <div className="flex items-center">
        <IconButton label="Back" shortcut="Alt ←" disabled={!tab?.canGoBack} onClick={() => invoke('tabs:back')}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Forward"
          shortcut="Alt →"
         
          disabled={!tab?.canGoForward}
          onClick={() => invoke('tabs:forward')}
        >
          <ArrowRight size={16} strokeWidth={1.75} />
        </IconButton>
        {tab?.isLoading ? (
          <IconButton label="Stop" onClick={() => invoke('tabs:stop')}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        ) : (
          <IconButton label="Reload" shortcut="Ctrl R" disabled={!tab} onClick={() => invoke('tabs:reload')}>
            <RotateCw size={15} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
      <Omnibox />
      {tab?.isLoading && (
        <div aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full">
          <div className="h-full w-2/5 animate-[sc-progress_1.1s_var(--sc-ease-in-out)_infinite] rounded-full bg-accent" />
        </div>
      )}
    </div>
  )
}
