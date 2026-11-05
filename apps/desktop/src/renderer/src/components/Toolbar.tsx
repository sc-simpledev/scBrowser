import { ArrowLeft, ArrowRight, ArrowUpCircle, Bot, CircleUserRound, Columns2, Download, EllipsisVertical, EyeOff, Globe, RotateCw, X, KeyRound, LockKeyhole, Puzzle } from 'lucide-react'
import { useEffect, useLayoutEffect, useState, type ReactNode, useRef, type CSSProperties } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { containerPartition, fullToolbarOrder, type ExtensionSummary, type ToolbarSlot, type UpdateState, type VpnSummary, type PasswordState } from '@scbrowser/shared'
import { useApp } from '../state/app'
import { useAssistant } from '../state/assistant'
import { useActiveTab, useTabs } from '../state/tabs'
import { Omnibox } from './Omnibox'

function DownloadsButton() {
  const { active, fraction } = useApp((s) => s.downloads)
  const hasDownloaded = useApp((s) => s.hasDownloaded)
  // Counts finished bursts, so each one starts its animation afresh.
  const [bursts, setBursts] = useState(0)
  const wasActive = useRef(0)
  useEffect(() => {
    if (wasActive.current > 0 && active === 0) setBursts((count) => count + 1)
    wasActive.current = active
  }, [active])
  if (!hasDownloaded) return null
  return (
    <IconButton
      label={active > 0 ? `Downloads (${active} in progress)` : 'Downloads'}
      shortcut="Ctrl J"
      className="relative"
      onClick={() => void window.scb.invoke('downloads:open-page')}
    >
      <Download size={15} strokeWidth={1.75} className={active > 0 ? 'text-accent' : undefined} />
      {bursts > 0 && (
        <span key={bursts} aria-hidden className="sc-sparkles">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((turn) => (
            <i key={turn} style={{ '--turn': `${turn}deg` } as CSSProperties} />
          ))}
        </span>
      )}
      {active > 0 && (
        <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-surface-active">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${(fraction ?? 0.5) * 100}%` }} />
        </span>
      )}
    </IconButton>
  )
}

/** Makes it plain that this window keeps nothing. */
function PrivateBadge() {
  const [isPrivate, setPrivate] = useState(false)
  useEffect(() => {
    void window.scb.invoke('browser:is-private').then(setPrivate)
  }, [])
  if (!isPrivate) return null
  return (
    <span className="sc-no-drag flex h-6 shrink-0 items-center gap-1.5 rounded-sm bg-accent-soft px-2 text-xs font-medium text-accent">
      <EyeOff aria-hidden size={13} strokeWidth={1.75} />
      Private
    </span>
  )
}

/** Appears once a connection has been added. */
function VpnButton() {
  const [vpn, setVpn] = useState<VpnSummary | null>(null)
  useEffect(() => {
    void window.scb.invoke('vpn:summary').then(setVpn)
    return window.scb.on('vpn:changed', setVpn)
  }, [])
  if (!vpn?.available) return null
  const state = vpn.error ? 'problem' : vpn.connecting ? 'connecting' : vpn.enabled ? `on, ${vpn.name}` : 'off'
  return (
    <IconButton
      label={`VPN: ${state}`}
      aria-pressed={vpn.enabled}
      className={cx('relative', vpn.enabled && 'text-accent', vpn.error && 'text-danger')}
      onClick={(e) => {
        const { left, bottom } = e.currentTarget.getBoundingClientRect()
        void window.scb.invoke('vpn:menu', left, bottom)
      }}
    >
      <Globe size={15} strokeWidth={1.75} />
      {vpn.enabled && <span aria-hidden className="absolute right-1.5 bottom-1.5 size-1.5 rounded-full bg-accent" />}
    </IconButton>
  )
}

/** Moved into the More menu when the window is narrow. */
/** Appears once there's a vault, as there's nothing to fill before that. */
function PasswordsButton() {
  const [state, setState] = useState<PasswordState | null>(null)
  useEffect(() => {
    void window.scb.invoke('passwords:summary').then(setState)
    return window.scb.on('passwords:changed', setState)
  }, [])
  if (!state?.exists) return null
  return (
    <IconButton
      label={state.unlocked ? 'Passwords' : 'Passwords (locked)'}
      shortcut="Ctrl Shift L"
      onClick={(e) => {
        const { left, bottom } = e.currentTarget.getBoundingClientRect()
        void window.scb.invoke('passwords:menu', left, bottom)
      }}
    >
      {state.unlocked ? <KeyRound size={15} strokeWidth={1.75} /> : <LockKeyhole size={15} strokeWidth={1.75} />}
    </IconButton>
  )
}

const ALIGNMENT = 'bottom left'

