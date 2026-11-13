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
  ['tabTree', 'the tab tree in side tabs'],
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
/** The start of a palette id that runs a saved assistant skill, followed by its id. */
export const SKILL_COMMAND = 'skill:'

/**
 * What the palette lists for what's typed. With nothing typed, recent commands come first. Saved
 * skills whose name matches are offered before handing a sentence to the AI.
 */
export function matchPalette(query: string, context: { recent?: string[]; skills?: { id: string; name: string }[] } = {}): PaletteCommand[] {
  const { recent = [], skills = [] } = context
  if (!query.trim()) {
    const all = matchCommands(query)
    const first = recent.flatMap((id) => all.filter((command) => command.id === id))
    return [...first, ...all.filter((command) => !first.includes(command))]
  }
  const asked = query.replace(/\s+/g, ' ').trim()
  const words = asked.toLowerCase().split(' ').filter((word) => word.length > 2)
  const skillRows: PaletteCommand[] = skills
    .filter((skill) => {
      const name = skill.name.toLowerCase()
      return name.includes(asked.toLowerCase()) || (words.length > 0 && words.some((word) => name.includes(word)))
    })
    .slice(0, 3)
    .map((skill) => ({ id: `${SKILL_COMMAND}${skill.id}`, label: `Run skill: ${skill.name}` }))
  // A sentence rather than a command name: "close all youtube tabs". The AI works out the steps.
  const ai: PaletteCommand[] = asked.length >= 8 && asked.includes(' ') ? [{ id: `${AI_COMMAND}${asked.slice(0, 200)}`, label: `Do it with AI: “${asked.length > 48 ? `${asked.slice(0, 47)}…` : asked}”`, ai: true }] : []
  const ranked = matchCommands(query)
  const byRecent = [...ranked.filter((command) => recent.includes(command.id)), ...ranked.filter((command) => !recent.includes(command.id))]
  return [...byRecent, ...matchCommands(query, SETTING_COMMANDS), ...skillRows, ...ai]
}

/** The start of a palette id that carries a request for the AI, followed by the request. */
export const AI_COMMAND = 'ai-do:'

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
