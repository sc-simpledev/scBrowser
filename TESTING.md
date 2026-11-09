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
