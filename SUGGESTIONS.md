# Suggestions: refinements for scTerra

Ideas for polishing what's already there, not new features. Each one names where it lives so it can be picked up on its own. Roughly in order of how much difference they'd make day to day.

## Built in 0.6.5

Items 1 to 13 are in 0.6.5: site icons and bold matches in address bar rows, Shift+Delete for history rows, Ctrl+Enter, `@bookmarks`/`@history`/`@tabs`/`@ai`, unit conversions (no currencies), Paste and go, the whole address on hover, Recently closed, hover cards on side tabs, folding tab tree branches, double-click to even out split view, and dropping a tab on the page to split.

## Built in 0.8.0

15, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 30, 31, 32 and 33 are in 0.8.0 (see CONTEXT.md). Still open: 14, 16, 21, 28, 29, 34 and 35. 25's shortcut on each palette row was already there; 0.8.0 added the "Ask scAI" row.

## New tab and briefs

14. **New tab search box parity.** It now autofills and answers sums, but has no open-tab rows or Ask rows. Bring its rows in line with the address bar's (same icons, Switch to tab).
15. **Brief cards: collapse read briefs.** On sc://briefs, briefs already read could fold to their title line, so today's unread ones stand out.
16. **Brief "Ask" history.** Questions asked about a brief disappear when the page closes (by design nothing is saved). An opt-in "Keep my questions" would let people come back to an answer.
17. **Top sites: remove and pin.** Let people hide a top site or pin one in place from its right-click menu, kept in `newTab` settings.

## Focus timer and blocker

18. **Keyboard on the timer page.** Space to start/stop, `B` for a break, so it works like other timer apps.
19. **End-of-round sound choice.** A few short sounds and a volume, with "none", in the timer's own settings.
20. **Distraction detail.** The distraction list counts by host; show the times as ticks on the Today timeline so patterns are visible.
21. **Sidebar timer when tabs are across the top.** The sidebar timer only exists with side tabs. The toolbar chip could grow the same play/stop and progress line in that layout.

## Settings and menus

22. **Settings search: jump and flash.** Searching already finds settings across pages; after picking one, scroll it into view and briefly tint its row so the eye lands on it.
23. **Reset a section.** A quiet "Reset to defaults" at the foot of each Settings page, asking first.
24. **Show shortcuts in menus everywhere.** Check that every More menu and tab menu row with a shortcut shows its accelerator, so the menus teach the keys.
25. **Command palette: show the shortcut on each row** and a "No results, ask scAI?" row when nothing matches.

## Reading, history and bookmarks

