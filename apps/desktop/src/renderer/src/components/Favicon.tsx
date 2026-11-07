import { Activity, AppWindow, Archive, Bookmark, BookMarked, Highlighter, BookOpen, Bot, CodeXml, Download, Eye, FileText, FlaskConical, Globe, History, KeyRound, MessageCircle, Network, Plus, Settings, ShieldBan, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { cx } from '@scbrowser/ui'

const INTERNAL_ICONS: Record<string, LucideIcon> = {
  newtab: Plus,
  pdf: FileText,
  settings: Settings,
  ai: Bot,
  assistant: MessageCircle,
  flags: FlaskConical,
  history: History,
  bookmarks: Bookmark,
  downloads: Download,
  tasks: Activity,
  watching: Eye,
  reading: BookMarked,
  highlights: Highlighter,
  archive: Archive,
  passwords: KeyRound,
  vpn: Network,
  blocker: ShieldBan,
  blocked: ShieldBan,
  reader: BookOpen,
  error: TriangleAlert,
  welcome: Sparkles
}

interface FaviconProps {
  url: string | null
  /** The tab's address, which picks an icon for scTerra's own pages. */
  pageUrl: string
  isLoading: boolean
}

export function Favicon({ url, pageUrl, isLoading }: FaviconProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (isLoading) {
    return (
      <span
        aria-hidden
        className="sc-tab-spinner size-3.5 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent"
      />
    )
  }
  const Internal = /^sc:\/\/(\w+)/.exec(pageUrl)?.[1]
  const Icon = Internal ? INTERNAL_ICONS[Internal] : undefined
  // Anything of scTerra's own always has something to show, and source views have no icon of their own.
  const Own = Icon ?? (Internal ? AppWindow : pageUrl.startsWith('view-source:') ? CodeXml : undefined)
  if (Own) return <Own aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
  if (!url || failedUrl === url) {
    return <Globe aria-hidden size={14} strokeWidth={1.5} className="shrink-0 text-text-faint" />
  }
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailedUrl(url)}
      className={cx('size-4 shrink-0 rounded-sm object-contain')}
    />
  )
}
