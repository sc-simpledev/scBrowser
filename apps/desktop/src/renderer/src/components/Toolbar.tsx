import { ArrowLeft, ArrowRight, Bot, Download, EllipsisVertical, RotateCw, X } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { useApp } from '../state/app'
import { useAssistant } from '../state/assistant'
import { useActiveTab } from '../state/tabs'
import { Omnibox } from './Omnibox'

function DownloadsButton() {
  const { active, fraction } = useApp((s) => s.downloads)
  const hasDownloaded = useApp((s) => s.hasDownloaded)
  if (!hasDownloaded) return null
  return (
    <IconButton
      label={active > 0 ? `Downloads (${active} in progress)` : 'Downloads'}
      shortcut="Ctrl J"
      className="relative"
      onClick={() => void window.scb.invoke('downloads:open-page')}
    >
      <Download size={15} strokeWidth={1.75} className={active > 0 ? 'text-accent' : undefined} />
      {active > 0 && (
        <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-surface-active">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${(fraction ?? 0.5) * 100}%` }} />
        </span>
      )}
    </IconButton>
  )
}

export function Toolbar({ titleBar }: { titleBar: boolean }) {
  const tab = useActiveTab()
  const assistantOpen = useAssistant((s) => s.open)
  const invoke = (channel: 'tabs:back' | 'tabs:forward' | 'tabs:reload' | 'tabs:stop') => {
    if (tab) void window.scb.invoke(channel, tab.id)
  }

  return (
    // With vertical tabs there's no tab strip, so the toolbar doubles as the title bar.
    <div className={cx('relative flex h-(--sc-toolbar-height) shrink-0 items-center gap-1 px-1.5', titleBar && 'sc-drag sc-wco-inset')}>
      <div className="flex items-center">
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
      </div>
      <Omnibox />
      <DownloadsButton />
      <IconButton
        label="Assistant"
        shortcut="Ctrl Shift A"
        aria-pressed={assistantOpen}
        className={assistantOpen ? 'text-accent' : undefined}
        onClick={useAssistant.getState().toggle}
      >
        <Bot size={16} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label="Menu"
        onClick={(e) => {
          const { left, bottom } = e.currentTarget.getBoundingClientRect()
          void window.scb.invoke('menu:open', left, bottom)
        }}
      >
        <EllipsisVertical size={16} strokeWidth={1.75} />
      </IconButton>
      {tab?.isLoading && (
        <div aria-hidden className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full">
          <div className="h-full w-2/5 animate-[sc-progress_1.1s_var(--sc-ease-in-out)_infinite] rounded-full bg-accent" />
        </div>
      )}
    </div>
  )
}
