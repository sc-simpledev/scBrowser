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
    version: '0.9.2',
    date: '2026-11-27',
    items: [
      'Terra Code can run a task on a computer of your own over SSH, not just on GitHub Actions: choose Your server under Runs on. Your folder goes as it is, uncommitted changes too, it carries on with this computer off, and the work comes back as a branch you fetch.',
      'A cloud run that stops now says why on its card, in the model’s own words, and a reply the free scTerra AI cuts short is tried again.',
      'In Terra Code, type ! and a command to run it yourself, and Terra Code sees what it printed. Type # and a note to add it to TERRA.md.',
      'New Terra Code commands: /context shows what fills the model’s memory, /doctor checks your setup, /style makes it explain its choices or leave small pieces for you to write, plus /security-review and /pr-comments.',
      'With a language server installed, Terra Code hears about errors in a file right after it edits it, the way your editor underlines them. Changed files open in your editor from the session panel.',
      'The assistant has a status line with the chat’s tokens, cost and how full the model’s memory is, and /compact sums up a long chat so it can keep going.',
      'Save an answer as a Markdown note, straight into a folder you choose (an Obsidian vault works), from the button under each reply.',
      'With memory on, the assistant may offer to remember a preference you mention. Nothing is kept unless you click Remember.',
      'Link hints: press Ctrl . and type the letters on a link or button to click it, without the mouse.',
      'A QR code for the page, under the padlock or in the page menu, to open it on your phone. It’s made on this computer.',
      'A site can always open in one workspace: choose where under the padlock.',
      'Ctrl or Shift click tabs to pick several, then right-click to close, group, move, mute or ask AI about them together.',
      'Tidy tab titles shortens long titles with AI, keeping the full one on hover (tab menu, With AI).',
      'Ask AI about part of the page: drag a box over a chart or picture, from the page menu.',
      'Saved tab sets can open by themselves at a time on the days you pick, in a workspace of your choice, from Archived tabs.',
      'The Task Manager lists what’s working in the background: briefs being written, Terra Code, runs on GitHub or your server, and downloads.',
      'Fixed: an address you were typing in a new tab disappeared when you switched to another tab. It now waits for you when you come back.'
    ]
  },
  {
    version: '0.9.1',
    date: '2026-11-26',
    items: [
      'Importing from Chrome, Edge, Brave or Firefox now brings your bookmark folders, not just the bookmarks.',
      'Bookmarks Tidy up no longer calls every link dead when you’re offline, and a site that’s just down isn’t offered for removal.',
      'The new tab’s Customise panel shows each widget by its whole name, with its menus underneath.',
      'Error pages say what went wrong in plain words, like “The site’s address couldn’t be found”, with the technical name underneath.',
      'Reader view names the article once, with its site and reading time.',
      'Now playing lets go of a player paused more than half an hour ago, and its menu can hide one until it plays again.',
      'In a narrow window, the full-page assistant and Terra Code start with their chat list folded, and Terra Code’s floating session panel steps aside for a commit it starts.',
      'Fixed: saved chats called anything under 24 hours old “Today”; the reading list mixed up pages that differ only after the “?”; the privacy week could skip a day when the clocks changed; “Close other tabs” was offered with no other tabs; find in all tabs re-read every page on each key; and a few errors when a page or the app closed at the wrong moment.'
    ]
  },
  {
    version: '0.9.0',
    date: '2026-11-25',
    items: [
      'Now playing: when a tab you aren’t looking at plays sound or video, a small control under the tabs (or in the toolbar) plays and pauses it, floats it in picture in picture, changes its speed or takes you back to it. Videos can also float by themselves when you switch tabs, in Settings.',
      'Search keywords: type yt, wiki, gh, maps or ddg, a space and your search in the address bar to search that site. Tab after the keyword adds the space, and you can add your own in Settings.',
      'Tab search (Ctrl Shift E) also finds words inside your open pages, and opens the tab with them found.',
      'Right-click an image to ask the AI about it, or paste or drop a picture into the assistant’s box.',
      'Reply styles for the assistant: Normal, Concise, Explanatory or Step by step, from the pen under its box.',
      'Save a chat as a Markdown file, from the side assistant or the full-page one.',
      'A skill gallery on the AI page: ready-made skills like Find the catch, Draft a reply and Quiz me, one click each.',
      'Clean links: tracking tags like utm_source and fbclid come off addresses as pages open. Right-click a link for “Copy clean link”, or selected words for “Copy link to highlight”.',
      'The new tab search box offers your open tabs and Ask rows, like the address bar.',
      'Reading list: pages remember how far down you read, show it on their card, and open there again. “Read something in” offers to finish a half-read page first.',
      'AI Briefs can keep your follow-up questions and answers with each brief, if you turn that on.',
      'With tabs across the top, the focus timer can sit in the toolbar with its own play button.',
      'Sync now carries the order of your bookmarks and folders.',
      'Fixed: scTerra had no icon in the Linux app menu or on a pinned taskbar button. Smaller things: the find bar says when nothing matches, tab search marks the words it found, and the Task Manager names the popup layer.'
    ]
  },
  {
    version: '0.8.0',
    date: '2026-11-23',
    items: [
      'Remove VPN: one switch in Settings, or the card at the end of the VPN page, turns the VPN off and takes away its button, menu rows and Xray core. Install VPN brings it back, with your connections if you kept them.',
      'Sign in to GitHub with a button in Terra Code, with no CLI or token to sort out.',
      'Connecting a project to GitHub goes in three steps: your account, this project, and what Terra Code may do. A folder that isn’t on GitHub yet can get a new repository (pushed for you) or be linked to one you have. The start screen explains when to choose a folder and when to clone.',
      'Focus timer: Space starts and stops, B takes a break. Pick a sound for the end of a round (Chime, Bell, Soft or none) and its volume. Tries at blocked sites show as ticks on the Today timeline.',
      'AI Briefs you’ve read fold to one line, so the new ones stand out.',
      'Right-click a shortcut on the new tab page to pin it in place or remove it. Shortcuts get their own letter and colour.',
      'History folds many visits to one site in a day under a single row, and keeps the day’s date in view as you scroll.',
      'Bookmarks can be tidied: find pages saved twice and pages that are gone, and remove them when you say.',
      'Settings: click a search result’s name to jump to it on its page, where it lights up for a moment. Each page can be put back to its defaults. Ctrl , opens Settings.',
      'Menus show their keyboard shortcuts, and the command palette offers to ask scAI when no command matches.',
      'Easier to see and to use: every control shows the keyboard focus ring, faint text is a little darker in both themes, and the system’s “reduce motion” setting turns animations off without Performance Mode. Empty pages and searches with no results all look the same.'
    ]
  },
  {
    version: '0.7.4',
    date: '2026-11-20',
    items: [
      'Terra Code’s first-run card sets a project up in one go: commands it may run, MCP servers that fit, and its notes file.',
      'Clone a GitHub repository from Terra Code’s start screen, without a terminal.',
      'On GitHub: start Terra Code from an @terra comment, or on a schedule, through a workflow installed with one pull request.',
      '/fix-ci and /review #12, language servers for definitions and references, Claude Code’s settings and hooks, a token budget per session, and a check for keys and passwords before each commit.',
      'scterra code -p "task" runs Terra Code without a window, for scripts. Sandboxes on Mac and in dev containers.',
      'Chat can search the web, read pages, look at the page you share, and use your MCP servers. Edit a sent message to try again from there.',
      'The assistant reads the whole page in order: headings, tables, forms and what’s on screen.',
      'Tabs down the side can hide until the pointer reaches the edge, and the sidebar can take a colour.',
      'Fixed: MCP servers started with npx or uvx could time out on their first run, or not be found when scTerra was opened from a menu.'
    ]
  },
  {
    version: '0.7.3',
    date: '2026-11-20',
    items: [
      'Terra Code’s checklist is yours to change: tick, edit, add and remove steps, and it hears about it.',
      'Terra Code can ask you questions with choices, and so can scAI in chat.',
      'Connect GitHub to let Terra Code read issues, pull requests and Actions runs, and with your yes, open them.',
      'Cloud runs: hand a task to GitHub Actions, which carries on with your computer off and pushes a branch or pull request.'
    ]
  },
  {
    version: '0.7.2',
    date: '2026-11-19',
    items: [
      'Terra Code’s settings open in place in the session panel: click a setting to change it there.',
      'Plans can be approved: after a plan, start it as it is or edit it first, asking before each change or not.',
      'Leave comments on lines in Review and send them to Terra Code to deal with.',
      'Terra Code sessions are grouped by project, marked when working or waiting for you, and can be searched, pinned and archived.',
      'Rewind the code only, the conversation only, or both, and undo or redo a single step.',
      'Edited files are formatted with the project’s own formatter (Prettier, Biome, Ruff, Black, gofmt, rustfmt), once you allow it.',
      'Add common MCP servers in a click, and sign in to remote ones that need it.',
      'A tidier look across the AI pages: softer tables and a copy button on code in replies, quieter message boxes, a simpler AI Briefs header, Quick AI as one line on the new tab page.',
      'Fixed: typing a “/” over the address bar’s completion could lose it.'
    ]
  },
  {
    version: '0.7.1',
    date: '2026-11-19',
    items: [
      'A session panel beside Terra Code, as in Claude: the folder and branch, model and thinking level, how full its memory is, tokens used, the checklist, helpers, changed files and what it has done.',
      'Choose how hard the model thinks from the brain button or /effort: Low to Max, five levels, with Auto as Medium for coding.',
      'See the model’s reasoning, folded above each step (Claude, DeepSeek, Qwen and others that give it). Turn it off in Terra Code settings.',
      'Helpers: Terra Code can hand work to a general agent or send explore off to read around, several side by side, each shown as a card with its steps and report.',
      'The checklist shows the step it’s on, and stays open above the box while it works.',
      'Shift+Tab switches mode, Esc stops, the up arrow brings back earlier messages, replies have a Copy button, and a Latest button jumps back down.',
      'Fixed: with Claude, the thinking behind each tool call is now sent back with it, as the API expects.'
    ]
  },
  {
    version: '0.7.0',
    date: '2026-11-19',
    items: [
      'Terra Code connects to MCP servers: your own, kept encrypted, and a project’s, once you allow them. It asks before using each tool.',
      'Type / in Terra Code for commands such as /init, /review, /compact and /undo, plus your project’s own. Type @ to attach a file or an open tab, and paste pictures in.',
      'Rewind to before any message you sent: the files and the conversation go back together.',
      '“Always allow npm test* here” remembers a command for the project. Commands that only look never ask, and you can block others in Terra Code settings.',
      'Dev servers can keep running in the background, and command output shows as it arrives, with a Stop for each command.',
      'Terra Code can open your dev server in a tab beside yours, read it, catch console errors, take a screenshot, and click or type with your OK.',
      'Long sessions are summarised before the model’s memory fills, and a small meter shows how full it is.',
      'Choose the model and how hard it thinks for each session, commit with a written message, and work in a separate git copy that merges back.',
      'Project agents, skills and hooks from .terra/, a Linux sandbox for commands, notifications, and scterra code "task" from a terminal.'
    ]
  },
  {
    version: '0.6.5',
    date: '2026-11-19',
    items: [
      'The address bar fills in the rest of a site you’ve bookmarked or visited as you type. Backspace takes it away.',
      'Type a sum like 7*8, or a conversion like 5 km in miles or 30 c to f, and the answer shows in the list. Picking it copies it.',
      'Suggestions show the part you typed in bold, and bookmarked sites with their own icons.',
      'Type @bookmarks, @history, @tabs or @ai to search just that. Backspace on an empty box goes back.',
      'Shift+Delete removes the chosen history row. Ctrl+Enter turns a word into www.word.com.',
      'Right-click the address bar for Paste and go, and rest the pointer on a cut-off address to see all of it.',
      'Recently closed lists the last ten tabs you closed, beside Reopen closed tab.',
      'Side tabs show a card with the whole title, the site and its memory when the pointer rests on them.',
      'Fold a branch of the tab tree from its icon or the tab menu. Picking a folded tab opens the branch again.',
      'Drag a tab onto the page to open it beside the one you’re on. Double-click the split view divider to even it out.'
    ]
  },
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
