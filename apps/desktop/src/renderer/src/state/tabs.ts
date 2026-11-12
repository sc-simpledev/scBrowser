import { create } from 'zustand'
import { DEFAULT_WORKSPACE, type TabState, type TabsSnapshot } from '@scbrowser/shared'

interface TabsStore extends TabsSnapshot {
  /** Bumped whenever the omnibox should take focus (Ctrl+L, new tab…). */
  omniboxFocusRequest: number
  setSnapshot: (snapshot: TabsSnapshot) => void
  requestOmniboxFocus: () => void
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
  setSnapshot: (snapshot) => set(snapshot),
  requestOmniboxFocus: () => set((s) => ({ omniboxFocusRequest: s.omniboxFocusRequest + 1 }))
}))

export const useActiveTab = (): TabState | undefined =>
  useTabs((s) => s.tabs.find((tab) => tab.id === s.activeId))

/** Subscribes the store to main-process events. Call once at startup. */
export function connectTabs(): () => void {
  const { setSnapshot, requestOmniboxFocus } = useTabs.getState()
  void window.scb.invoke('tabs:snapshot').then(setSnapshot)
  const offChanged = window.scb.on('tabs:changed', setSnapshot)
  const offFocus = window.scb.on('ui:focus-omnibox', requestOmniboxFocus)
  return () => {
    offChanged()
    offFocus()
  }
}