/** The menu of all extensions, and the buttons of those pinned to the toolbar. */
function ExtensionsButtons({ container }: { container: string | null | undefined }) {
  const [summary, setSummary] = useState<ExtensionSummary>({ display: 'panel', unpinned: [], panelOnClick: [] })
  const list = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLSpanElement>(null)
  const partition = container ? containerPartition(container) : undefined

  useEffect(() => {
    void window.scb.invoke('extensions:summary').then(setSummary)
    return window.scb.on('extensions:changed', setSummary)
  }, [])

  // The library draws every button in its own shadow root, with no way of asking for only some.
  useEffect(() => {
    const root = list.current?.shadowRoot
    if (!root) return
    let style = root.querySelector('style[data-unpinned]')
    if (!style) {
      style = root.appendChild(document.createElement('style'))
      style.setAttribute('data-unpinned', '')
    }
    const ids = summary.unpinned.filter((id) => /^[a-p]{32}$/.test(id))
    style.textContent = ids.length > 0 ? `${ids.map((id) => `#${id}`).join(',')}{display:none}` : ''
  }, [summary])

  // Panels hang from this button, wherever it's been dragged to.
  useLayoutEffect(() => {
    const report = () => {
      const button = menuButton.current
      if (!button) return
      const { x, y, width, height } = button.getBoundingClientRect()
      void window.scb.invoke('extensions:anchor', { x, y, width, height })
    }
    report()
    window.addEventListener('resize', report)
    return () => window.removeEventListener('resize', report)
  })

  useEffect(
    () =>
      window.scb.on('extensions:activate', (extensionId) => {
        if (summary.panelOnClick.includes(extensionId)) return void window.scb.invoke('extensions:panel-toggle', extensionId)
        const { x, y, width, height } = menuButton.current?.getBoundingClientRect() ?? new DOMRect(innerWidth - 40, 0, 32, 40)
        void window.browserAction.activate(partition ?? '_self', { eventType: 'click', extensionId, tabId: -1, alignment: ALIGNMENT, anchorRect: { x, y, width, height } })
      }),
    [summary, partition]
  )

  return (
    <div
      className="flex items-center gap-1"
      // Caught on the way down, before the button itself would open a popup or tell the extension.
      onClickCapture={(e) => {
        const button = e.nativeEvent.composedPath().find((target) => /^[a-p]{32}$/.test((target as HTMLElement).id ?? '')) as HTMLElement | undefined
        if (!button) return
        const { id } = button
        if (summary.display === 'panel') {
          e.stopPropagation()
          void window.scb.invoke('extensions:open', id)
        } else if (summary.panelOnClick.includes(id)) {
          e.stopPropagation()
          void window.scb.invoke('extensions:panel-toggle', id)
        }
      }}
    >
      <browser-action-list ref={list} class="sc-no-drag" partition={partition} alignment={ALIGNMENT} />
      <span ref={menuButton} className="flex">
        <IconButton
          label="Extensions"
          onClick={(e) => {
            const { left, bottom } = e.currentTarget.getBoundingClientRect()
            void window.scb.invoke('extensions:menu', left, bottom)
          }}
        >
          <Puzzle size={15} strokeWidth={1.75} />
        </IconButton>
      </span>
    </div>
  )
}

const SPARE_SLOTS: ToolbarSlot[] = ['split', 'vpn', 'downloads', 'passwords', 'extensions']

function SplitButton() {
  const splitOn = useTabs((s) => s.splitIds.length > 0)
  const canSplit = useTabs((s) => s.tabs.length > 1)
  return (
    <IconButton
      label={splitOn ? 'End split view' : 'Split view'}
      aria-pressed={splitOn}
      disabled={!splitOn && !canSplit}
      className={splitOn ? 'text-accent' : undefined}
      onClick={() => void window.scb.invoke('tabs:split-toggle')}
    >
      <Columns2 size={15} strokeWidth={1.75} />
    </IconButton>
  )
}

/** Shows once a new version is on its way, and stays out of sight the rest of the time. */
function UpdateButton() {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  useEffect(() => {
    void window.scb.invoke('updates:state').then(setUpdate)
    return window.scb.on('updates:changed', setUpdate)
  }, [])
  if (update?.phase !== 'ready' && update?.phase !== 'manual') return null
  return (
    <button
      type="button"
      onClick={() => void window.scb.invoke('updates:install')}
      className="sc-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-xs font-medium text-accent transition-colors hover:text-accent-hover"
    >
      <ArrowUpCircle aria-hidden size={14} strokeWidth={1.75} />
      {update.phase === 'ready' ? 'Restart to update' : 'Update available'}
    </button>
  )
}

