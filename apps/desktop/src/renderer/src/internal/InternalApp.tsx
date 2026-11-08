import { Activity, Archive, Bookmark, BookMarked, Bot, Download, Eye, FlaskConical, Globe, Highlighter, History, KeyRound, MessageCircle, Settings, ShieldBan, SquareTerminal, type LucideIcon } from 'lucide-react'
import { Fragment, lazy, Suspense, useEffect, type ComponentType } from 'react'
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
const CodePage = lazy(() => import('./pages/CodePage').then((m) => ({ default: m.CodePage })))

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
  flags: { title: 'Flags', icon: FlaskConical, component: FlagsPage },
  code: { title: 'Code (beta)', icon: SquareTerminal, component: CodePage }
}

/** The sidebar, in clusters of related pages, so the long list reads at a glance. */
const NAV: InternalPage[][] = [
  ['settings', 'history', 'bookmarks', 'downloads', 'passwords'],
  ['assistant', 'ai', 'code'],
  ['reading', 'highlights', 'watching', 'archive'],
  ['blocker', 'vpn', 'tasks', 'flags']
]

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
    <div className="mb-1 ml-5 flex flex-col border-l border-border pl-2 max-[860px]:hidden">
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
        {current !== 'assistant' && current !== 'code' && <nav aria-label="Browser pages" className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-bg p-3 [scrollbar-width:thin] max-[860px]:w-14 max-[860px]:px-2">
          {NAV.map((cluster, index) => (
            <Fragment key={cluster[0]}>
              {index > 0 && <div aria-hidden className="mx-2.5 my-1.5 h-px shrink-0 bg-border" />}
              {cluster.map((page) => {
                const { title, icon: Icon } = pages[page]
                return (
                  <Fragment key={page}>
                    <a
                      href={`sc://${page}/`}
                      aria-label={title}
                      title={title}
                      aria-current={page === current ? 'page' : undefined}
                      className={cx(
                        'flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 transition-colors',
                        page === current ? 'bg-surface-active font-medium text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
                      )}
                    >
                      <Icon aria-hidden size={15} strokeWidth={1.75} className="shrink-0" />
                      <span className="truncate max-[860px]:sr-only">{title}</span>
                    </a>
                    {page === 'settings' && current === 'settings' && <SettingsSections />}
                  </Fragment>
                )
              })}
            </Fragment>
          ))}
        </nav>}
        {current === 'assistant' || current === 'code' ? (
          <main className="min-w-0 flex-1">
            <Page />
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-180 flex-col gap-6 px-10 py-10 max-[860px]:px-5 max-[860px]:py-6">
              <h1 className="text-xl font-semibold tracking-[-0.03em]">{title}</h1>
              <Page />
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  )
}
