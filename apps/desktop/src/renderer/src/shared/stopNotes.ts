/** Shown under a reply that hit its length limit, with an offer to carry on. */
export const CUT_OFF = 'The reply hit its length limit.'

/** Why a reply ended early, in words, by the reason its provider gave. Shared by the sidebar and the Assistant page. */
export const STOP_NOTES: Record<string, string> = {
  max_tokens: CUT_OFF,
  length: CUT_OFF,
  refusal: 'The model declined to answer this.',
  content_filter: 'The provider filtered this reply.',
  cancelled: 'Stopped.'
}
