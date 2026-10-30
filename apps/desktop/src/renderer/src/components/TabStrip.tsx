import { Plus, X } from 'lucide-react'
import { cx, IconButton } from '@scbrowser/ui'
import { isNewTabUrl, type TabState } from '@scbrowser/shared'
import { useTabs } from '../state/tabs'
import { Favicon } from './Favicon'

const tabTitle = (tab: TabState) => tab.title || (isNewTabUrl(tab.url) ? 'New tab' : tab.url)

function Tab({ tab, active }: { tab: TabState; active: boolean }) {
  const close = () => void window.scb.invoke('tabs:close', tab.id)

  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      title={tabTitle(tab)}
      onMouseDown={(e) => {
        if (e.button === 0) void window.scb.invoke('tabs:activate', tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) close()
      }}
      className={cx(
        'sc-no-drag group @container relative flex h-8 min-w-10 flex-[0_1_220px] items-center gap-2 rounded-md pr-1 pl-2.5',
        'transition-colors duration-(--sc-duration-fast)',
        active ? 'bg-surface text-text shadow-1' : 'text-text-muted hover:bg-surface-hover hover:text-text'
      )}
    >
      <Favicon url={tab.faviconUrl} isLoading={tab.isLoading} />
      <span className="min-w-0 flex-1 truncate @max-[64px]:hidden">{tabTitle(tab)}</span>
      <button
        type="button"
        aria-label="Close tab"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={close}
        className={cx(
          'flex size-5 shrink-0 items-center justify-center rounded-sm text-text-faint hover:bg-surface-active hover:text-text @max-[64px]:hidden',
          active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        )}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

export function TabStrip() {
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)

  return (
    <div className="sc-drag sc-wco-inset flex h-(--sc-tabstrip-height) shrink-0 items-center pl-1.5">
      <div role="tablist" aria-label="Tabs" className="flex min-w-0 flex-1 items-center gap-1">
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} active={tab.id === activeId} />
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
