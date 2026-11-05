// Each kind of Mac is built on its own runner and writes its own latest-mac.yml, so whichever
// finishes last would hide the other's zip. This joins their `files` lists into one.
//
// Usage: node merge-mac-update.mjs <output> <input> <input>...
import { readFileSync, writeFileSync } from 'node:fs'

const [output, ...inputs] = process.argv.slice(2)
if (!output || inputs.length === 0) throw new Error('Usage: merge-mac-update.mjs <output> <input>...')

/** Splits the file into its `files:` entries and every other line. They're plain and machine-written. */
function parse(text) {
  const entries = []
  const rest = []
  let inFiles = false
  for (const line of text.split('\n')) {
    if (line === 'files:') inFiles = true
    else if (inFiles && line.startsWith('  - ')) entries.push([line])
    else if (inFiles && line.startsWith('    ')) entries.at(-1).push(line)
    else {
      inFiles = false
      if (line) rest.push(line)
    }
  }
  return { entries, rest }
}

const parsed = inputs.map((path) => parse(readFileSync(path, 'utf8')))
const versions = new Set(parsed.map(({ rest }) => rest.find((line) => line.startsWith('version:'))))
if (versions.size !== 1) throw new Error(`These are from different versions: ${[...versions].join(', ')}`)

const entries = parsed.flatMap((file) => file.entries)
const urls = new Set(entries.map(([first]) => first))
const unique = [...urls].map((first) => entries.find((entry) => entry[0] === first))
if (unique.length === 0) throw new Error('No files to list')

const [version, ...others] = parsed[0].rest
writeFileSync(output, [version, 'files:', ...unique.flat(), ...others, ''].join('\n'))
console.log(`Wrote ${output} with ${unique.length} files`)
