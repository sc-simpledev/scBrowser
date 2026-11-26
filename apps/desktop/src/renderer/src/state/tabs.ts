import { create } from 'zustand'
import { DEFAULT_WORKSPACE, type TabState, type TabsSnapshot } from '@scbrowser/shared'

interface TabsStore extends TabsSnapshot {
  /** Bumped whenever the omnibox should take focus (Ctrl+L, new tab…). */
  omniboxFocusRequest: number
  /** Tabs picked with Ctrl or Shift click, to act on together. Empty most of the time. */
  selected: number[]
  setSnapshot: (snapshot: TabsSnapshot) => void
  requestOmniboxFocus: () => void
  /** Ctrl click adds or takes away one tab; Shift click picks every tab from the open one to it. */
  pick: (id: number, range: boolean) => void
  clearSelection: () => void
}

export const useTabs = create<TabsStore>((set) => ({
  tabs: [],
  activeId: null,
  splitIds: [],
  splitRatio: 0.5,
  splitLinked: false,
  devToolsWidth: 0,
  workspaces: [DEFAULT_WORKSPACE],
  activeWorkspace: DEFAULT_WORKSPACE.id,
  omniboxFocusRequest: 0,
  selected: [],
  // Closed tabs drop out of the pick.
  setSnapshot: (snapshot) => set((s) => ({ ...snapshot, selected: s.selected.filter((id) => snapshot.tabs.some((tab) => tab.id === id)) })),
  requestOmniboxFocus: () => set((s) => ({ omniboxFocusRequest: s.omniboxFocusRequest + 1 })),
  pick: (id, range) =>
    set((s) => {
      const start = s.selected.length ? s.selected : s.activeId !== null ? [s.activeId] : []
      if (range) {
        const order = s.tabs.map((tab) => tab.id)
        const from = order.indexOf(s.activeId ?? id)
        const to = order.indexOf(id)
        const [low, high] = from < to ? [from, to] : [to, from]
        return { selected: order.slice(Math.max(0, low), high + 1) }
      }
      return { selected: start.includes(id) ? start.filter((one) => one !== id) : [...start, id] }
    }),
  clearSelection: () => set((s) => (s.selected.length ? { selected: [] } : s))
}))

export const useActiveTab = (): TabState | undefined =>
  useTabs((s) => s.tabs.find((tab) => tab.id === s.activeId))

/** Subscribes the store to main-process events. Call once at startup. */
export function connectTabs(): () => void {
  const { setSnapshot, requestOmniboxFocus } = useTabs.getState()
  void window.scb.invoke('tabs:snapshot').then(setSnapshot)
  const offChanged = window.scb.on('tabs:changed', setSnapshot)
  const offFocus = window.scb.on('ui:focus-omnibox', requestOmniboxFocus)
  const offPicked = window.scb.on('tabs:selection-done', () => useTabs.getState().clearSelection())
  // Escape lets go of a pick, as a file manager does.
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useTabs.getState().clearSelection()
  window.addEventListener('keydown', onKey)
  return () => {
    offChanged()
    offFocus()
    offPicked()
    window.removeEventListener('keydown', onKey)
  }
}
