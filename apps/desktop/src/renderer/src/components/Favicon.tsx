import { Globe } from 'lucide-react'
import { useState } from 'react'
import { cx } from '@scbrowser/ui'

interface FaviconProps {
  url: string | null
  isLoading: boolean
}

export function Favicon({ url, isLoading }: FaviconProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (isLoading) {
    return (
      <span
        aria-hidden
        className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-border-strong border-t-accent"
      />
    )
  }
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
