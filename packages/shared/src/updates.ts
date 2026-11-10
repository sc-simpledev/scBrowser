export const RELEASES_URL = 'https://github.com/sc-simpledev/scTerra/releases/latest'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  /** Downloaded, and waiting for a restart. */
  | 'ready'
  /** Restarting into the new version. */
  | 'installing'
  /** A newer version exists, but it has to be installed by hand. */
  | 'manual'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** The newer version, once one has been found. */
  version: string | null
  percent: number | null
  error: string | null
  /** False where this copy can't replace itself, such as a development build. */
  supported: boolean
  /** A downloaded update goes in by itself when the browser closes. A .deb needs a password, so it doesn't. */
  installsOnQuit: boolean
  /** This version, when it arrived by an update and its notes haven't been seen yet. */
  whatsNew: string | null
}

export const IDLE_UPDATE: UpdateState = { phase: 'idle', version: null, percent: null, error: null, supported: false, installsOnQuit: false, whatsNew: null }

export interface ReleaseNotes {
  version: string
  date: string
  items: string[]
}

/**
 * What each version brought, shipped inside the app so it shows with no network, newest first.
 * Shown once after an update, and kept in Settings under About.
 */
export const WHATS_NEW: ReleaseNotes[] = [
  {
    version: '0.5.5',
    date: '2026-11-11',
    items: [
      'A report appears beside the chat while it is being written, filling in section by section.',
      'A reply that hits its length limit offers Continue, and the two halves become one reply and one report.',
      'A report that comes back unreadable is asked for once more by itself. Any newest reply has a Try again button.',
      'Present a report as slides inside scTerra, from the report\'s ⋮ menu, with speaker notes from your AI on request.',
      'Jump between a long report\'s sections from the list button beside its title.',
      'See what changed between two versions of a report: added parts are marked green, removed ones red.',
      'Save a report\'s quiz as cards for Anki or Quizlet, from Download.',
      'Select text on a page, right-click, Ask AI, Make study notes from this.',
      'With your own API key, reports are written through the provider\'s tool calling where it has it, which keeps their format valid.',
      'More report shapes are understood, a renamed report stays with its earlier versions, and the report gallery no longer squeezes the conversation.'
    ]
  },
  {
    version: '0.5.4',
    date: '2026-11-10',
    items: [
      'Reports open as reports even when the AI miscounts its brackets, which is what left study notes showing as a block of code.',
      'A reply that was cut off part-way still shows everything written up to that point as a report.',
      'If a report truly can\'t be read, the chat says so plainly and keeps what was written a click away.',
      'Stopping a reply before it starts no longer leaves it thinking for ever, and a reply that hit its length limit says so on the Assistant page too.',
      'Scrollbars are slim and match the theme on every page.',
      'The lines of a Notebook callout sit under its text.'
    ]
  },
  {
    version: '0.5.3',
    date: '2026-11-10',
    items: [
      'Reports always show as reports, whatever shape the AI writes them in, such as slides or sections.',
      'Download a report as slides for PowerPoint, Keynote or Google Slides.',
      'Edit a report\'s text in place with the pencil button, and the change is saved with the chat.',
      'Study notes end with practice questions. Press Quiz me to go through them one at a time.',
      'Reports list the pages they drew on, in the side page and in every download.',
      'Each report remembers the design you picked for it.',
      'Make one report from a tab group or all your tabs, from the tab menu.',
      'Summarise everything unread on the reading list at once.',
      'Text pasted with stray codes in it, such as &#39; where an apostrophe should be, is tidied up as it goes in.',
      'Updates try again by themselves when a download fails or stalls, and can wait until you close the browser.',
      'Whole-computer VPN (TUN) on Windows sets up the network adapter properly, says what went wrong if it can\'t start, and checks that other apps really go through it.',
      'Slides can come with speaker notes your AI writes, and quizzes print as a worksheet with the answers at the back.',
      'Quiz questions come back on a schedule: ones you miss sooner, ones you know later.',
      'While editing a report, add one of your highlights as a quote.',
      'Save a report\'s layout as your own template, under Make a report.',
      'Make a report from a YouTube video; its times jump to that moment.',
      'Ask a question about the open report and get the answer beside it.',
      'Go back to the previous version from Settings if an update misbehaves.',
      'Study sessions: four rounds of 25 minutes of focus with 5-minute breaks, from the command palette.'
    ]
  }
]


/** The public list of releases, which needs no token. */
export const RELEASES_API_URL = 'https://api.github.com/repos/sc-simpledev/scTerra/releases?per_page=20'
export const releaseDownloadBase = (version: string) => `https://github.com/sc-simpledev/scTerra/releases/download/v${version}`

const parts = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0)
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

/** The newest published release older than this one, to go back to if this one misbehaves. */
export function previousRelease(releases: unknown, current: string): string | null {
  if (!Array.isArray(releases)) return null
  const versions = releases.flatMap((release) => {
    const { tag_name: tag, draft, prerelease } = (release ?? {}) as Record<string, unknown>
    return typeof tag === 'string' && /^v\d+\.\d+\.\d+$/.test(tag) && draft !== true && prerelease !== true ? [tag.slice(1)] : []
  })
  return versions.filter((version) => compareVersions(version, current) < 0).sort(compareVersions).at(-1) ?? null
}
