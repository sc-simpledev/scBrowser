/**
 * "Get started": a short list of things worth trying, shown on the new tab for someone new to
 * scTerra. Each ticks itself off once it has been used, from wherever it was used.
 */
export const GETTING_STARTED = [
  { id: 'assistant', title: 'Ask about any page', detail: 'The assistant reads the page beside you and answers questions about it.', action: 'Open the assistant', shortcut: 'Ctrl Shift A' },
  { id: 'brief', title: 'Get a brief every morning', detail: 'scAI researches a topic at a time you pick, like the latest AI news at 8:00.', action: 'Set one up', shortcut: null },
  { id: 'split', title: 'Two tabs side by side', detail: 'Split view puts two pages next to each other, with a divider to drag.', action: 'Try split view', shortcut: null },
  { id: 'palette', title: 'Do anything from the keyboard', detail: 'The command palette finds tabs, settings and actions as you type.', action: 'Open the palette', shortcut: 'Ctrl K' },
  { id: 'customise', title: 'Make this page yours', detail: 'Add widgets like notes, a calendar or your reading list, and a picture.', action: 'Customise', shortcut: null }
] as const

export type GettingStartedId = (typeof GETTING_STARTED)[number]['id']

export interface OnboardingState {
  /** Whether the list shows: set up for a new profile, until hidden or finished and closed. */
  show: boolean
  done: GettingStartedId[]
}

export const isGettingStartedId = (value: unknown): value is GettingStartedId => GETTING_STARTED.some((item) => item.id === value)
