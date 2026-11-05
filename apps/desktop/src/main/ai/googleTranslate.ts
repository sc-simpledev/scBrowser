import { net } from 'electron'
import { GOOGLE_LANGUAGES, parseGoogleTranslation, type TranslateLanguage } from '@scbrowser/shared'

/** The address Chrome's own dictionary extension uses. It isn't a published API, so it may change. */
const ENDPOINT = 'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto'

/** Automated tests must not reach the network. */
const endpoint = () => (process.env.SCB_E2E ? `${process.env.SCB_TRANSLATE_URL ?? 'http://127.0.0.1:9'}/translate?x=1` : ENDPOINT)

/** Sends the texts to Google, and only because someone asked. Null means no usable answer. */
export async function translateWithGoogle(texts: string[], language: TranslateLanguage): Promise<string[] | null> {
  const body = new URLSearchParams(texts.map((text): [string, string] => ['q', text]))
  const response = await net.fetch(`${endpoint()}&tl=${GOOGLE_LANGUAGES[language]}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!response.ok) return null
  return parseGoogleTranslation(await response.json(), texts.length)
}
