import { ArrowLeft, ArrowRight, ExternalLink, RotateCw, X } from 'lucide-react'
import { IconButton } from '@scbrowser/ui'
import { useActiveTab } from '../state/tabs'

/** All an installed site's window has: its title, moving around, and a way out to the full browser. */
export function AppWindowBar() {
  const tab = useActiveTab()
  const invoke = (channel: 'tabs:back' | 'tabs:forward' | 'tabs:reload' | 'tabs:stop') => {
    if (tab) void window.scb.invoke(channel, tab.id)
  }
  return (
    // The border goes on the outside, as the inner box stops short of the window's buttons.
    <div className="shrink-0 border-b border-border">
    <div className="sc-drag sc-wco-inset flex h-(--sc-tabstrip-height) items-center gap-1 px-1.5">
      <span className="sc-no-drag flex items-center gap-1">
        <IconButton label="Back" shortcut="Alt ←" disabled={!tab?.canGoBack} onClick={() => invoke('tabs:back')}>
          <ArrowLeft size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Forward" shortcut="Alt →" disabled={!tab?.canGoForward} onClick={() => invoke('tabs:forward')}>
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
      </span>
      <span className="min-w-0 flex-1 truncate px-2 text-text-muted">{tab?.title}</span>
      <span className="sc-no-drag flex">
        <IconButton label="Open in scTerra" onClick={() => void window.scb.invoke('tabs:open-in-browser')}>
          <ExternalLink size={15} strokeWidth={1.75} />
        </IconButton>
      </span>
      {/* Always leave a strip of empty space to drag the window by. */}
      <div className="w-6 shrink-0" />
    </div>
    </div>
  )
}
