const { spawnSync } = require('node:child_process')

/**
 * VMP signing for Widevine, with castLabs' free EVS service. Streaming services only hand licences
 * to a Windows or Mac app with a production VMP signature; Linux has no VMP, so it needs none.
 *
 * The signature has to go on before Apple's code signing on a Mac (afterPack) and after Authenticode
 * on Windows (afterSign), so electron-builder calls this twice and each platform acts once. Windows
 * builds aren't Authenticode-signed yet, and electron-builder skips afterSign then, so without a
 * certificate Windows signs at afterPack too.
 *
 * Needs EVS_ACCOUNT_NAME and EVS_PASSWD (an account made with `python3 -m castlabs_evs.account
 * signup`) and `pip install castlabs-evs`. Without them the build goes on with castLabs' development
 * signature, which plays on Linux and test servers only, and says so. SCTERRA_VMP=require makes a
 * missing signature fail the build instead, for releases.
 */
/** An Authenticode certificate electron-builder will sign Windows builds with. */
const windowsCodeSigned = () => !!(process.env.WIN_CSC_LINK || process.env.CSC_LINK || process.env.AZURE_TENANT_ID)

function sign(context, phase) {
  const platform = context.electronPlatformName
  const mac = (platform === 'darwin' || platform === 'mas') && phase === 'afterPack'
  const windows = platform === 'win32' && phase === (windowsCodeSigned() ? 'afterSign' : 'afterPack')
  if (!mac && !windows) return
  const required = process.env.SCTERRA_VMP === 'require'
  if (!process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWD) {
    const message = 'Widevine: no EVS account (EVS_ACCOUNT_NAME, EVS_PASSWD), so this build keeps the development VMP signature. Netflix, Spotify and the like will refuse to play on it.'
    if (required) throw new Error(message)
    console.warn(`  • ${message}`)
    return
  }
  const python = process.platform === 'win32' ? 'python' : 'python3'
  const run = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit', env: { ...process.env, EVS_NO_ASK: '1' } })
  if (run.status !== 0) {
    const message = `Widevine: VMP signing failed (${run.error ? run.error.message : `exit ${run.status}`}). Is castlabs-evs installed (pip install castlabs-evs)?`
    if (required) throw new Error(message)
    console.warn(`  • ${message}`)
    return
  }
  console.log(`  • Widevine: VMP-signed ${context.appOutDir}`)
}

module.exports = { sign }
