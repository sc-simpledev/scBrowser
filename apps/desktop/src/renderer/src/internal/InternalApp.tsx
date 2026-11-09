import { Activity, Archive, Bookmark, BookMarked, Bot, Download, Eye, FlaskConical, Globe, Highlighter, History, KeyRound, MessageCircle, Settings, ShieldBan, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { cx, TooltipProvider } from '@scbrowser/ui'
import type { InternalPage } from '@scbrowser/shared'
import { applyPerformance, applyTint } from './api'
import { openSettingsGroup, SETTINGS_GROUPS, useSettingsGroup, useSettingsSearching } from './settingsGroups'
const AiPage = lazy(() => import('./pages/AiPage').then((m) => ({ default: m.AiPage })))
const AssistantPage = lazy(() => import('./pages/AssistantPage').then((m) => ({ default: m.AssistantPage })))
const BookmarksPage = lazy(() => import('./pages/BookmarksPage').then((m) => ({ default: m.BookmarksPage })))
const DownloadsPage = lazy(() => import('./pages/DownloadsPage').then((m) => ({ default: m.DownloadsPage })))
const FlagsPage = lazy(() => import('./pages/FlagsPage').then((m) => ({ default: m.FlagsPage })))
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const BlockedPage = lazy(() => import('./pages/BlockedPage').then((m) => ({ default: m.BlockedPage })))
const BlockerPage = lazy(() => import('./pages/BlockerPage').then((m) => ({ default: m.BlockerPage })))
const NewTabPage = lazy(() => import('./pages/NewTabPage').then((m) => ({ default: m.NewTabPage })))
const PasswordsPage = lazy(() => import('./pages/PasswordsPage').then((m) => ({ default: m.PasswordsPage })))
const PdfPage = lazy(() => import('./pages/PdfPage').then((m) => ({ default: m.PdfPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const TasksPage = lazy(() => import('./pages/TasksPage').then((m) => ({ default: m.TasksPage })))
const VpnPage = lazy(() => import('./pages/VpnPage').then((m) => ({ default: m.VpnPage })))
const ArchivePage = lazy(() => import('./pages/ArchivePage').then((m) => ({ default: m.ArchivePage })))
const WatchingPage = lazy(() => import('./pages/WatchingPage').then((m) => ({ default: m.WatchingPage })))
const HighlightsPage = lazy(() => import('./pages/HighlightsPage').then((m) => ({ default: m.HighlightsPage })))
const ReadingPage = lazy(() => import('./pages/ReadingPage').then((m) => ({ default: m.ReadingPage })))
const WelcomePage = lazy(() => import('./welcome/WelcomePage').then((m) => ({ default: m.WelcomePage })))

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

/** The sidebar in quiet labelled sections. The rarely needed ones sit apart at the bottom. */
const NAV: { label: string | null; pages: InternalPage[] }[] = [
  { label: null, pages: ['settings'] },
  { label: 'Library', pages: ['history', 'bookmarks', 'downloads', 'reading', 'highlights', 'watching', 'archive'] },
  { label: 'AI', pages: ['assistant', 'ai'] },
  { label: 'Privacy', pages: ['passwords', 'vpn', 'blocker'] }
]
const NAV_ADVANCED: InternalPage[] = ['tasks', 'flags']

function NavLink({ page, current }: { page: InternalPage; current: InternalPage }) {
  const { title, icon: Icon } = pages[page]
  return (
    <>
      <a
        href={`sc://${page}/`}
        aria-label={title}
        title={title}
        aria-current={page === current ? 'page' : undefined}
        className={cx('flex h-7.5 shrink-0 items-center gap-2.5 rounded-md px-2 transition-colors', page === current ? 'bg-surface-hover font-medium text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text')}
      >
        <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate max-[720px]:sr-only">{title}</span>
      </a>
      {page === 'settings' && current === 'settings' && <SettingsSections />}
    </>
  )
}

/**
 * Each page is loaded only when it's shown, so a new tab doesn't parse the PDF viewer, the assistant
 * and every other page as well. That keeps each sc:// tab's memory down.
 */
export function InternalApp() {
  return (
    <Suspense fallback={null}>
      <InternalPage />
    </Suspense>
  )
}

function InternalPage() {
  // Terra Code moved into the assistant. Old bookmarks and restored tabs still come here.
  if (location.host === 'code') {
    location.replace('sc://assistant/?mode=code')
    return null
  }
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

/** The pages of Settings, listed under its entry in the sidebar. */
function SettingsSections() {
  const group = useSettingsGroup()
  // While searching, results come from every page, so none of them is the current one.
  const current = useSettingsSearching() ? null : group
  return (
    <div className="mb-1 ml-5 flex flex-col border-l border-border pl-2 max-[720px]:hidden">
      {SETTINGS_GROUPS.map((group) => (
        <a
          key={group.id}
          href={`#${group.id}`}
          aria-current={group.id === current ? 'page' : undefined}
          className={cx('flex h-7 items-center rounded-md px-2 text-left text-xs transition-colors hover:bg-surface-hover hover:text-text', group.id === current ? 'bg-surface-hover font-medium text-text' : 'text-text-muted')}
          onClick={(event) => {
            event.preventDefault()
            openSettingsGroup(group.id)
          }}
        >
          {group.title}
        </a>
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
        {current !== 'assistant' && <nav aria-label="Browser pages" className="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border bg-bg p-2.5 [scrollbar-width:thin] max-[720px]:w-14 max-[720px]:px-2">
          {NAV.map(({ label, pages: section }) => (
            <div key={section[0]} className="flex shrink-0 flex-col gap-px">
              {label && <h2 className="px-2 pt-3.5 pb-1 text-2xs font-medium text-text-faint max-[720px]:sr-only">{label}</h2>}
              {section.map((page) => (
                <NavLink key={page} page={page} current={current} />
              ))}
            </div>
          ))}
          <div className="mt-auto flex shrink-0 flex-col gap-px pt-3.5">
            {NAV_ADVANCED.map((page) => (
              <NavLink key={page} page={page} current={current} />
            ))}
          </div>
        </nav>}
        {current === 'assistant' ? (
          <main className="min-w-0 flex-1">
            <Page />
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-180 flex-col gap-6 px-10 py-10 max-[720px]:px-5 max-[720px]:py-6">
              <h1 className="text-xl font-semibold tracking-[-0.03em]">{title}</h1>
              <Page />
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  )
}
