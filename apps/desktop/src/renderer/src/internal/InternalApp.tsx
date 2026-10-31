import { Bookmark, Bot, Download, FlaskConical, History, MessageCircle, Settings, type LucideIcon } from 'lucide-react'
import { useEffect, type ComponentType } from 'react'
import { cx, TooltipProvider } from '@scbrowser/ui'
import type { InternalPage } from '@scbrowser/shared'
import { AiPage } from './pages/AiPage'
import { AssistantPage } from './pages/AssistantPage'
import { BookmarksPage } from './pages/BookmarksPage'
import { DownloadsPage } from './pages/DownloadsPage'
import { FlagsPage } from './pages/FlagsPage'
import { HistoryPage } from './pages/HistoryPage'
import { NewTabPage } from './pages/NewTabPage'
import { SettingsPage } from './pages/SettingsPage'

const pages: Record<InternalPage, { title: string; icon: LucideIcon; component: ComponentType }> = {
  settings: { title: 'Settings', icon: Settings, component: SettingsPage },
  ai: { title: 'AI', icon: Bot, component: AiPage },
  assistant: { title: 'Assistant', icon: MessageCircle, component: AssistantPage },
  history: { title: 'History', icon: History, component: HistoryPage },
  bookmarks: { title: 'Bookmarks', icon: Bookmark, component: BookmarksPage },
  downloads: { title: 'Downloads', icon: Download, component: DownloadsPage },
  flags: { title: 'Flags', icon: FlaskConical, component: FlagsPage }
}

export function InternalApp() {
  return location.host === 'newtab' ? (
    <TooltipProvider>
      <NewTabPage />
    </TooltipProvider>
  ) : (
    <PageFrame />
  )
}

function PageFrame() {
  const current = (location.host in pages ? location.host : 'settings') as InternalPage
  const { title, component: Page } = pages[current]

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    void window.scbInternal.invoke('settings:get').then(({ accent }) => {
      document.documentElement.dataset.accent = accent
    })
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-full">
        <nav aria-label="Browser pages" className="flex w-52 shrink-0 flex-col gap-0.5 p-3">
          {(Object.entries(pages) as [InternalPage, (typeof pages)[InternalPage]][]).map(([page, { title, icon: Icon }]) => (
            <a
              key={page}
              href={`sc://${page}/`}
              aria-current={page === current ? 'page' : undefined}
              className={cx(
                'flex h-8 items-center gap-2.5 rounded-md px-2.5 transition-colors',
                page === current ? 'bg-accent-soft font-medium text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text'
              )}
            >
              <Icon aria-hidden size={15} strokeWidth={1.75} className={page === current ? 'text-accent' : undefined} />
              {title}
            </a>
          ))}
        </nav>
        {current === 'assistant' ? (
          <main className="min-w-0 flex-1">
            <Page />
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-180 flex-col gap-6 px-8 py-8">
              <h1 className="text-lg font-semibold">{title}</h1>
              <Page />
            </div>
          </main>
        )}
      </div>
    </TooltipProvider>
  )
}
