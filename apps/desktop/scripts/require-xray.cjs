const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** Stops a build that would ship without the VPN core, rather than quietly leaving it out. */
exports.default = ({ electronPlatformName }) => {
  const binary = electronPlatformName === 'win32' ? 'xray.exe' : 'xray'
  if (!existsSync(join(__dirname, '../resources/xray', binary))) {
    throw new Error('The Xray core is missing. Run: node apps/desktop/scripts/fetch-xray.mjs')
  }
}
