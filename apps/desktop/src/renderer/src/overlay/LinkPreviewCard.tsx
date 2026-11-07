import type { ReactNode } from 'react'
import { Columns2, ExternalLink, Loader2, PanelTopOpen, X } from 'lucide-react'
import { LINK_PREVIEW, type LinkPreviewState } from '@scbrowser/shared'

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url)
const act = (action: 'open' | 'background' | 'split' | 'close') => void window.scbOverlay.invoke('overlay:preview-action', action)

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      {children}
    </button>
  )
}

/**
 * The frame around a link preview. Its page is a native view placed over the card's lower part,
 * so this only draws the dimmed page behind, the card's edge and the header above the page.
 */
export function LinkPreviewCard({ preview, origin }: { preview: LinkPreviewState; origin: { x: number; y: number } }) {
  const { backdrop, card } = preview
  return (
    <>
      <div
        aria-hidden
        className="absolute bg-(--sc-scrim)"
        style={{ left: backdrop.x - origin.x, top: backdrop.y - origin.y, width: backdrop.width, height: backdrop.height }}
        onMouseDown={() => act('close')}
      />
      <div
        role="dialog"
        aria-label={`Preview of ${hostOf(preview.url)}`}
        className="absolute flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-3"
        style={{ left: card.x - origin.x - 1, top: card.y - origin.y - 1, width: card.width + 2, height: card.height + 2 }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') act('close')
        }}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3" style={{ height: LINK_PREVIEW.header }}>
          {preview.loading ? (
            <Loader2 aria-label="Loading" size={14} strokeWidth={1.75} className="shrink-0 animate-spin text-text-faint" />
          ) : (
            <PanelTopOpen aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-text-faint" />
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{preview.title || hostOf(preview.url)}</div>
            <div className="truncate text-2xs text-text-faint">{hostOf(preview.url)}</div>
          </div>
          <button
            type="button"
            onClick={() => act('open')}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            <ExternalLink aria-hidden size={12} strokeWidth={2} />
            Open as tab
          </button>
          <HeaderButton label="Open in split view" onClick={() => act('split')}>
            <Columns2 size={14} strokeWidth={1.75} />
          </HeaderButton>
          <HeaderButton label="Close preview (Esc)" onClick={() => act('close')}>
            <X size={14} strokeWidth={1.75} />
          </HeaderButton>
        </header>
      </div>
    </>
  )
}
