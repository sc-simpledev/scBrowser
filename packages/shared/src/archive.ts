/** A tab closed into the archive after going unused, to find and bring back later. */
export interface ArchivedTab {
  id: string
  url: string
  title: string
  container: string | null
  archivedAt: number
  /** When it was last looked at before being archived. */
  lastActiveAt: number
  /** True if the person archived it themselves, rather than it going unused. */
  byHand: boolean
}

/** Days unused before a tab is archived, or 0 for never. */
export const ARCHIVE_CHOICES = [0, 1, 3, 7, 14, 30] as const
export const MAX_ARCHIVED = 500
