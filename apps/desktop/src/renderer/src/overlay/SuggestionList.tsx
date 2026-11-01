import { AppWindow, Bot, Globe, History, MessageCircle, Search, Star, type LucideIcon } from 'lucide-react'
import { cx } from '@scbrowser/ui'
import { POPUP_PADDING, SUGGESTION_ROW_HEIGHT, type Suggestion, type SuggestionKind } from '@scbrowser/shared'

const icons: Record<SuggestionKind, LucideIcon> = {
  navigate: Globe,
  search: Search,
  tab: AppWindow,
  bookmark: Star,
  ask: Bot,
  'ask-page': MessageCircle,
  history: History,
  'search-suggestion': Search
}

interface SuggestionListProps {
  suggestions: Suggestion[]
  selectedIndex: number
  onPick: (index: number) => void
}

export function SuggestionList({ suggestions, selectedIndex, onPick }: SuggestionListProps) {
  return (
    <ul role="listbox" aria-label="Suggestions" className="sc-glass-strong sc-tooltip rounded-xl shadow-3" style={{ padding: POPUP_PADDING }}>
      {suggestions.map((suggestion, index) => {
        const Icon = icons[suggestion.kind]
        const selected = index === selectedIndex
        return (
          <li
            key={suggestion.id}
            role="option"
            aria-selected={selected}
            // Pick on mousedown: by click time the omnibox has lost focus and closed us.
            onMouseDown={(e) => {
              if (e.button === 0) onPick(index)
            }}
            style={{ height: SUGGESTION_ROW_HEIGHT }}
            className={cx(
              'flex items-center gap-3 rounded-lg px-2.5 transition-colors',
              selected ? 'bg-accent-soft' : 'hover:bg-surface-hover'
            )}
          >
            <Icon
              aria-hidden
              size={15}
              strokeWidth={1.75}
              className={cx('shrink-0', selected ? 'text-accent' : 'text-text-faint')}
            />
            <span className="min-w-0 shrink truncate text-text">{suggestion.title}</span>
            {suggestion.detail && (
              <span className="min-w-0 flex-1 truncate text-xs text-text-faint">{suggestion.detail}</span>
            )}
            {suggestion.kind === 'tab' && (
              <span className="ml-auto shrink-0 text-2xs font-medium text-text-muted">Switch to tab</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
