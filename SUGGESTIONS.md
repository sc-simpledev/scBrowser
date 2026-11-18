# Suggestions: refinements for scTerra

Ideas for polishing what's already there, not new features. Each one names where it lives so it can be picked up on its own. Roughly in order of how much difference they'd make day to day.

## Built in 0.6.4

Items 1 to 13 are in 0.6.4: site icons and bold matches in address bar rows, Shift+Delete for history rows, Ctrl+Enter, `@bookmarks`/`@history`/`@tabs`/`@ai`, unit conversions (no currencies), Paste and go, the whole address on hover, Recently closed, hover cards on side tabs, folding tab tree branches, double-click to even out split view, and dropping a tab on the page to split.

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
