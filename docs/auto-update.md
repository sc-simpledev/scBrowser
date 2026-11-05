# Auto-updates through the public repo

Automatic updates for the AppImage, .deb, Windows and macOS builds, while the source stays in the private `scBrowser` repo.

| Repo | Visibility | Holds |
|---|---|---|
| `scBrowser` | Private | All source code and CI |
| `sc-simpledev/scTerra` | Public | GitHub Releases containing only installers and update files, plus a short README |

The app uses `electron-updater` in `apps/desktop/src/main/updater.ts`. It checks 30 seconds after starting and every 4 hours, reading the public release, so it needs no token and no source access.

## Publishing a version

Do this once: create a fine-grained GitHub token limited to `sc-simpledev/scTerra`, with Contents read and write, and store it as the `RELEASE_TOKEN` secret in `scBrowser`. It must never be in the app.

For each release:

1. Set `version` in `apps/desktop/package.json`.
2. Commit, then tag it to match, such as `v0.2.0`, and push the tag.

`.github/workflows/release.yml` checks the tag, builds every platform into a draft release, and publishes the draft once all of them succeed. Browsers only ever see a finished release.

## What each format does

| Format | How it updates | Status |
|---|---|---|
| AppImage | Replaces itself in place | Tested for real, from 0.2.0 to a local 0.2.1 |
| Windows NSIS | Downloads in the background, installs on restart | Untested. Unsigned builds trigger SmartScreen warnings on first install |
| .deb | Downloads, then installs with `pkexec` after pressing Restart to update, so it asks for a password | Untested. A signed apt repo could remove the prompt later |
| macOS | Downloads the zip, checks it, and replaces its own app bundle when it quits (`macUpdate.ts`) | Never run on a real Mac. Squirrel.Mac refuses unsigned updates, so this doesn't use it. Falls back to opening the release page when the app can't be replaced, or the release has no build for that kind of Mac |

Copies older than 0.2.0 have no updater, so those need one manual install. Macs on 0.3.4 or older only know how to point at the release page, so they need one manual install too.

Each Mac build uploads its own `mac-update-<arch>.yml`, and the release's publish job merges those into `latest-mac.yml` with `scripts/merge-mac-update.mjs`. Publishing a draft by hand, as was done when a Mac runner stayed queued, skips that step, so `latest-mac.yml` then only lists whichever Mac built last and the helper files stay in the release.

## Still open

- **Mac app permissions.** macOS's App Management protection, or an install in a folder the person can't write to, may stop the swap. A failed swap puts the old app back and records that version, which then points at the release page instead of trying again.
- **Update checksums.** `electron-updater` and `macUpdate.ts` check SHA-512 hashes from the release's own files, which guards against damaged downloads but not against someone who gets write access to the public repo. Signing closes that gap. Keep the token narrow until then.
- **Channels.** There's one stable channel. Prereleases on the public repo can become a beta channel later.
- **Bundled Xray.** Updates are the only way it gets security fixes, so bump its pinned version in releases.
