# scTerra: context for a new session

scTerra (formerly scDelta, and before that scBrowser) is an Electron browser for Linux, Windows and macOS with AI built in, inspired by Firefox and Dia. Its catchphrase is "Browse the World". Read [Plan.md](Plan.md) for the roadmap and status checklist, and [README.md](README.md) for layout and shortcuts. The repo is private: `sc-simpledev/scBrowser`, branch `main`.

## Where things stand right now

Version 0.4.1 is published (2026-11-05). It adds Performance Mode (Settings, the More menu and the command palette), moves the licence to All Rights Reserved, and gives `docs/index.html` animated guides for trusting the app on a Mac and adding a VPN connection. It also fixes: sleeping tabs losing pin, mute, group and workspace changes on restart, Reload on a sleeping tab doing nothing, Reload in the page menu staying on the error page, a subscription refresh losing the chosen VPN connection, a dead page keeping its spinner, Reader view failing silently, and picture in picture picking the page's first video. VPN now has a row in the More menu, and its page leads with adding connections. The Mac walkthrough on the website is drawn from Apple's documentation, not from running our build on a Mac, so check its wording the first time someone tries one.

Performance Mode is `performanceMode`, kept per device. `sleepMinutes` makes background tabs sleep within 5 minutes, `data-performance` (tokens.css) removes animations, blur and glass except spinners, and `quietMedia` in `TabManager` sets the autoplay policy on views created after it's on, so tabs already open keep their old policy until they sleep and wake. It needs no restart and changes no Chromium switches.


**Version 0.4.6 is published (tag on `3caff77`, 2026-11-08) for Linux, Windows and both kinds of Mac: Settings reorganised, settings search, UI fixes, and ten new features.** The owner asked to commit, push and tag it in the same message as the changes, so none of it was tried by hand first. Ask how it went. Plan.md has the summary. Tested: 354 unit tests and 207 end-to-end tests pass on the hidden screen, including 9 new ones in `e2e/release046.spec.ts` and 3 in `e2e/settings.spec.ts`; `performance.spec.ts:82` failed once under full load and passed 4 of 4 alone. Every new screen was screenshotted in light and dark, and Settings at 720 px too. Not checked: the AI-written file names and the reading digest against a real model (no model ran, not even the mock: the digest test only checks it reaches sc://assistant), the change-password link on real sites, download rules with "Ask where to save", container VPN against a real connection (a test checks each container's session is told direct or the VPN's rules), and the password health button on screen (the vault wasn't set up in screenshots).

- **Settings pages:** one page at a time, picked in the sidebar or by the address's fragment (`sc://settings/#privacy`). Ids and titles are `SETTINGS_GROUPS` in `internal/settingsGroups.ts`: appearance, tabs, search, browsing, performance, privacy, data, ai, about. `actions.openPage(page, part)` opens a part, and `TabManager.openInternal` reuses the tab and moves it to the fragment: Manage extensions goes to `#ai`, Manage profiles to `#data`. Group pages switch with `history.replaceState`, so Back leaves Settings. Tests that use a setting must go to its page first. Windows CI's screen is small, so with side tabs the sc:// page can be narrow enough for the sidebar to drop to icons and hide the Settings page links: tests reach a page by its `#fragment`, or turn side tabs off first. The first push of 0.4.6 failed on Windows over this, and over a test that asked Chromium's `resolveProxy`, which answers DIRECT there under the test switches; that test now records what `setProxy` is told.
- **Settings search and Changed:** `internal/settingsParts.tsx`. Each `Row` matches every typed word against its page, section, label, hint and `keywords`, and returns nothing otherwise; `Searchable` does the same for custom blocks. A `Row` with `setting=` compares with `DEFAULT_SETTINGS` (`isChangedSetting`), shows a reset button when changed, and is all the Changed filter shows. Sections and pages with no `[data-setting]` left are hidden by CSS `:has()` in `internal.css`. "/" focuses the search and Escape clears it.
- **Settings files:** `settingsFile.ts`. Export writes `{ kind: 'scterra-settings', version: 1, settings }` without `LOCAL_SETTINGS`; import checks the kind, runs `sanitizeSettings`, drops local ones, applies, and the page reloads.
- **Site controls:** the padlock is a button (`site:controls`) opening `SiteControls` in the overlay (`SITE_POPUP`, `siteControlsHeight`). `siteAction` in `window.ts` makes each change and redraws; the panel follows tab changes in `onChange`. AI off uses the host, forget-on-close the site without `www.`.
- **Palette settings:** `SETTING_COMMANDS` ids are `set:<key>=<JSON>` or `set:toolbar:<id>=<bool>`; `settingCommandPatch` only accepts listed ids. `matchPalette` adds them only when something is typed.
- **Tab search:** `searchRowsEverywhere` in `window.ts` adds other browser windows' rows, labelled "Window 2" and so on in `workspaceName`; picking one reveals it in its window and focuses that window.
- **Downloads:** `downloadRules` (local) are tried in order in `DownloadManager.track`, matching the extension, or the page's or file's host with subdomains; a missing folder falls back. `downloads:rename` keeps the extension and avoids taken names. `downloads:suggest-name` sends only the name and a web address to `ai.complete`, respects the AI off list, and `safeSuggestedName` strips folders and dot runs.
- **Focus sessions:** `focusUntil` (local). `startFocusTimer` in `browserCore` turns Focus Mode off when it passes, also at start; turning Focus Mode off clears it. `FocusChip` in the toolbar ends it.
- **VPN per container:** `vpnDirectContainers` (local). `applySessionProxy` sets those containers' sessions to direct. Only applies while the VPN covers just scTerra.
- **Reading digest** (`readingDigestPrompt`) and **highlights Markdown** (`highlightsMarkdown`) are in shared. New tab widgets `downloads`, `reading` and `watching` share `ListCard`.
- electron-builder warns that `desktopName` isn't set, which it says stops desktops linking windows to the .desktop entry. That may be the blank KDE taskbar icon in the open items. Not changed.

**Version 0.4.5 is published (tag on `95edcdc`, 2026-11-08) for Linux, Windows and both kinds of Mac.** The owner asked for the release in the same messages as the changes, so none of it was tried by hand first. Ask how it went. It covers their list (docked developer tools, dark mode, memory, passwords with autofill, agentic coding in beta) and everything in `PLS_FIX_OR_ELSE.md`. Plan.md has the summary. Tested: 340 unit tests and 195 end-to-end tests pass, including 9 new ones in `e2e/release045.spec.ts`; new screens were screenshotted in light and dark. Its first push failed CI on Windows: the coding tools compared paths against the folder as given, and Windows' temp folder has a short `RUNNER~1` name, so results came out as `../../..` paths (Macs would do the same with `/var`). The folder is now resolved with `realpath` first. Not checked: anything against a real AI model (coding agent and web search ran on the mock only), web search against the real DuckDuckGo pages beyond one accidental live run that parsed fine, autofill and the login list on real sites, the Chrome Web Store banner (needs the live store), Sider or any real extension's side panel, and the memory saver under real memory pressure.

- **Developer tools:** opened with `openDevTools({ mode: 'detach' })` into our own `WebContentsView`. Docked mode made DevTools put the device toolbar in `device_mode_emulation_frame.html`, which Electron opened as a separate window, and its own close button reached no window. Undocked, the device toolbar emulates inside the page. `DEVTOOLS_BAR` (30 px) above the view holds the title and close button (`tabs:devtools-close`). Their window opens are denied.
- **Force dark:** `ALREADY_DARK` samples nine points with `elementFromPoint` and walks up to the first opaque background, falls back to the declared colour scheme for the canvas, and counts light body text. Page-level CSS, as user CSS can't be removed. Checked again on `did-finish-load` and 1.2 seconds later.
- **Passwords:** `nextLoginField` (isolated world 1004) resolves on a trusted focus or click into a login field; `window.ts` shows `PasswordSuggest` in the overlay under it, with usernames only. It closes on any key, click or scroll in that page, a tab switch or navigation. Filling sets `scFillingUntil` so focusing the field doesn't reopen the list. `passwordAutoFill` (on) fills on load only with exactly one login for the exact origin (or its `www.` twin), https or loopback, top frame, empty fields, not new-password forms. `passwordSuggest` (on) turns the list off. A name-only first step is kept 10 minutes in `recentNames`.
- **Sign-ins kept:** `keepSessionCookies` re-sets session cookies with a 30-day expiry as they're set (`keepSignIns`, on). Host-only cookies stay host-only. Cookies are flushed at `before-quit`. Partitioned cookies can't be told apart through Electron's API, so they come back unpartitioned.
- **Web search:** the Web toggle on both assistants sets `webSearch`. `ai/webSearch.ts` posts to DuckDuckGo's HTML page (lite page as fallback), reads the first four results with `fetch` and a plain HTML-to-text pass (no page is rendered), and adds them plus a results list as numbered sources, so citations work. Through the default session without cookies. `SCB_SEARCH_URL` points it at a local page under `SCB_E2E` and then never falls back.
- **Tab icons:** fetched in the main process through the tab's session (`tabIcon`), sniffed when the server sends the wrong type, shrunk to 32 px, cached for the run, with `/favicon.ico` as a fallback after load.
- **Web Store brand:** `preload/internal.ts` gives chromewebstore.google.com a `userAgentData` with Google Chrome in its brands, and `googleSignIn.ts` sets `sec-ch-ua` on its requests in the shared `onBeforeSendHeaders` listener.
- **Side panels:** a worker's `chrome.sidePanel` calls retry for up to 3 seconds on "No handler registered", as the main process only sets up a worker's handler once it hears it's starting.
- **Closed groups:** a group's Close group keeps it in kv `tabs:closed-groups` (30 at most); Delete group doesn't. Reopen from the tab menu, sc://archive or the palette. Reopened tabs sleep until looked at.
- **Memory:** internal pages are `React.lazy`. `startMemorySaver` (`memorySaver`, on) checks every 20 seconds and sleeps the two oldest background tabs across windows, idle a minute or more, while free memory is under a tenth or 700 MB.
- **Code with AI (beta):** sc://code. `packages/ai/src/coder.ts` has the prompt and the parser for one fenced `tool` JSON block per reply; `main/ai/coder.ts` runs the loop (60 steps, older tool output trimmed past 350,000 characters); `main/ai/coderTools.ts` has the tools. Paths are resolved through `realpath` and must stay in `coderFolder`. Changes ask unless `coderMode` is `edits`; commands always ask unless "always allowed" for that exact command in the session. Commands run in `$SHELL -lc` with AppImage variables removed, two minutes at most, killed with their process group on stop. Only sc://code may call `coder:*`. The page warns when the chat model is the hosted one.

**Version 0.4.4 was committed and tagged on 2026-11-07, when the owner asked for it to be released.** It's the four-part round in Plan.md ("Next round"). Check the release finished before saying it's published. Hosted server sign-in is held back. Ask the owner how the new features went once they've used them, as nothing was tried by hand.

Part 4's testing: 311 unit tests and 186 end-to-end tests pass, including 46 and 14 new ones (`e2e/release044.spec.ts`, which also passes against the packaged beta). Every new screen was screenshotted in light and dark, which caught narrow-page layout problems on sc://passwords, sc://watching and sc://assistant, since fixed. Still not checked: anything against a real AI model (only the mock), Windows TUN (never run on Windows), the wintun checksum in `fetch-xray.mjs` (CI's Windows installer step fetches and checks it, so a CI pass on Windows confirms it), real consent tools on real sites, Sourcepoint's consent frames, and system notifications from the page watcher (stubbed in tests).

