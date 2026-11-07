import { Activity, Archive, Bookmark, BookMarked, Bot, Download, Eye, FlaskConical, Globe, Highlighter, History, KeyRound, MessageCircle, Settings, ShieldBan, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useState, type ComponentType } from 'react'
import { cx, TooltipProvider } from '@scbrowser/ui'
import type { InternalPage } from '@scbrowser/shared'
import { applyPerformance, applyTint } from './api'
import { AiPage } from './pages/AiPage'
import { AssistantPage } from './pages/AssistantPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { FlagsPage } from './pages/FlagsPage'
import { HistoryPage } from './pages/HistoryPage'
import { BlockedPage } from './pages/BlockedPage'
import { BlockerPage } from './pages/BlockerPage'
import { NewTabPage } from './pages/NewTabPage'
import { PasswordsPage } from './pages/PasswordsPage'
import { PdfPage } from './pages/PdfPage'
import { SETTINGS_GROUPS, SettingsPage } from './pages/SettingsPage'
import { TasksPage } from './pages/TasksPage'
import { VpnPage } from './pages/VpnPage'
import { ArchivePage } from './pages/ArchivePage'
import { WatchingPage } from './pages/WatchingPage'
import { HighlightsPage } from './pages/HighlightsPage'
import { ReadingPage } from './pages/ReadingPage'
import { WelcomePage } from './welcome/WelcomePage'

const pages: Record<InternalPage, { title: string; icon: LucideIcon; component: ComponentType }> = {
  settings: { title: 'Settings', icon: Settings, component: SettingsPage },
  ai: { title: 'AI', icon: Bot, component: AiPage },
  assistant: { title: 'Assistant', icon: MessageCircle, component: AssistantPage },
  history: { title: 'History', icon: History, component: HistoryPage },
  bookmarks: { title: 'Bookmarks', icon: Bookmark, component: BookmarksPage },
  passwords: { title: 'Passwords', icon: KeyRound, component: PasswordsPage },
  downloads: { title: 'Downloads', icon: Download, component: DownloadsPage },
  blocker: { title: 'Site blocker', icon: ShieldBan, component: BlockerPage },
  vpn: { title: 'VPN', icon: Globe, component: VpnPage },
  tasks: { title: 'Task Manager', icon: Activity, component: TasksPage },
  reading: { title: 'Reading list', icon: BookMarked, component: ReadingPage },
  highlights: { title: 'Highlights', icon: Highlighter, component: HighlightsPage },
  watching: { title: 'Watched pages', icon: Eye, component: WatchingPage },
  archive: { title: 'Archived tabs', icon: Archive, component: ArchivePage },
  flags: { title: 'Flags', icon: FlaskConical, component: FlagsPage }
}

export function InternalApp() {
  if (location.host === 'blocked') return <BlockedPage />
  if (location.host === 'pdf') return <PdfPage />
  if (location.host === 'welcome') return <WelcomePage />
  return location.host === 'newtab' ? (
    <TooltipProvider>
      <NewTabPage />
    </TooltipProvider>
  ) : (
    <PageFrame />
  )
}

/** The parts of Settings, listed under its entry in the sidebar. */
function SettingsSections() {
  const [current, setCurrent] = useState(SETTINGS_GROUPS[0])
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries.find((entry) => entry.isIntersecting)
        if (seen) setCurrent(seen.target.id)
      },
      // Only the band near the top of the page counts as the current section.
      { rootMargin: '0px 0px -75% 0px' }
    )
    // The sections appear once settings have loaded.
    const timer = setTimeout(() => SETTINGS_GROUPS.forEach((id) => {
      const element = document.getElementById(id)
      if (element) observer.observe(element)
    }), 100)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])
  return (
    <div className="mb-1 ml-5 flex flex-col border-l border-border pl-2">
      {SETTINGS_GROUPS.map((group) => (
        <button
          key={group}
          type="button"
          aria-current={group === current ? 'true' : undefined}
          className={cx('flex h-7 items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface-hover hover:text-text', group === current ? 'font-medium text-text' : 'text-text-muted')}
          onClick={() => document.getElementById(group)?.scrollIntoView({ behavior: 'smooth' })}
        >
          {group}
        </button>
      ))}
    </div>
  )
}

function PageFrame() {
  const current = (location.host in pages ? location.host : 'settings') as InternalPage
  const { title, component: Page } = pages[current]

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    void window.scbInternal.invoke('settings:get').then(({ accent, accentTint, performanceMode }) => {
      document.documentElement.dataset.accent = accent
      applyTint(accentTint)
      applyPerformance(performanceMode)
    })
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-full">
        {/* The assistant wants the width, and has its own way back to Settings. */}
        {current !== 'assistant' && <nav aria-label="Browser pages" className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-border bg-bg p-3">
          {(Object.entries(pages) as [InternalPage, (typeof pages)[InternalPage]][]).map(([page, { title, icon: Icon }]) => (
            <Fragment key={page}>
            <a
              href={`sc://${page}/`}
              aria-current={page === current ? 'page' : undefined}
              className={cx(
                'flex h-8 items-center gap-2.5 rounded-lg px-2.5 transition-colors',
                page === current ? 'bg-surface-active font-medium text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
              )}
            >
              <Icon aria-hidden size={15} strokeWidth={1.75}  />
              {title}
            </a>
            {page === 'settings' && current === 'settings' && <SettingsSections />}
            </Fragment>
          ))}
        </nav>}
        {current === 'assistant' ? (
          <main className="min-w-0 flex-1">
            <Page />
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-180 flex-col gap-6 px-10 py-10">
              <h1 className="text-xl font-semibold tracking-[-0.03em]">{title}</h1>
              <Page />
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  )
}
