import { useEffect, useState } from 'react'

/** The pages of Settings, in order. Kept apart so the sidebar doesn't load the whole page to list them. */
export const SETTINGS_GROUPS = [
  { id: 'appearance', title: 'Appearance' },
  { id: 'tabs', title: 'Tabs and toolbar' },
  { id: 'search', title: 'Search' },
  { id: 'browsing', title: 'Browsing' },
  { id: 'performance', title: 'Performance' },
  { id: 'privacy', title: 'Privacy and security' },
  { id: 'data', title: 'Your data' },
  { id: 'ai', title: 'AI and extensions' },
  { id: 'about', title: 'About' }
] as const

export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id']

const isGroup = (id: string): id is SettingsGroupId => SETTINGS_GROUPS.some((group) => group.id === id)

/** The open page of Settings, from the address's #fragment, like sc://settings/#privacy. */
export function currentSettingsGroup(): SettingsGroupId {
  const id = decodeURIComponent(location.hash.slice(1)).toLowerCase()
  return isGroup(id) ? id : SETTINGS_GROUPS[0].id
}

export function useSettingsGroup(): SettingsGroupId {
  const [group, setGroup] = useState(currentSettingsGroup)
  useEffect(() => {
    const changed = () => setGroup(currentSettingsGroup())
    addEventListener('hashchange', changed)
    return () => removeEventListener('hashchange', changed)
  }, [])
  return group
}

const SEARCHING = 'sc-settings-searching'

/** Tells the sidebar whether Settings is showing search results rather than one page. */
export function announceSearching(searching: boolean) {
  dispatchEvent(new CustomEvent(SEARCHING, { detail: searching }))
}

export function useSettingsSearching(): boolean {
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const changed = (event: Event) => setSearching((event as CustomEvent<boolean>).detail)
    addEventListener(SEARCHING, changed)
    return () => removeEventListener(SEARCHING, changed)
  }, [])
  return searching
}

export function openSettingsGroup(id: SettingsGroupId) {
  // Replacing keeps Back for leaving Settings, rather than stepping through every page looked at.
  history.replaceState(null, '', `#${id}`)
  dispatchEvent(new HashChangeEvent('hashchange'))
  document.querySelector('main')?.scrollTo({ top: 0 })
}