/** Holds one toolbar item, which can be dragged to another place in the bar. */
function Slot({ slot, dragging, target, onDrag, onTarget, onDrop, children }: {
  slot: ToolbarSlot
  dragging: ToolbarSlot | null
  target: { slot: ToolbarSlot; after: boolean } | null
  onDrag: (slot: ToolbarSlot | null) => void
  onTarget: (target: { slot: ToolbarSlot; after: boolean }) => void
  onDrop: () => void
  children: ReactNode
}) {
  const wide = slot === 'omnibox'
  return (
    <div
      data-toolbar-slot={slot}
      // The address box takes text selection, so it's a place to drop on, not something to pick up.
      draggable={!wide}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', slot)
        onDrag(slot)
      }}
      onDragEnd={() => onDrag(null)}
      onDragOver={(e) => {
        if (!dragging || dragging === slot) return
        e.preventDefault()
        const rect = e.currentTarget.getBoundingClientRect()
        onTarget({ slot, after: e.clientX > rect.left + rect.width / 2 })
      }}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      className={cx('sc-no-drag relative flex items-center', wide && 'min-w-0 flex-1', dragging === slot && 'opacity-40')}
    >
      {target?.slot === slot && (
        <span aria-hidden className={cx('absolute inset-y-1 w-0.5 rounded-full bg-accent', target.after ? '-right-0.5' : '-left-0.5')} />
      )}
      {children}
    </div>
  )
}

export function Toolbar({ titleBar }: { titleBar: boolean }) {
  const tab = useActiveTab()
  const assistantOpen = useAssistant((s) => s.open)
  const hideAssistant = useApp((s) => s.settings.hiddenToolbarItems.includes('assistant'))
  const order = useApp((s) => s.settings.toolbarOrder)
  const showProfiles = useApp((s) => s.settings.profilesButton)
  const compact = useApp((s) => s.compact)
  const [dragging, setDragging] = useState<ToolbarSlot | null>(null)
  const [target, setTarget] = useState<{ slot: ToolbarSlot; after: boolean } | null>(null)
  const invoke = (channel: 'tabs:back' | 'tabs:forward' | 'tabs:reload' | 'tabs:stop') => {
    if (tab) void window.scb.invoke(channel, tab.id)
  }

  const items: Record<ToolbarSlot, ReactNode> = {
    back: (
      <IconButton label="Back" shortcut="Alt ←" disabled={!tab?.canGoBack} onClick={() => invoke('tabs:back')}>
        <ArrowLeft size={16} strokeWidth={1.75} />
      </IconButton>
    ),
    forward: (
      <IconButton label="Forward" shortcut="Alt →" disabled={!tab?.canGoForward} onClick={() => invoke('tabs:forward')}>
        <ArrowRight size={16} strokeWidth={1.75} />
      </IconButton>
    ),
    reload: tab?.isLoading ? (
      <IconButton label="Stop" onClick={() => invoke('tabs:stop')}>
        <X size={16} strokeWidth={1.75} />
      </IconButton>
    ) : (
      <IconButton label="Reload" shortcut="Ctrl R" disabled={!tab} onClick={() => invoke('tabs:reload')}>
        <RotateCw size={15} strokeWidth={1.75} />
      </IconButton>
    ),
    split: <SplitButton />,
    vpn: <VpnButton />,
    omnibox: <Omnibox />,
    downloads: <DownloadsButton />,
    passwords: <PasswordsButton />,
    extensions: <ExtensionsButtons container={tab?.container} />
  }

  const drop = () => {
    if (dragging && target) {
      const rest = fullToolbarOrder(order).filter((slot) => slot !== dragging)
      const at = rest.indexOf(target.slot) + (target.after ? 1 : 0)
      void window.scb.invoke('settings:set', { toolbarOrder: [...rest.slice(0, at), dragging, ...rest.slice(at)] })
    }
    setDragging(null)
    setTarget(null)
  }

  return (
    // With vertical tabs there's no tab strip, so the toolbar doubles as the title bar.
    <div className={cx('sc-site-tint relative flex h-(--sc-toolbar-height) shrink-0 items-center gap-1 px-1.5', titleBar && 'sc-drag sc-wco-inset')}>
      {fullToolbarOrder(order).filter((slot) => !compact || !SPARE_SLOTS.includes(slot)).map((slot) => (
        <Slot
          key={slot}
          slot={slot}
          dragging={dragging}
          target={target}
          onDrag={(next) => {
            setDragging(next)
            if (!next) setTarget(null)
          }}
          onTarget={setTarget}
          onDrop={drop}
        >
          {items[slot]}
        </Slot>
      ))}
      {/* These stay at the end of the bar, wherever everything else has been dragged. */}
      <PrivateBadge />
      <UpdateButton />
      {showProfiles && !compact && (
        <IconButton
          label="Profiles"
          onClick={(e) => {
            const { left, bottom } = e.currentTarget.getBoundingClientRect()
            void window.scb.invoke('profiles:menu', left, bottom)
          }}
        >
          <CircleUserRound size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      {!hideAssistant && !compact && (
        <IconButton
          label="Assistant"
          shortcut="Ctrl Shift A"
          aria-pressed={assistantOpen}
          className={assistantOpen ? 'text-accent' : undefined}
          onClick={useAssistant.getState().toggle}
        >
          <Bot size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      <IconButton
        label="Menu"
        onClick={(e) => {
          const { left, bottom } = e.currentTarget.getBoundingClientRect()
          void window.scb.invoke('menu:open', left, bottom, compact)
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
