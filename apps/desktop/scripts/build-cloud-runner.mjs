// Bundles Terra Code's cloud runner into one file with everything it needs, so a GitHub Actions job
// can run it with plain Node: `node runner.mjs task.json`. scTerra puts it in each cloud run's
// trigger branch. Runs after `electron-vite build`, into out/cloud/, which is packaged with the app.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(resolve(root, 'out/cloud'), { recursive: true })
await build({
  input: resolve(root, 'src/main/cloud/runner.ts'),
  platform: 'node',
  logLevel: 'warn',
  output: {
    file: resolve(root, 'out/cloud/runner.mjs'),
    format: 'esm',
    codeSplitting: false,
    minify: true,
    // Some bundled packages still call require for Node's own modules.
    banner: "import { createRequire as __scterraRequire } from 'node:module'; const require = __scterraRequire(import.meta.url);"
  }
})
console.log('Built out/cloud/runner.mjs')
