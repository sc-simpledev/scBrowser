import { AppWindow, AtSign, Bot, Calculator, Globe, History, MessageCircle, Search, Star, TextSearch, type LucideIcon } from 'lucide-react'
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
  'search-suggestion': Search,
  calc: Calculator,
  scope: AtSign,
  keyword: TextSearch
}

/** Rows where the typed text is worth picking out: the ones that matched it, not the ones that are it. */
const HIGHLIGHTED: SuggestionKind[] = ['tab', 'bookmark', 'history', 'search-suggestion']

/** Draws `text` with the first place `query` appears in it in the stronger colour and weight. */
function Matched({ text, query, className, strong = 'font-semibold text-text' }: { text: string; query: string; className: string; strong?: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (at === -1) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {text.slice(0, at)}
      <span className={strong}>{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </span>
  )
}

/** What the right-hand side of a row says, only for rows that do something other than open. */
function hint(suggestion: Suggestion, selected: boolean): string | null {
  if (suggestion.kind === 'tab') return 'Switch to tab'
  if (suggestion.kind === 'calc') return 'Copy'
  if (suggestion.kind === 'keyword') return 'Tab'
  // Only on the chosen row, so the list doesn't fill up with the same words.
  if (suggestion.kind === 'history' && selected) return 'Shift+Delete to remove'
  return null
}

interface SuggestionListProps {
  suggestions: Suggestion[]
  selectedIndex: number
  query?: string
  onPick: (index: number) => void
}

export function SuggestionList({ suggestions, selectedIndex, query = '', onPick }: SuggestionListProps) {
  return (
    <ul role="listbox" aria-label="Suggestions" className="sc-glass-strong sc-tooltip rounded-lg shadow-3" style={{ padding: POPUP_PADDING }}>
      {suggestions.map((suggestion, index) => {
        const Icon = icons[suggestion.kind]
        const selected = index === selectedIndex
        const highlight = HIGHLIGHTED.includes(suggestion.kind) ? query : ''
        const side = hint(suggestion, selected)
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
            {suggestion.icon ? (
              <img src={suggestion.icon} alt="" draggable={false} className="size-[15px] shrink-0 rounded-sm object-contain" />
            ) : (
              <Icon
                aria-hidden
                size={15}
                strokeWidth={1.75}
                className={cx('shrink-0', selected ? 'text-accent' : 'text-text-faint')}
              />
            )}
            {/* Matched rows draw their own text a shade quieter, so the typed part stands out. */}
            <Matched text={suggestion.title} query={highlight} className={cx('min-w-0 shrink truncate', highlight ? 'text-text-muted' : 'text-text')} />
            {suggestion.detail && <Matched text={suggestion.detail} query={highlight} className="min-w-0 flex-1 truncate text-xs text-text-faint" strong="font-medium text-text-muted" />}
            {side && <span className="ml-auto shrink-0 pl-2 text-2xs font-medium text-text-muted">{side}</span>}
          </li>
        )
      })}
    </ul>
  )
}
