import { Bookmark, Bot, Download, FileText, FlaskConical, Globe, History, MessageCircle, Plus, Settings, type LucideIcon } from 'lucide-react'
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
  downloads: Download
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
        className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent"
      />
    )
  }
  const Internal = /^sc:\/\/(\w+)/.exec(pageUrl)?.[1]
  const Icon = Internal ? INTERNAL_ICONS[Internal] : undefined
  if (Icon) return <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-muted" />
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
