const { chmodSync, renameSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { sign } = require('./vmp-sign.cjs')

/**
 * castLabs' Electron (Widevine) stops before scTerra's own code runs when CHROME_DESKTOP is set, which
 * every Electron app sets for the programs it opens (castlabs/electron-releases#165). A link clicked
 * in Discord, Slack or VS Code would then fail to open scTerra at all. On Linux the real program
 * becomes `scterra-bin`, and `scterra` (what the AppImage, the .deb, menus and terminals start) is a
 * launcher that drops the variable first. build/apparmor-profile.tpl covers both names.
 */
function launcher(context) {
  const name = context.packager.executableName
  const real = join(context.appOutDir, name)
  renameSync(real, `${real}-bin`)
  writeFileSync(
    real,
    `#!/bin/sh
# Starts scTerra without CHROME_DESKTOP, which castLabs' Electron can't start with (see after-pack.cjs).
unset CHROME_DESKTOP
exec "$(dirname "$(readlink -f "$0")")/${name}-bin" "$@"
`
  )
  chmodSync(real, 0o755)
}

/** Before code signing: the Linux launcher, and VMP signatures for a Mac (and Windows without a certificate). */
exports.default = (context) => {
  if (context.electronPlatformName === 'linux') launcher(context)
  return sign(context, 'afterPack')
}
