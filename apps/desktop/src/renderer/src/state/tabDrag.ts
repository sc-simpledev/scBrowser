import { create } from 'zustand'
import { useTabs } from './tabs'

interface TabDrag {
  /** The tab being dragged, from either tab layout. */
  id: number | null
  /**
   * A picture of the page in view. While a tab is dragged the real page is taken away, as a native
   * view would swallow the drag, and this stands in for it so a drop on the page can open split view.
   */
  picture: string | null
}

export const useTabDrag = create<TabDrag>(() => ({ id: null, picture: null }))

export async function startTabDrag(id: number): Promise<void> {
  useTabDrag.setState({ id, picture: null })
  const { activeId, splitIds, tabs } = useTabs.getState()
  // Only a tab other than the one in view can go beside it, and only when there's no split already.
  if (id === activeId || splitIds.length > 0 || tabs.length < 2) return
  const picture = await window.scb.invoke('tabs:capture')
  if (!picture || useTabDrag.getState().id !== id) return
  useTabDrag.setState({ picture })
  // Draw the picture first, then take the page away, so nothing flickers.
  requestAnimationFrame(() => {
    if (useTabDrag.getState().picture === picture) void window.scb.invoke('layout:resizing', true)
  })
}

export function endTabDrag(): void {
  const hadPicture = useTabDrag.getState().picture !== null
  useTabDrag.setState({ id: null, picture: null })
  if (hadPicture) void window.scb.invoke('layout:resizing', false)
}