Found while testing: **Electron 45's `removeInsertedCSS` does nothing for CSS inserted with `cssOrigin: 'user'`**, though it resolves without an error. Page-level (`author`) CSS removes fine. Hidden parts and site CSS use page level with `!important` for that reason. Anything else that has to take CSS away again must do the same.

Part 1 in detail (the parts below were also written before testing; what's described is still how they work):

- **Cookie banners:** `rejectCookieBanners`, on by default. `cookieBanners.ts` runs in its own isolated world on `dom-ready`, knows the common consent tools (OneTrust, Cookiebot, Didomi, Usercentrics' shadow root and others), and otherwise looks for a whole-label reject match in many languages inside something named like a banner. It only ever presses reject or only-necessary, at most twice, and stops watching after 15 seconds. Consent frames from a few known hosts (Sourcepoint's `privacy-mgmt.com` and others) get the same script in the frame's main world, as Electron can't reach a subframe's isolated world. Sites with tracking protection off are skipped.
- **Two-step codes:** a login can hold a `TotpConfig` (setup key or `otpauth://totp/`). Codes are made in the main process (`main/totp.ts`), and the key never reaches a renderer: `passwords:totp` returns only the code. CSV import reads `totp`, `login_totp` or `otpauth` columns, and export adds a `totp` column only when some login has one. The key menu has Copy two-step code.
- **Leak check:** only when the person presses Check now on sc://passwords. It sends the first 5 characters of each SHA-1 to `api.pwnedpasswords.com/range/` with `Add-Padding`, through the default session so it takes the VPN. Results are sealed in the vault (`leaks`) and only count for a login not changed since.
- **Forget this site:** in the page menu and the command palette. Clears cookies (by domain, including subdomains), storage by origin through `clearData`, history and permissions, in the main session and every container's. Bookmarks, passwords and the per-site off lists stay. `forgetOnClose` sites are cleared on `will-quit` (held up to 4 seconds) and again at the next start.
- **Page tweaks:** Hide part of this page in the page menu and the palette opens a picker in a closed shadow root. Selectors are limited by `isSafeSelector` so they can't break out of their rule. `hiddenElements` and `siteCss` are settings, so they sync, keyed by the site without `www.`. Settings > Look and feel > Page tweaks lists them and edits each site's CSS.

**Part 2 of 4, also uncommitted and untested beyond typecheck and build:**

- **Link preview:** Shift-click a link (`linkPreview`, on by default), or Preview link in its menu. `TabManager` spots it as a `new-window` open with no features, which a script's popup always has. The page is a `WebContentsView` in the tab's own session, stacked above the overlay (`Overlay.setLinkPreview`), which draws the scrim, card and header. Its loads go through the site blocker by `core.watchPage`, and anything blocked opens as a tab instead, as the block page needs a tab's bridge. It closes on Escape, on switching tabs and for full-screen video.
- **Sidebar sites:** `sidebarSites` in settings (12 at most, synced). A rail at the window's right edge appears once there's one; the page menu, the palette and the rail's + add the current page. Panels share the default session, so the person is signed in, and the last 4 opened stay loaded. The rail only shows icons from bookmarks, so drawing it contacts nobody.
- **Watched pages:** page menu > Watch for changes (whole page, or a part through the picker). `PageWatcher` in `browserCore` loads each due page in a detached, muted `WebContentsView` one at a time, compares its text line by line (`diffWatchText`, which ignores reordering), and shows a system notification when it changes. Stored in kv `watch:pages`, never synced, nothing in private windows. sc://watching lists them.
- **Tab archive:** `archiveAfterDays` (off by default). The sleep timer closes tabs unused that long into kv `tabs:archive` (500 at most), leaving pinned, playing, showing, popup-paired and sc:// tabs. The tab menu has Archive tab. sc://archive reopens them.
- **Windows TUN:** `startWindows` in `tun.ts`, like the Mac one: Windows' admin prompt (`Start-Process -Verb RunAs`) can't pass a pipe, so an elevated PowerShell script copies the core and `wintun.dll` into a folder only administrators can write, checks both hashes, and watches the control folder's `alive` file and scTerra's process. `fetch-xray.mjs` fetches wintun 0.14.1 on Windows builds. Its checksum was written from memory of wintun.net's page and hasn't been checked: confirm it before a Windows build, or that build fails at the checksum. Never run on Windows.

**Part 3 of 4, also uncommitted and untested beyond typecheck and build. Nothing in it has run against a real model or even the mock AI yet:**

- **Citations:** pages sent with a message are numbered (`<page id="1">`), and `CITATION_INSTRUCTIONS` in the system prompt asks for `[1]` or `[1: "exact words"]`, and `[1:23]` for transcript times. The `context` event carries `sources` (tab id, title, address, kind), saved with the turn. `linkCitations` turns them into `#sc-cite-` and `#sc-time-` links before Markdown, skipping code and numbers past the last source; `ReplyContent` draws them as chips plus a source list. `core.openSource` goes to the tab if it's still on that page, finds the words with `FIND_RANGE_JS` and marks them with a CSS highlight, or seeks the video; otherwise it opens a new tab with a `#:~:text=` fragment or `t=`. Reports don't link citations; their text keeps the plain `[1]`.
- **Research across tabs:** `MAX_MENTIONED_TABS` is now 8 (one shared page budget). sc://assistant has a Tabs picker and "Research my tabs" (Research brief preset). Picked tabs stay picked for follow-ups; sleeping ones are woken in the background (`TabManager.wakeInBackground`) before sending.
- **Highlights:** select words, right-click, Highlight. Kept in kv `highlights` by page without the fragment, painted again on `dom-ready` with the CSS Custom Highlight API in an isolated world, so the page's markup isn't touched. sc://highlights edits notes and hands only the highlighted words and notes to sc://assistant for a report, through `ai.setPendingPrompt`.
- **Reading list:** page menu and palette. kv `reading:list`; visiting the page marks it read. Summarise on sc://reading is the only thing that sends its text, using the open tab or a hidden page (`hiddenPage.ts`, shared with the page watcher), on the quick model through `ai.complete`, respecting the per-site AI off list.
- **Video summaries:** `summarisePromptFor` picks `VIDEO_SUMMARY_PROMPT` on YouTube watch pages (page menu, palette, sidebar starter), which asks for key moments as `[m:ss]`.
- **Mini apps:** the code pane on sc://assistant has Keep as an app for .html files (only sc://assistant may call it). Apps are kept in kv `mini-apps` (30 at most) and served on the privileged `sc-app:` scheme only in the `persist:scterra-mini-apps` session, with the preview's policy minus its sandbox, so nothing can reach the network but storage lasts. Every permission is refused, it can't navigate or open windows, and there's no bridge. Settings > Installed apps lists them.

**Version 0.4.3 was committed and tagged on 2026-11-06, after the owner tested the AppImage and said to release it.** It carries 0.4.2's work too, which was never tagged on its own. Check the release finished before saying it's published.

- **Whole-computer VPN on Macs:** TUN now works on macOS too (`startMac` in `tun.ts`). It asks for the password through `osascript ... with administrator privileges`, which can't pass a pipe, so root's script (`MAC_TUN_SCRIPT`) watches a 0700 folder instead: it reads the config file once and deletes it, writes `status` when the `utun77` device is up, and stops when the `alive` file goes, scTerra's process is gone, or the core stops. Xray adds and removes the routes itself (`autoSystemRoutingTable`, `autoOutboundsInterface: 'auto'`, both in the pinned v26.10.31 core). Never run on a Mac, only typechecked.
- **Passwords:** a vault can have no master password (`create('')`): its random key is sealed by the keychain (`safeStorage`) in the vault record's `device` field, it opens by itself at start, never locks, and Lock and Lock after are hidden. A master password can be added or removed later (`setMaster`, `removeMaster`). The page also has a strength meter, generator options (length, numbers, symbols), weak and reused badges with filters, and copy username.
- **Extension side panels** dock beside the page by default (`extensionSidePanels: 'beside'`), as the popover closed whenever the page was clicked, which is how Sider is used. `chrome.sidePanel.onOpened` and `onClosed` now fire, to the extension's pages and its worker (`SIDE_PANEL_EVENT`). Sider itself wasn't installed here; only the test fixture ran.
- **Force dark pages** never worked: `WebContentsForceDark` is Chrome-only browser code. `forceDark.ts` now inverts light pages on `dom-ready` with a user stylesheet and flips pictures and video back, leaving pages with a dark background alone. Seven new fun flags: snowfall, starry night, rainbow loading, disco accent, neon address bar, squishy buttons, typewriter.
- **Print box** in the PDF viewer (`PrintDialog.tsx`, `main/printing.ts`): printer, pages, copies, layout, colour, two-sided, a live preview, Save as PDF through `printToPDF`, and a link to the system dialog. Ctrl P, the page menu and the toolbar open it on `sc://pdf`; other pages still get the system dialog. Real printers weren't tried; only Save as PDF was tested.
- **Bookmarks down the side** (`bookmarksLayout: 'vertical'`, default along the top): loose bookmarks as a grid of icon tiles and folders that open in place, inside the side tabs, or a column of their own with tabs on top. Neutral surfaces, no accent fill.
- **Sleep button** on tabs (`tabSleepButton`, off by default, in Settings > Appearance), and Sleep tab in the tab menu. `TabManager.sleep` hands the open tab to a neighbour first; the last tab can't sleep.
- **Manual tab groups:** Add to new group, Add to group and Remove from group in the tab menu; group headers fold on click (`collapsedTabGroups`, the open tab stays showing), rename on double-click, and have a menu with New tab in group, Ungroup and Close group. Horizontal tabs get a small header chip too.

**Version 0.4.2 is committed on `main` (2026-11-06) but not tagged, so it isn't published:** report presets and AI-written files, on sc://assistant only. The owner asked for these on the full-page assistant, not the sidebar or sc://ai, so the sidebar is unchanged. The beta is in `apps/desktop/release/0.4.2/`. One real request through scTerra AI wrote a working tap counter page that previewed correctly. Presets, the new report blocks and edits have only run against the mock AI.

- **Presets:** `REPORT_PRESETS` in `packages/shared/src/reportPresets.ts` (16 kinds). Each one adds layout instructions to the message, `shownPresetMessage` shows it back as "SWOT analysis: topic", and saved chats are titled the same way.
- **Report blocks and designs:** reports gained `stats`, `timeline`, `proscons`, `cards` and `steps` blocks, an optional `kind` label, and four designs (Modern, Magazine, Academic, Notebook) in `content.css`. These work in the sidebar too, as any report can use them. Word export turns the new blocks into tables and lists. There's a `--sc-success` token now, for pros and code strings.
- **Files:** `packages/shared/src/files.ts`. A reply writes a file in a ```` ````scterra-file name="x" ```` block, and changes it with ```` ````scterra-edit ```` FIND/REPLACE pairs. A FIND must match once (indentation is forgiven), or the edit fails and the file stays as it was. `conversationFiles` replays the conversation into versions. `FILE_INSTRUCTIONS` only goes to the model through `WORKSPACE_PROMPT`, which the main process picks when the request comes from sc://assistant. A page can't ask for it.
- **Previews:** `main/filePreview.ts` serves files on the `sc-preview:` scheme inside a sandboxed frame. They're stopped from reaching out by `PREVIEW_CSP`, which blocks every request, and by sc://assistant's own `frame-src sc-preview:`, which makes the frame fail with ERR_BLOCKED_BY_CSP if it tries to leave. `guardPreviewFrames` is a second line behind those, and on its own it hasn't been shown to stop anything. Plain http inside the frame is also stopped by Chromium as mixed content. Tabs refuse to open `sc-preview:` addresses. `e2e/aifiles.spec.ts` checks all this with a real https server, turning off HTTPS-only, which would otherwise hide whether the preview is what stopped it. A frame that tries to leave is left on Chromium's error page until Run again.

Version 0.4.0 is published (2026-11-05, tag on `1b27e29`), for Linux, Windows and both kinds of Mac, and `latest-mac.yml` lists both Macs. It was asked for in the same message as its last fixes, so the owner tested everything but those fixes first: the row alignment, Google translation and the extensions panel. Ask how those went. It adds pinned tabs, tab mute and sound icons, tab search, a split view divider, a fuller page menu, view source, spell check, Open file, `javascript:` addresses, app links, several windows, installed sites, the Task Manager, docked developer tools, save offers while locked, address autofill, turning extensions off, a translate language menu, internal page icons, an update screen, an extensions list and panel, and self-updating on Macs. Nothing has run on Windows or a Mac, and Mac self-updating has never been tried for real, so check it the first time a Mac updates to the next version.

Before that, version 0.3.4 was committed and tagged after the owner tested the AppImage and said it works. Which extensions they tried wasn't recorded. Check the release finished before saying it's published.

What 0.3.4 changed:

- **Extensions menu:** a toolbar button lists every extension, to open, pin or remove. Unpinned extensions leave the bar.
- **Side panels, new tab pages and popup windows** from extensions work, and links from extension pages open as tabs (see the notes on `chrome.sidePanel` below).
- **Extension tabs** come back after a restart, and `chrome-extension://` addresses can be typed in the address bar.

Version 0.3.3 was committed and tagged after the owner tested the AppImage and said it works, including the Chrome Web Store and signing in. It's published for Linux, Windows and Intel Mac. It has no Apple silicon Mac build: that runner sat queued again, as it did for 0.3.1, so the owner asked to go without it and the run was cancelled. Check the next release builds both Macs.

What 0.3.3 changed:

- **Google sign-in uses Electron's own identity** (see "Google sign-in" below).
- **Pages that pass through sign-in open.** Calling `setUserAgent` during a navigation made Chromium reload the page and drop the navigation, which broke the Chrome Web Store for signed-in people. The identity is now set per request in `googleSignIn.ts`, and `preload/internal.ts` gives scripts on those pages the matching value before they run.
- **Popups keep their link to the page that opened them.** `TabManager.adoptPopup` shows the real window as a tab, closes it on `window.close()`, and returns to the opener. Tabs in a popup pair don't sleep.
- **Screenshots** retry when Chromium's capture rejects with `UnknownVizError`, save before touching the clipboard, and say so if they fail.
- **Tracker blocking** holds requests for up to 5 seconds while the filter engine loads, and the blocked count resets when navigation starts.
- **End-to-end tests:** 123 down to 101, removing those that overlap most with others. Only the vless and ss kinds still make real Xray connections. They run in parallel: 3 workers locally, 2 on Linux CI, 1 on Windows CI, where two at once timed out starting apps. `e2e/app.ts` passes `--no-proxy-server`, as the owner's VPN had been catching test traffic.

Still to ask the owner: has a copy on an older version updated itself? No update between published versions has been confirmed.

Known flakes: `performance.spec.ts:82` (a sleeping tab not sleeping) failed once in a full run on 2026-11-08 and passed alone. `phase7.spec.ts:235` (the narrow toolbar) failed twice in full runs on 2026-11-07, waiting for the window manager to apply a resize, and never alone or under a smaller load, on this build or 0.4.3's. `omnibox.spec.ts:51` failed about 1 in 16 under parallel load, with nothing focused, and `phase7.spec.ts:111` once in a full run, with the drag not landing. Neither repeated on its own. `privacy.spec.ts:21` fails about 1 run in 75 under parallel load, showing 1 blocked instead of 2. `assistant.spec.ts:142` failed once in a full run. The cause of each isn't known. CI retries cover them.

## How to work with the owner

- Never commit, push or tag on your own. The owner tests the AppImage first, then tells you to commit and rebuild, even if an earlier message in the chat asked for a release. An instruction to commit only covers that round. Work directly on `main`. A coworker also commits there, so pull first. `theme.html` in the root is the owner's scSpace style reference: don't commit it.
- Commits need `git -c user.name=... -c user.email=...` using the last commit's author, as no git identity is set on this machine.
- The owner plans to make this repo public. Until it is, CI's minutes count against their GitHub Actions allowance, so avoid needless pushes. `macos.yml` stays manual, and each release uses minutes too, mostly for the Mac builds.
- Don't spend their AI credit without asking. Live requests to the hosted server use real keys.
- They want it modern but not "vibe coded": follow the design rules in Plan.md and use tokens, not raw colours or sizes. They've pulled back glass, pills and big shadows once already: flat surfaces with thin borders, 4/6/10 radii, glass only on popups and new tab cards.
- Report honestly what was and wasn't tested. Say so when something only ran against mocks.
- Rebuild the Linux beta after a round of changes, and tell them where it is. Run `build` before `electron-builder`, which packages whatever is already in `out/`.
- Signing, store distribution and extra update channels are on hold until they say otherwise.
- Their desktop is Kubuntu (KDE Plasma) with a Windows-style theme, so screenshots can look like Windows. They test the packaged Linux build. Nobody has tried a Windows or Mac build yet.
- They care a lot about polish. Check new UI on screen, as Playwright screenshots, before saying it's done. When they say a control was moved, they mean its place in the toolbar: Assistant, Profiles and More sit to the right of the address bar.
- They usually send a list of changes with screenshots. Work through all of it, then say plainly what couldn't be checked.

## Commands

pnpm isn't installed globally, so use `npx pnpm@10.34.9`.

```bash
npx pnpm@10.34.9 dev
npx pnpm@10.34.9 typecheck
npx pnpm@10.34.9 test
npx pnpm@10.34.9 build
npx playwright test --timeout 20000
```

To keep the test windows off the desktop, run them on an invisible KDE screen instead (extra arguments go to Playwright). The full suite passed this way on 2026-11-08, in about 3 minutes:

```bash
e2e/hidden.sh
```

Build first, because E2E tests run the built app. The suite has 207 tests and takes about 4 minutes locally, and there are 354 unit tests. To build and test the packaged app, fetch the Xray VPN core once first. Packaging stops if it's missing:

```bash
node apps/desktop/scripts/fetch-xray.mjs
```

```bash
cd apps/desktop && npx electron-builder --linux AppImage deb
```

```bash
SCB_E2E_EXECUTABLE="$PWD/apps/desktop/release/0.4.6/linux-unpacked/scterra" npx playwright test --timeout 20000
```

The beta lands in `apps/desktop/release/<version>/`, which git ignores. CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests, on Linux and Windows, plus a Deno job for `server/`, and uploads installers as artifacts. `macos.yml` is run by hand from the Actions tab, as a private repo's macOS minutes count ten times over. `release.yml` runs on a `v*` tag. See [docs/auto-update.md](docs/auto-update.md).

Deno isn't installed. To run server tests locally, use the npm package `deno`, then `deno test --allow-env` inside `server/`.

## Layout

| Path | Contents |
|---|---|
| `apps/desktop/src/main` | Main process: `window.ts` wires everything, `systemProxy.ts`, `tun.ts`, `passwords.ts` (vault), `passwordFill.ts` (fill and save-offer scripts), `reportExport.ts`, `reportDocx.ts`, `updater.ts`, `httpAuth.ts`, `private.ts`, `siteIcons.ts`, `internal/pdf.ts`, `tabs/TabManager.ts`, `ipc.ts`, `internalIpc.ts`, `overlay.ts`, `ai/`, `privacy/`, `storage/`, `import/`, `extensions.ts`, `extensionPanel.ts`, `blocker.ts`, `vpn.ts`, `sync.ts`, `reporter.ts`, `profiles.ts`, `flags.ts` |
| `apps/desktop/src/preload` | Bridges: `index.ts` (browser UI), `overlay.ts`, `internal.ts` (sc:// pages only) |
| `apps/desktop/src/renderer/src` | Browser UI in `components/`, overlay UI in `overlay/`, sc:// pages in `internal/` (the intro is `internal/welcome/`), shared between both in `shared/`: `ReplyContent.tsx`, `ReportPane.tsx` (the side page), `ResizeHandle.tsx` |
| `packages/shared` | IPC contracts, settings, omnibox logic, reports, privacy helpers |
| `packages/ai` | Providers, prompts, parsers for AI tasks. No Electron |
| `packages/ui` | Tokens, Tailwind theme, components, `content.css` (replies and report themes) |
| `server` | Hosted AI service. Live on Cloudflare Workers at `https://scterra-ai.scspace-dev.workers.dev` (`worker.ts`); the Deno version (`main.ts`) at `https://sc-delta-ai.scspacedev.deno.net` serves 0.4.6 and earlier |
| `e2e` | Playwright tests. `app.ts` is the harness, `aiMock.ts` fakes OpenAI and Anthropic servers |

## Architecture rules

- The main process owns all state. Every IPC channel is declared in `packages/shared/src/ipc.ts` and validated in the main process.
- Tabs are sandboxed `WebContentsView`s. Native views draw above the browser UI, so popups that cover a page must go in the overlay view (`overlay.ts` and `renderer/src/overlay`).
- `sc://` pages get `window.scbInternal`, and the main process checks the calling frame. Websites must never reach them: navigation, redirects, iframes and `window.open` are all blocked.
- Page content is untrusted. It's read in isolated worlds and wrapped in `<page>` tags. Replies never render images or raw HTML.
- API keys stay in the main process, encrypted with `safeStorage`. Never send them to a renderer. Use only its async calls (`encryptStringAsync`, `decryptStringAsync`, `isAsyncEncryptionAvailable`): with KDE Wallet the old synchronous ones report no encryption at all, which stopped VPN links saving. Dev builds use `basic_text`, so only packaged builds show this.
- Parsing PDFs happens in a separate utility process, never in the main process.
- The new tab picture reaches `sc://newtab` only through the internal bridge, so it has no address a website could load. It stays in the profile folder and isn't synced.
- The sync folder only ever holds ciphertext. The passphrase isn't stored, and the derived key is kept with `safeStorage`.
- Crash reports and usage stats are opt-in, and hold no addresses, titles or error messages. `scrubStack` removes folders and messages.
- Page loads are screened in `PrivacyService.attach`, before anything is sent. Category checks hold the load for up to 6 seconds, then let it through.
- VPN links hold passwords, so they stay encrypted in the main process and never reach a renderer. The toolbar and `sc://vpn` only see names, hosts and ports.
- Site icons are saved as data addresses in `site_icons`, only for bookmarked hosts, so drawing the bar contacts nobody. Sites that were never visited are asked for `/favicon.ico` once per run.
- Private windows skip history and icon saving, and take no AI keys. They're separate processes with their own throwaway folder. Other windows, including installed sites, share one process.
- `browserCore.ts` holds what exists once per process (VPN, vault, sync, updates, downloads, privacy, extensions, permissions, the session saver), and `window.ts` builds each window on top of it: its tabs, overlay, browser UI and assistant. Every chrome and overlay channel goes through `ipcRouter.ts`, which picks the handler by sender and refuses anyone else, as Electron allows one handler per channel. Tab ids are unique across windows. A window closed by itself doesn't come back after a restart, but all the windows open when quitting do (`session:extra-windows` in the database).
- Developer tools sit in their own `WebContentsView` beside the page, as Electron's docking only works for full windows. They must be opened with `mode: 'detach'`, or DevTools opens its device toolbar as a separate window. `isDevToolsOpened` stays false in this mode and `devtools-closed` comes late, so `TabManager` keeps its own record.
- The coding agent only reaches files inside the folder the person chose, and asks before changes (unless they let edits through) and before every command. Never let another page call `coder:*`.
- Installed sites (`webApps.ts`) are windows of kind `app`: one tab, a slim bar, no tab strip. `TabManager` hands anything that would open a tab to the full browser. Their shortcuts run the browser with `--sc-app=<url>`, http and https only.
- Agent mode needs approval for every click, entry and navigation. Private fields are refused in `ai/agent.ts`, not left to the model.
- Nothing goes to an AI provider unless the person acts. Respect the per-site AI off list.
- The address bar's answer card only runs once someone picks Ask scTerra, and never includes page text.
- HTTP sign-in passwords go straight to Chromium and are never stored. The box closes if the page navigates away, so it can't sit over another site.
- OCR runs in the sandboxed `sc://pdf` page from files in the app (`public/ocr`, copied at build time). No scan leaves the computer.
- Workspaces: `TabManager.snapshot()` only returns the open workspace's tabs, so the UI needs no filtering. Use `allContents()` for anything that must reach every tab.
- The password vault is sealed with a key derived from the master password, which is never stored; the key and logins only exist in memory while unlocked. Passwords reach a renderer only through `passwords:reveal` on the `sc://passwords` bridge, never the browser UI or overlay (the login list under fields shows usernames only). Filling is by request (the key menu or the list under a field), or by itself on load when the owner's `passwordAutoFill` is on and exactly one login matches, always top frame only, with the origin rechecked at that moment. Save offers count only real clicks and keys, and hold the login in the main process for a minute at most. They also watch pages while the vault is locked or not set up (the owner chose this; `passwordOfferLocked` turns it off). The vault can't say what's saved until it's open, so while locked the offer may be for a login it already has. Addresses and details (`Identity`) are sealed in the same vault, reach only `sc://` pages through `autofill:list`, and fill only on request, top frame only, leaving non-empty fields and anything that looks like a card, login or ID alone. There's deliberately no card autofill. It never syncs and isn't in private windows.
- A native page view swallows mouse events over itself, so `layout:resizing` hides it while a sidebar is dragged.
- Google sign-in pages (`accounts.google.com`, `accounts.youtube.com`) see Electron's own user agent, without the app's name, in the header and to scripts, along with whatever they load. Every other site sees the clean Chrome one. Never call `setUserAgent` on a tab during a navigation, as Chromium reloads the page and drops the navigation: `googleSignIn.ts` sets the header per request, and `preload/internal.ts` sets what scripts read. Electron keeps only one listener per `webRequest` event per session, so anything else needing `onBeforeSendHeaders` has to share this one.
- Links and `window.open` from websites become tabs. Unless they ask for `noopener` or open in the background, the tab holds the real popup, and `window.opener` works. `window.close()` shows up as the `close` event on its `WebContents`, not `destroyed`. `sc://` stays unreachable from them.
- Tooltips on `sc://` pages are Radix, in the document. They must keep `pointer-events: none`, or they take the clicks of whatever's under them. The browser UI's tooltips are in the overlay and clear when the pointer moves.
- Word files are rebuilt in the main process from the report's blocks through `toReport`, so only plain text reaches them. There's no docx dependency: `reportDocx.ts` writes the zip itself.
- Saved reports are built by `reportHtml`, which escapes all text and carries a CSP blocking scripts and network requests. PDFs print that same file in a hidden window with scripts off.
- The VPN defaults to just the browser. Whole-computer modes must always undo themselves: the system proxy's old values are saved before changing it and a watcher process restores them after a crash; the TUN script runs as root and removes its routes when its stdin closes. Never start either without the person choosing it. These settings stay out of sync (`LOCAL_SETTINGS`). Connect-at-start holds pages on a dead proxy port (`holdPages`) before any tab loads, and failing stays closed on purpose: the person asked to always be covered.
- `javascript:` addresses only run through `openAddress` in `window.ts`, which is reached from the browser UI and its menus, and never on `sc://` pages. `TabManager.navigate` and `create` refuse them, so extensions can't use them (the AI agent only accepts http and https), and the address bar strips the prefix from pasted text.
- App links (`claude://`, `mailto:`) go through `appLinks.ts`. Pages reach it from the `openExternal` permission, which is always refused so that the app opens them itself after asking. `NOT_APP_SCHEMES` in `url.ts` lists schemes that never open. "Always allow" is per site and scheme, saved in the permissions table as `app:<scheme>`, and shown in Settings.
- Page translation goes to Google by default, through the address Chrome's dictionary extension uses (`ai/googleTranslate.ts`). It isn't a published API: `translate.googleapis.com` was already refusing this machine with a 429 on 2026-11-05, and this one could go the same way. Only asked-for pages go, and Settings says so. The AI model stays as an option, and failing Google never falls back to spending AI credit.
- Extensions open in `extensionPopover.ts` by default: one `WebContentsView` hanging from the toolbar button, closing when focus moves on, used for popups, side panels and `chrome.windows.create`. Its border is drawn in the overlay, with the view stacked above it (`Overlay.above`). The list under the button is an overlay popup. `extensionDisplay: 'window'` brings back the library's popup windows, docked side panels and small windows.
- Claude calls use the official SDK (v1.3, which sends keys as `Authorization: Bearer`). Other providers use the OpenAI-compatible adapter.

## Releasing and updates

Installers and update files go to the public `sc-simpledev/scTerra` repo (renamed from scDelta on 2026-11-03). The source never goes there. Details are in [docs/auto-update.md](docs/auto-update.md).

1. Set `version` in `apps/desktop/package.json`, commit and push.
2. Wait for CI to pass on `main`, as a release doesn't wait for it. Then tag to match and push the tag, with the `git -c user.name=... -c user.email=...` identity: `git tag -a v0.3.4 -m "scTerra 0.3.4"`, then `git push origin v0.3.4`. Only a tag publishes. Pushes to `main` just run CI.
3. `.github/workflows/release.yml` checks the tag against the version, builds Linux, Windows and both kinds of Mac into a draft release using the `RELEASE_TOKEN` secret (already set), and publishes the draft only once every build succeeds.
4. Watch it with `gh run list --workflow release.yml`, and check the release appeared with `gh release list --repo sc-simpledev/scTerra`.

The app checks for updates 30 seconds after starting and every 4 hours (`apps/desktop/src/main/updater.ts`). AppImage replaces itself; Windows installs on restart; .deb asks for a password when Restart to update is pressed; unsigned Macs replace their own app bundle through `macUpdate.ts`, which skips Squirrel.Mac as that refuses unsigned updates, and fall back to the release page if they can't. Settings has a switch and Check now.

## Hosted AI server

Since 2026-11-09 the browser's `HOSTED_AI_URL` in `packages/shared/src/ai.ts` is `https://scterra-ai.scspace-dev.workers.dev/v1`: the Cloudflare Worker `scterra-ai`, deployed with `npx wrangler deploy` from `server/` (`worker.ts`, `wrangler.toml`). Keys and route settings are Wrangler secrets. Limits are shared through one Durable Object, `Limits`. Versions up to 0.4.6 still use the Deno Deploy app (`server/main.ts` as the entrypoint from the repo root, `https://sc-delta-ai.scspacedev.deno.net/v1`), so keep it running until people have updated. Both run the same code in `server/src/`.

Routes come from `API_KEY_n`, `MODEL_n`, `REASONING_n`, `BASE_URL_n`, `WEIGHTING_n` and `FORMAT_n`. Two or more routes means random weighted routing, with failover before any text is sent. `BASE_URL_n` includes `/v1` for OpenAI format and leaves it out for Anthropic format. Limits and details are in [server/README.md](server/README.md). The Worker returned a real streamed reply on 2026-11-09 with one route; failover and the limits were only tested locally (`npm test` in `server/`, fake providers).

## Google sign-in

Published 0.3.2 told Google's pages it was Firefox, and the owner still got "This browser or app may not be secure". With Electron's own identity (0.3.3), the owner confirmed signing in works.

Why that failed, from two other Electron browsers that measured this against the live site in October 2026 ([Mise PR 19](https://github.com/Rakosn1cek/Mise-browser/pull/19), [Orca PR 36519](https://github.com/stablyai/orca/pull/36519)):

- A clean Chrome identity is rejected: Google then runs its full Chrome checks, which Electron fails. That's also why the original setup failed.
- A Firefox identity is rejected often, as the page can see it's really Chromium. A faked Google Chrome with full client hints was also rejected.
- Electron's own identity passed every time in both: Orca 4 of 4, and 4 of 4 on the redirect from "Sign in with Google", Mise through to a full sign-in in a packaged Linux AppImage on X11.
- It also fits [Google's guidance](https://developers.googleblog.com/guidance-to-developers-affected-by-our-effort-to-block-less-secure-browsers-and-applications/), which says a browser must identify itself and not use another browser's user agent.

To check it: open `accounts.google.com`, enter an email, press Next. Getting to the password step, or "Couldn't find this account", passes. `/v3/signin/rejected` fails. The check runs at the email step. Neither project reported on passkeys or two-step verification.

If Google starts refusing again, in the order to try them:

1. **Check for a second cause first:** Mise's first bug was another `webRequest` listener silently replacing theirs. Compare with Orca's and Mise's hosts and flow, and whether scTerra's privacy rules touch the page. Mise also rewrites `GlifWebSignIn` to `WebLiteSignIn`, which it calls mostly redundant.
2. **Use Electron's identity everywhere:** this passed for Orca, but it revoked sessions on other sites such as x.com and LinkedIn, so it's a last resort.
3. **Sign in through a real browser:** Google's supported route for embedded apps is OAuth in the system browser. That only gives an app access to Google's APIs. It doesn't sign the tabs in to Gmail or YouTube, so it wouldn't solve this alone.
4. **Importing cookies from Chrome** is fragile and touches other people's saved sessions. Avoid it unless the owner decides otherwise.
5. **Say it isn't supported,** and offer the sites that work.

Passing Google's check may stop working at any time, as it's Google's to change.

## Flags

`BROWSER_FLAGS` in `packages/shared/src/containers.ts` lists them, kept in `flags.json`. The ones marked `fun` become `data-flag-<id>` on each page's root (`renderer/src/shared/funFlags.ts` and `.css`), so most are only CSS. They take effect after a restart and must never take clicks.

## Status

Version 0.4.1. Phases 0 to 5 are built, apart from signing, stores and extra update channels, which are on hold. Since then: site blocker, VPN with a bundled Xray core, whole-computer VPN (system proxy or TUN), VPN connect at start, fastest pick and skip list, bookmark folders and icons, a built-in password vault, private windows, the PDF viewer, the scSpace look, auto-updates, the first-run intro (night and daytime scenes, "Browse the World"), workspaces, tab clean-up, inline address bar answers, HTTP sign-in, OCR for scanned PDFs, saved zoom, split view restore, a report side page with versions, change requests, designs and PDF, HTML, Markdown and Word downloads, a saved-chat list, a draggable toolbar, resizable sidebars, a profiles button, bookmark overflow, a compact toolbar for narrow windows, and macOS builds. See Plan.md for what each does.

0.2.0, 0.3.1, 0.3.2 and 0.3.3 are published at https://github.com/sc-simpledev/scTerra/releases. `release.yml` now creates one draft before building. 0.3.1 was the first release through that fix, and the first real update from one published version to another, so ask the owner whether their 0.2.0 picked it up. 0.3.1 has no Apple silicon Mac build: that runner sat queued, so the owner chose to publish without it, by cancelling the run and running `gh release edit v0.3.1 --repo sc-simpledev/scTerra --draft=false --latest`. Intel Mac, Linux and Windows are there. 0.3.2 built everything into one release, so the single-draft fix works. 0.3.0 was never published: its release run was cancelled over an error on closing the browser, and its draft is deleted. Only a `v0.3.0` tag remains, in the private repo. A release doesn't wait for CI, so let CI pass on `main` before tagging.

**Next ideas the owner hasn't taken up yet:** a live test with a real AI model (needs their OK, as it spends credit), citations linking replies to their tabs, research across several tabs into one report, a reading list with AI summaries, and sign-in for the hosted server. DRM stays their decision.

Open items:
- CI: E2E failures used to stop the installer step, which looked like a broken build. Installers now build regardless, and CI retries flaky tests twice.
- A real AI provider hasn't been used through the browser UI. Everything in the app was tested against mocks, so reports, agent mode, translation, inline answers, AI tab clean-up and the scAI identity need real-model checks.
- DRM (Netflix, Spotify) isn't in. It needs castLabs' Electron, whose newest stable build (44.9.3 in November 2026) is behind our 45.1.0, plus VMP signing for Windows and macOS. It was never run here. Don't swap the engine without the owner's say.
- Copies older than 0.2.0 can't update themselves, so they need one manual install.
- macOS has never been run, including its self-update in `macUpdate.ts`. Windows and .deb updates are also untested. Only an AppImage update has been done for real.
- Whole-computer VPN: the TUN script was run for real in a throwaway network namespace (traffic, DNS and clean-up all worked), and system proxy against the real KDE and GNOME tools in a scratch config. Neither has run through pkexec or against the real desktop settings, so ask the owner to try both. Windows and macOS system proxy have only run against fake commands. TUN is Linux and macOS: Windows needs the wintun driver. Two profiles could fight over the system proxy; that isn't handled. Switching connections under TUN asks for the password again.
- The report side page takes its room from the page, so a narrow window leaves little of the page showing. The chosen design isn't saved with a chat, and is forgotten when the side page closes. Versions are matched by title, so a model that renames a report starts a new set.
- Dragging a sidebar was only tested with Playwright's mouse, which never crosses the native page view. Hiding the page during a drag is meant to make that work, so ask the owner to try it with a real mouse. The page area goes blank during the drag. Hiding the page drops pointer capture mid-drag, which is why `ResizeHandle` listens on the window.
- CI artifact storage hit its quota on 2026-11-03. Artifacts now last 5 days and a failed upload no longer fails CI, and the old ones were deleted that day. GitHub recalculates usage every 6 to 12 hours, so uploads may fail until then. Releases don't use this storage.
- The password vault's fill and save offer were tested on simple local sign-in pages only, not real sites. Pages with sign-in forms in iframes (some banks, some single sign-on) won't fill or offer, and multi-step sign-ins may save without a username. Bookmark imports don't bring folders.
- Bookmark folder order doesn't sync, only names, membership and nesting.
- The intro has night and daytime scenes, following the theme. It was checked on an Intel GPU at 1320 by 860, and falls back to a plain gradient without WebGL 2.
- Clicks landing below a button: the owner reported this on 0.3.1. The likely cause, hoverable tooltips on `sc://` pages, is fixed in 0.3.2, and a scan of the browser UI and `sc://` pages found nothing else covering a button at rest. It couldn't be tried with a real mouse, so ask whether it's gone, and where if not.
- The overlay takes clicks wherever it's drawn, and has no way to let them through. Keep popup regions tight: tooltips only cover their own bubble and clear as soon as the pointer moves. The fix for the Settings link needing a click below it couldn't be tried with a real mouse here, so ask whether it's gone.
- Window buttons are drawn over the top right of the window. `sc-wco-inset` keeps bars clear of them with margins, as a bar's own padding utilities would override padding. A test checks More stays clear.
- The taskbar icon was blank on KDE. The window now sets its own icon (`build/icon.png`), but whether KDE shows it hasn't been confirmed.
- DRM: see above. The Widevine build couldn't be run here: the permission system blocks running downloaded binaries.
- Assistant, Profiles and More are fixed at the end of the toolbar. Below 760 pixels wide (`compact`), spare buttons move into More and the sidebar becomes a rail.
- Extensions are a supported subset of Chrome's APIs. Bitwarden's install, background worker and popup were tested live; its sign-in and autofill weren't. Firefox extensions can't run.
- `chrome.sidePanel` is our own, from `preload/extensions.ts` and `extensionPanel.ts`: the library and Electron don't have it. That preload must be registered before the library's, which freezes `chrome`. Electron strips `side_panel` from the manifest it returns, so it's read from `manifest.json`. A panel stays open across tabs rather than belonging to one, and `onOpened` and `onClosed` never fire. The automated tests use small fixtures, not real store extensions.
- In the main process, `URL` gives `chrome-extension://` addresses an origin of `null`. Compare hosts instead.
- A new tab page from an extension (`chrome_url_overrides.newtab`) keeps `sc://newtab` as the tab's address, so it still counts as a new tab everywhere. `chrome.windows.create` opens a real small window for `popup` and `panel` types; other types open as tabs, and `windows.remove` ignores the main window.
- VPN checked live against the FastNodes list: real TLS and Reality nodes carried traffic, but most public nodes are dead, and Xray itself refuses VLESS and Trojan without TLS to public addresses. Ping is a real request through each connection, so free lists mostly show Not working. That's accurate.
- Sync goes through a folder, not a server, and was tested between two simulated devices, not two computers.
- The server's `/v1/reports` route needs deploying before reports go anywhere. Native crash dumps aren't collected.
- The accent tint is off by default, using `data-tint` on the root. Glass is only for popups and new tab cards.
- With the sandbox on, a page that segfaults didn't reach the crashed-page screen under Playwright, though one that's killed did. Check this by hand in a real build.
- Phase 0 remaining: Storybook, token lint rule, Style Dictionary.
- Saved permissions are shared across containers.
- The app was renamed from scDelta on 2026-11-02. The profile is copied on first launch and the old folder stays, but the rename changes the system keychain entry, so AI keys, VPN links and the sync key need adding again. The old `scdelta` package has to be uninstalled by hand.
- Names deliberately left alone: `sc-simpledev/scBrowser` (private repo, which Deno Deploy and the coworker's clone point at), `@scbrowser/*` packages, the hosted address `sc-delta-ai.scspacedev.deno.net`, the `scdelta-sync.bin` file so sync keeps working, and reading old `scdelta-report` blocks in saved chats.
- The hosted server has IP limits but no sign-in, so it can be used as a free API from outside the browser.

## Test pitfalls

- The owner may have whole-computer VPN on while you work. Then this machine's system proxy is set and `HTTP_PROXY` is in the environment. Check before blaming the code, and never turn it off for them. `ProxyType` in `kioslaverc` shows it, and `/opt/scTerra` means their .deb is running.
- When comparing against earlier code, run the last packaged build with `SCB_E2E_EXECUTABLE` rather than stashing.
- Tests run in parallel, each with its own app and profile, but the system clipboard is shared. CI on Windows runs one at a time.
- `accounts.google.com` is preloaded as HTTPS-only in Chromium, so a local HTTP test can't reach it. Use `SCB_SIGN_IN_HOST` with `--host-resolver-rules`, as `e2e/phase9.spec.ts` does, and turn `httpsOnly` off.
- `--repeat-each=25 --retries=0` finds flakes quickly. Trace each step before believing a cause: the screenshot flake looked like the clipboard and wasn't, and the tracker flake looked like slow filter loading but was mostly the count being reset.
- Don't rely on hover in tests: on CI's display, stray pointer moves can dismiss a tooltip before it opens. Send `pointermove` straight to the element with `dispatchEvent`. `focus()` doesn't work either, as Playwright's page view doesn't have real focus.
- CI windows have no focus, unlike a run on the owner's desktop. `BaseWindow.getAllWindows()[0].blur()` gets close to it locally, as `xvfb-run` isn't installed here.
- Local runs print uncaught main-process errors without failing, so read the output as well as the totals.
- Native menus and save dialogs can't be driven by Playwright. Replace `Menu.buildFromTemplate` or `dialog.showSaveDialog` through `h.app.evaluate`, as `e2e/phase8.spec.ts` and `phase5.spec.ts` do.
- `h.page(text)` matches any part of a page's address, including the app's own path, so a route called `/app` finds the wrong page.
- `go(h, ...)` reuses the current tab, so a page object from before it now points at the new page.
- Never test whole-computer VPN against the real system settings. Use `XDG_CONFIG_HOME` and `GSETTINGS_BACKEND=keyfile` for system proxy, and `unshare -Urnm` for the TUN script. The repo path contains an apostrophe, which breaks single-quoted shell scripts.
- A controlled radio that only updates after an IPC reply fails Playwright's `check()`, so update local state first.
- Playwright's simulated keys don't reach `before-input-event`. Use `shortcut()` from `e2e/app.ts` for browser shortcuts.
- Playwright clicks don't move native focus between views. `toBeFocused` also only checks DOM focus, so check `getFocusedWebContents()` when real keyboard focus matters.
- `app.firstWindow()` may be the overlay, so use the harness's `chrome` page.
- Playwright forces light mode unless launched with `colorScheme: null`.
- Screenshots of the browser UI don't include native page views, so the page area appears blank.
- First-run tests need `SCB_WELCOME=1`, as the intro is off under `SCB_E2E`. `SCB_UPDATE_URL` points updates at a local feed, under `SCB_E2E` only.
- Don't name a process in the same shell command that `pgrep -f` or `pkill -f` looks for it: the command matches itself and kills the shell.
- Tests set `SCTERRA_AI_URL=off` and use `SCB_FILTERS` to avoid the network. Web search needs `SCB_SEARCH_URL` and `httpsOnly: false`, or it reaches DuckDuckGo. Locators like `getByLabel('Logins')` also match the password options' labels: use the region role. `SCB_E2E` exposes `scbTabs`, `scbActions` and `scbExtensions` on the main process.
- Playwright turns the sandbox off, and service worker extensions then lose the extra `chrome.*` APIs. Launch with `SCB_E2E_SANDBOX: '1'` for those tests.
- VPN tests get `<-loopback>` in the bypass rules under `SCB_E2E`, so local servers go through the proxy.
- `e2e/xray.spec.ts` makes real connections through a local Xray server, and is skipped if the core hasn't been fetched.
- `SCB_VPN_PROBE=host:port` points VPN pings at a local page. `serveSite` answers `/generate_204`.
- Pages fill the window edge to edge, with no inset or rounded corners (`PAGE_RADIUS` is 0).
- `electron-chrome-extensions` calls every tab it's told about the active one. `ExtensionManager.addTab` keeps that from reaching the real tabs, which is what makes background tabs stay in the background.
- `setSpellCheckerLanguages` turns spell checking back on, so `setSpellCheckerEnabled` has to come after it.
- Playwright doesn't list `view-source:` tabs as pages. Ask the tab with `executeJavaScript`.
- Don't take desktop screenshots with spectacle: it can capture the owner's own windows.
- `pkill -f` patterns can match your own shell. Use `pgrep -f "dist/electro[n]" | xargs -r kill -9`.
- Code running during shutdown must guard against the destroyed window and closed database.
- An unexplained session-restore test failure and a history shortcut failure each happened once, in full runs. Neither recurred after repeats, so watch for them.
