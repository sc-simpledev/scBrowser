import { TOOLBAR_ITEMS } from './containers'
import { ACCENTS, matchCommands, type PaletteCommand } from './privacy'
import { SEARCH_ENGINES, type Settings } from './settings'

/** Switches the command palette can flip, by name. Performance and Focus Mode have commands of their own. */
const SWITCHES: [keyof Settings, string][] = [
  ['accentTint', 'accent tint'],
  ['httpsOnly', 'HTTPS-only mode'],
  ['rejectCookieBanners', 'rejecting cookie banners'],
  ['keepSignIns', 'staying signed in after closing'],
  ['linkPreview', 'link preview with Shift-click'],
  ['memorySaver', 'memory saver'],
  ['tabSleepButton', 'sleep button on tabs'],
  ['spellCheck', 'spell checking'],
  ['searchSuggestions', 'search suggestions'],
  ['askWhereToSave', 'asking where to save downloads'],
  ['saveChats', 'keeping assistant chats'],
  ['passwordAutoFill', 'filling passwords by themselves'],
  ['passwordOfferSave', 'offering to save passwords'],
  ['profilesButton', 'the profiles button'],
  ['autoUpdate', 'automatic updates']
]

const CHOICES: { key: keyof Settings; name: string; options: { value: string; label: string }[] }[] = [
  { key: 'theme', name: 'Theme', options: [{ value: 'system', label: 'match system' }, { value: 'light', label: 'light' }, { value: 'dark', label: 'dark' }] },
  { key: 'tabLayout', name: 'Tabs', options: [{ value: 'horizontal', label: 'across the top' }, { value: 'vertical', label: 'down the side' }] },
  { key: 'bookmarksLayout', name: 'Bookmarks', options: [{ value: 'horizontal', label: 'along the top' }, { value: 'vertical', label: 'down the side' }] },
  { key: 'bookmarksBar', name: 'Show bookmarks', options: [{ value: 'always', label: 'always' }, { value: 'new-tab', label: 'on new tabs' }, { value: 'bookmarks-page', label: 'only on the bookmarks page' }] },
  { key: 'trackingProtection', name: 'Tracking protection', options: [{ value: 'off', label: 'off' }, { value: 'standard', label: 'standard' }, { value: 'strict', label: 'strict' }] },
  { key: 'startup', name: 'On start', options: [{ value: 'restore', label: 'reopen previous tabs' }, { value: 'new-tab', label: 'open a new tab' }] },
  { key: 'accent', name: 'Accent colour', options: ACCENTS.map((accent) => ({ value: accent.id, label: accent.name })) },
  { key: 'searchEngine', name: 'Search with', options: SEARCH_ENGINES.map((engine) => ({ value: engine.id, label: engine.name })) }
]

const PREFIX = 'set:'

/** Every setting change the palette offers, with what it sets. Ids are `set:<key>=<JSON value>`. */
export const SETTING_COMMANDS: (PaletteCommand & { patch: Partial<Settings> })[] = [
  ...CHOICES.flatMap(({ key, name, options }) =>
    options.map(({ value, label }) => ({ id: `${PREFIX}${key}=${JSON.stringify(value)}`, label: `${name}: ${label}`, setting: true, patch: { [key]: value } as Partial<Settings> }))
  ),
  ...SWITCHES.flatMap(([key, name]) =>
    [true, false].map((on) => ({ id: `${PREFIX}${key}=${on}`, label: `Turn ${on ? 'on' : 'off'} ${name}`, setting: true, patch: { [key]: on } as Partial<Settings> }))
  ),
  ...TOOLBAR_ITEMS.flatMap((item) =>
    [true, false].map((show) => ({ id: `${PREFIX}toolbar:${item.id}=${show}`, label: `${show ? 'Show' : 'Hide'} ${item.name} in the toolbar`, setting: true, patch: {} }))
  )
]

/** Commands, then the setting changes matching what's typed. Settings only show once something is typed, so the list stays short. */
export function matchPalette(query: string): PaletteCommand[] {
  if (!query.trim()) return matchCommands(query)
  return [...matchCommands(query), ...matchCommands(query, SETTING_COMMANDS)]
}

/** What a palette id changes, or null if it isn't a setting command. Only listed commands count, never a made-up id. */
export function settingCommandPatch(id: string, current: Settings): Partial<Settings> | null {
  const command = SETTING_COMMANDS.find((entry) => entry.id === id)
  if (!command) return null
  const toolbar = /^set:toolbar:([a-z]+)=(true|false)$/.exec(id)
  if (toolbar) {
    const item = toolbar[1] as Settings['hiddenToolbarItems'][number]
    const others = current.hiddenToolbarItems.filter((hidden) => hidden !== item)
    return { hiddenToolbarItems: toolbar[2] === 'true' ? others : [...others, item] }
  }
  return command.patch
}
