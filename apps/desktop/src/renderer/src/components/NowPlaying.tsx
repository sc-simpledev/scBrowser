import { EllipsisVertical, Pause, PictureInPicture2, Play } from 'lucide-react'
import type { MouseEvent } from 'react'
import { cx, IconButton } from '@scbrowser/ui'
import { nowPlayingTab, type TabState } from '@scbrowser/shared'
import { useApp } from '../state/app'
import { useTabs } from '../state/tabs'
import { Favicon } from './Favicon'

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)

/** The tab Now playing is about: sound or video in a tab that isn't on screen. */
function useNowPlaying(): TabState | null {
  const on = useApp((s) => s.settings.mediaControls)
  const tabs = useTabs((s) => s.tabs)
  const activeId = useTabs((s) => s.activeId)
  const splitIds = useTabs((s) => s.splitIds)
  if (!on) return null
  return nowPlayingTab(tabs, splitIds.length > 0 ? splitIds : activeId !== null ? [activeId] : [])
}

const act = (tab: TabState, action: 'toggle' | 'pip' | 'focus') => void window.scb.invoke('media:action', tab.id, action)
const menuAt = (tab: TabState, event: MouseEvent<HTMLElement>) => {
  event.preventDefault()
  const rect = event.currentTarget.getBoundingClientRect()
  void window.scb.invoke('media:menu', tab.id, rect.left, rect.bottom + 2)
}

/**
 * Sound or video in a tab you aren't looking at, like Arc's mini player: play and pause, picture in
 * picture, go back to it, and a menu with speed and mute. Under the side tabs, as a button in the
 * rail, or as a chip in the toolbar when tabs are across the top.
 */
export function NowPlaying({ variant }: { variant: 'sidebar' | 'rail' | 'toolbar' }) {
  const tab = useNowPlaying()
  const compact = useApp((s) => s.compact)
  if (!tab) return null
  const playing = tab.media === 'playing'
  const title = tab.title || hostOf(tab.url)
  const toggleLabel = `${playing ? 'Pause' : 'Play'} ${title}`
  const PlayPause = playing ? Pause : Play

  if (variant === 'rail')
    return (
      <IconButton label={toggleLabel} className="relative size-9 self-center" onClick={() => act(tab, 'toggle')} onContextMenu={(e) => menuAt(tab, e)}>
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={false} />
        <span aria-hidden className="absolute right-1 bottom-1 grid size-3.5 place-items-center rounded-full bg-surface text-text shadow-1">
          <PlayPause size={8} strokeWidth={3} className={cx(!playing && 'translate-x-px')} />
        </span>
      </IconButton>
    )

  if (variant === 'toolbar')
    return (
      <span className="sc-no-drag flex h-7 max-w-56 shrink-0 items-center rounded-md border border-border bg-surface text-xs" onContextMenu={(e) => menuAt(tab, e)}>
        <button type="button" aria-label={`Go to ${title}`} title={`Go to ${title}`} onClick={() => act(tab, 'focus')} className="flex h-full min-w-0 items-center gap-1.5 rounded-l-md pr-1 pl-1.5 transition-colors hover:bg-surface-hover">
          <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={false} />
          {!compact && <span className="min-w-0 truncate">{title}</span>}
        </button>
        <button type="button" aria-label={toggleLabel} title={playing ? 'Pause' : 'Play'} onClick={() => act(tab, 'toggle')} className="grid h-full w-7 shrink-0 place-items-center rounded-r-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text">
          <PlayPause aria-hidden size={12} strokeWidth={2.25} className={cx(!playing && 'translate-x-px')} />
        </button>
      </span>
    )

  return (
    <section aria-label="Now playing" className="group/media flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface py-1 pr-1 pl-2" onContextMenu={(e) => menuAt(tab, e)}>
      <button type="button" aria-label={`Go to ${title}`} title={`Go to ${title}`} onClick={() => act(tab, 'focus')} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm py-0.5 text-left">
        <Favicon url={tab.faviconUrl} pageUrl={tab.url} isLoading={false} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs font-medium">{title}</span>
          <span className="truncate text-2xs text-text-faint">
            {playing ? 'Playing' : 'Paused'} · {hostOf(tab.url)}
            {tab.mediaSpeed ? ` · ${tab.mediaSpeed}×` : ''}
          </span>
        </span>
      </button>
      <IconButton size="sm" label={toggleLabel} onClick={() => act(tab, 'toggle')}>
        <PlayPause size={13} strokeWidth={2} className={cx(!playing && 'translate-x-px')} />
      </IconButton>
      <IconButton size="sm" label="Picture in picture" onClick={() => act(tab, 'pip')}>
        <PictureInPicture2 size={14} strokeWidth={1.75} />
      </IconButton>
      <IconButton size="sm" label="More: speed, mute" onClick={(e) => menuAt(tab, e)}>
        <EllipsisVertical size={14} strokeWidth={1.75} />
      </IconButton>
    </section>
  )
}
