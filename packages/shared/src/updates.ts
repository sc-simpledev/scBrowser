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
    version: '0.6.3',
    date: '2026-11-14',
    items: [
      'The focus timer has a new look: a ring that fills towards your goal, activities beside it, today on a timeline, and its settings folded away.',
      'Show the focus timer under your side tabs, from Settings or the timer’s own settings. It’s off unless you turn it on.',
      'Watched prices keep a history, drawn as a small chart with the lowest and highest.',
      'Snooze a tab until you next open its site, or snooze a whole tab group from its menu.',
      'Split view comes back when you return to either of its tabs, and a split can be saved as a pair to open again.',
      'The command palette shows your recent commands first and offers matching skills.',
      'The reading list shows how long each page takes to read, and picks something that fits the minutes you have.',
      'A blocked site offers “One more minute” after a short wait that grows each time that day.',
      'Recap your week from History or the palette.',
      'Send highlights to your new tab notes, or get a weekly brief on what’s new about them.',
      'A workspace can turn the VPN on while it’s open.',
      'New tab widgets can show only in the morning, the daytime or the evening.',
      'The More menu and the tab menu are grouped, with AI, Focus, Library and More tools in their own sections.'
    ]
  },
  {
    version: '0.6.2',
    date: '2026-11-14',
    items: [
      'A focus timer for any kind of work: a stopwatch or countdown rounds per activity, a daily goal, a week of bars and a 12-week calendar. It pauses when you step away.',
      'AI Briefs have a new look, today’s briefs as one edition with Listen to all, followed stories, briefs from your reading list or your focus week, and Save as PDF, Markdown or to your notes.',
      'Workspaces can switch in and out by themselves at set hours.',
      'VPN pings show one round trip through the server, so they match other ping tools.'
    ]
  },
  {
    version: '0.6.1',
    date: '2026-11-13',
    items: [
      'Briefs: ask a follow-up question under any brief, listen to it read aloud, always include sites you choose, and ask for only what’s new since the last one.',
      'A brief’s first run no longer comes back empty when the model spends its reply thinking.',
      'Snooze a tab from its menu, and it comes back by itself in an hour, this evening, tomorrow morning or next Monday.',
      'Type /tweak in the assistant to change how a site looks, like “/tweak hide the sidebar”. /tweak undo takes it back.',
      'Watched pages say what changed in a sentence, and a watched price can tell you only when it goes above or below a figure.',
      'Split view can open the left side’s links on the right.',
      'Type a sentence in the command palette, like “close all YouTube tabs”, and scAI does it. Closing always asks first.',
      'Recap yesterday, from the History page or the palette.',
      'Side tabs are a tree: a tab opened from a link sits under the tab it came from. Turn it off in Settings, under Tabs.',
      'A Privacy this week widget for the new tab page.',
      'Fixed: tabs going to sleep on Linux when memory was fine, tab groups splitting when a tab was dragged, full screen getting stuck after closing a tab, and history search and screenshots using the wrong day.'
    ]
  },
  {
    version: '0.6.0',
    date: '2026-11-11',
    items: [
      'AI Briefs: pick a topic and a time, and scAI searches the web and writes you a short, medium or long brief every day, every 2 days or every week.',
      'New briefs wait in the toolbar, on every new tab and in a Briefs menu beside Customise, and open by themselves the first time you start scTerra after one is written.',
      'Google is the search engine for new profiles. You can pick another during setup or in Settings.',
      'Tabs across the top have a new look: the open tab joins the toolbar, and a row with many tabs now scrolls instead of hiding the New tab button.',
      'Split view shows each page in its own card, with buttons to swap sides, keep just one tab, or close it.',
      'Setup suggests a few things to start with, and the new tab page has a Get started list for your first days.',
      'Lists with nothing in them yet say what goes there, and section headings match across scTerra’s pages.'
    ]
  },
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