26. **History: group by site within a day.** Long days are a wall of rows. Fold repeated visits to one site under a single row with a count.
27. **Bookmarks: find duplicates and dead links.** A tidy-up action on sc://bookmarks that lists exact duplicates and pages that now 404, asking before removing anything.
28. **Reading list: progress.** Remember how far down a saved page was read and show it as a thin bar on the card; "Read something in N min" could prefer half-read pages.
29. **Bookmark folder order in sync.** Known gap (names and nesting sync, order doesn't). Worth closing before more people use two devices.

## Look and feel

30. **One empty-state voice.** `EmptyState` is on most pages now; Briefs, the timer's Today list and Watched pages still use their own sentences and spacing. Same component everywhere.
31. **Focus rings on sc:// pages.** Check every button and row shows the accent ring with the keyboard (`:focus-visible`), not only on hover, to match the address bar.
32. **Reduced motion.** Performance Mode removes animation; also follow the system's `prefers-reduced-motion` without needing Performance Mode.
33. **Dark mode contrast pass.** `text-text-faint` on `bg-surface` in dark is close to the WCAG AA line for small text (addresses in suggestion rows, hints in Settings). Nudge the token rather than each place.

## Reliability and testing

34. **A smoke test per published installer.** CI builds installers only by hand; a short launch-and-quit check on the built AppImage (not just `out/`) would catch packaging mistakes before the owner does.
35. **Real-model checks behind a flag.** Many AI features have only run against mocks. A manual-only test set (`SCB_REAL_AI=1`, never in CI) that runs one brief, one report and one `/tweak` would catch format drift, run when the owner OKs the cost.

## Code Changes

Ideas for Terra Code, to match Claude Code and OpenCode while staying easy to set up. They follow the 0.7.3 round (interactive checklist, GitHub access, cloud runs on GitHub Actions, questions with choices).

**All of 36 to 53 were built after 0.7.3 (see CONTEXT.md).** 36 needs the owner to register a GitHub OAuth app and put its client ID in `GITHUB_CLIENT_ID` (shared/coder.ts) before its button shows; 42 and 43 need a release made after them, as installed workflows download the runner from the latest release.

Easiest setup:

36. **Sign in with GitHub, in a button.** GitHub's device flow, so there's no CLI or token to sort out, and it can ask for the `workflow` scope that cloud runs need (the CLI's default sign-in lacks it). Needs one OAuth app registered by the owner. Goes beside the CLI and token choices in `GithubSettings.tsx`, with the token kept the same way as a pasted one (`coderGithub.ts`).
37. **Clone from GitHub.** Pick a repository from the account's list (`GET /user/repos`) and it clones into a chosen folder and opens Terra Code there, with no terminal. In the folder picker of `CodeWorkspace.tsx`.
38. **First-run setup for a project.** Picking a folder detects the stack, offers `/init`, and suggests "always allow" rules from `package.json` scripts and the like (`npm test*`), all on one screen. Rules already live in `coderTrust.ts`; detection beside `detectDiagnostics` in `coderProject.ts`.
39. **Suggested MCP servers.** Offer directory entries that fit what the project uses (Postgres in docker-compose, Sentry in its dependencies), one click each. `MCP_DIRECTORY` in `shared/coder.ts`.

Cloud, next steps:

40. **Live progress for cloud runs.** Job logs only come back once a run ends, so the card shows state, not steps, until then. The runner could post its steps to a GitHub check run (`checks: write`), which the app reads while it works. `cloud/runner.ts`, `coderCloud.ts`, `CloudCard.tsx`.
41. **Continue here.** Bring a finished run's conversation (already read back by `coder:cloud-events`) and its branch into the local session, so the model knows what was done in the cloud. Today `transcriptOf` skips cloud cards.
42. **Start from GitHub.** A comment like `@terra fix this` on an issue or pull request starts a run, through a workflow installed once on the default branch (asking first, as it lands on the person's branch).
43. **Scheduled tasks.** "Every Monday, update dependencies and open a pull request", as a `schedule:` trigger in that installed workflow.
44. **Fix CI.** When a pull request's checks fail, read their logs through the `github` tool and push a fix, here or in the cloud.

Coding power:

45. **Review a pull request.** `/review #12` reads a GitHub pull request and posts inline comments, each with the person's yes. Builds on `reviewTask` and the `github` tool.
46. **Language servers.** Real diagnostics, go to definition and find references for the model, as OpenCode has, started per language when the project has one.
47. **Claude Code–compatible hooks and settings.** Read `.claude/settings.json` hooks (PreToolUse, PostToolUse, Stop, Notification) and permissions, so existing setups carry over. Beside `loadHooks` in `coderProject.ts`.
48. **Run a checklist in parallel.** Hand chosen checklist steps to helpers that each work in their own worktree, then merge. Helpers and worktrees exist (`coder.ts`, `coderGit.ts`).
49. **Headless mode.** `scterra code -p "task"` runs without a window and prints the result, for scripts. The cloud runner is most of it already.
50. **Sandbox on Mac and Windows, and dev containers.** `sandbox-exec` on macOS, and running commands inside the project's `.devcontainer` where there is one. Today the sandbox is Linux with bubblewrap only (`coderTools.ts`).
51. **Budgets.** A token or spending cap per session that stops the run when reached, shown in the panel's Context section.
52. **Secret scanning.** Check diffs for keys and tokens before a commit, a push or a cloud run, and stop with the line that looks like one.
53. **Task templates.** "Add tests", "Upgrade dependencies", "Write docs", as starters with good built-in prompts, beside the existing `STARTERS`.
