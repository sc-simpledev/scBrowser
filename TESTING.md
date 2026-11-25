# Manual test checklist

Nothing here can run in CI. Take a release build, tick what works, and note what doesn't. About an hour per machine.

## Windows and Mac (neither has ever been run by hand)

**Install and start**
- [ ] Installs and opens. On a Mac, the "trust this app" steps on the website match what's on screen
- [ ] The intro plays, or shows its last frame with animations off
- [ ] Toolbar spacing is even on a fresh profile
- [ ] Taskbar or Dock icon is right

**Self-update** (install the previous version first)
- [ ] It finds the update, downloads it and restarts into the new version
- [ ] Settings shows the new version afterwards

**VPN**
- [ ] Browser-only connection loads a page
- [ ] System proxy: another app uses it, and it's undone after turning off and after force-quitting scTerra
- [ ] TUN: the administrator prompt appears, another app's traffic goes through, and routes are gone after turning off
- [ ] Windows: wintun.dll loads (its checksum has never been confirmed by hand)

**Everyday**
- [ ] Sign in to Google. Reaching the password step counts
- [ ] Install an extension from the Chrome Web Store and open its popup
- [ ] Passwords save and autofill on one real site
- [ ] A site that reloaded forever on Windows no longer does

## Any machine, new in this round

**Terra Code, with a real model** (only ever run against the mock)
- [ ] With your own Anthropic or OpenAI key, tools run. Nothing should appear as JSON in the chat
- [ ] With Ollama and a model without tool support, it still works, falling back to text
- [ ] Run a command that changes files: they appear under Review, and Put back restores them
- [ ] Close scTerra in the middle of a chat, reopen the chat: it remembers its work, and Undo all still works
- [ ] Review: Keep and Put back on separate changes in one file

**Hosted AI**
- [ ] After the Worker is deployed and `HOSTED_NATIVE_TOOLS` is on: Terra Code on scTerra AI uses real tools

**Everything else**
- [ ] KDE taskbar shows the right icon with `desktopName` set
- [ ] Read aloud speaks a page, and stops when picked again. On Linux this needs speech-dispatcher, otherwise it says no voices are installed
- [ ] Encrypted DNS: pick Cloudflare, and pages still load
- [ ] VPN failover: turn it on, connect, kill the server, and it moves within about 90 seconds
- [ ] Padlock: Font changes the page's text and leaves icons alone

## New in 0.9.0

- [ ] After installing the .deb: scTerra has its icon in the app menu, and on a taskbar button pinned while it's closed
- [ ] Now playing: play a YouTube video or Spotify song, switch tabs; pause, play, picture in picture and speed work from the control
- [ ] "Float videos when you switch tabs" (Settings > Tabs and toolbar): a YouTube video floats when you leave its tab and comes back when you return
- [ ] Clean links: open a link with utm_source or fbclid from a newsletter or Facebook; the address loses them and the page still works
- [ ] Copy link to highlight: paste the link into another browser and it scrolls to the words
- [ ] Tab search (Ctrl Shift E): a word from inside another tab finds it, and Enter opens the find bar there
- [ ] Right-click an image on a real site, Ask AI about this image, and ask what it shows (needs a model that takes pictures)
- [ ] Search keywords: yt, wiki, gh, maps, ddg and one of your own
- [ ] Sync between two devices keeps the order of bookmarks on the bar and inside folders
- [ ] With your OK to spend credit: `SCB_REAL_AI=hosted e2e/hidden.sh e2e/realAi.spec.ts` (see the top of that file for your own key)

## New in 0.9.1

- [ ] Import from your real Chrome, Edge, Brave or Firefox: the folders come along, and bookmarks you already had stay where they were
- [ ] Bookmarks > Tidy up with Wi-Fi off: nothing is offered for removal as dead
- [ ] A mistyped address shows "The site's address couldn't be found" with ERR_NAME_NOT_RESOLVED under it
- [ ] Reader view (F9) on a real article: the title once, with site and reading time
