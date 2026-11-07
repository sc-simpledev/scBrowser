/** A site kept in the sidebar, like a chat or a calendar, to open beside any page. */
export interface SidebarSite {
  url: string
  title: string
}

/** The sidebar site that's open now, as the browser's interface draws its header. */
export interface SidebarSiteState {
  url: string
  /** The address it started from, which is how its button in the rail is found. */
  home: string
  title: string
  canGoBack: boolean
  loading: boolean
}

export const MAX_SIDEBAR_SITES = 12

export const isSidebarSites = (value: unknown): value is SidebarSite[] =>
  Array.isArray(value) &&
  value.length <= MAX_SIDEBAR_SITES &&
  value.every((site) => {
    const { url, title } = (site ?? {}) as Record<string, unknown>
    return typeof url === 'string' && url.length <= 2048 && /^https?:\/\//i.test(url) && URL.canParse(url) && typeof title === 'string' && title.length <= 200
  })
