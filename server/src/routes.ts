export type RouteFormat = 'anthropic' | 'openai'

export interface Route {
  /** The number in its variable names, used in logs and errors only. */
  id: number
  apiKey: string
  model: string
  format: RouteFormat
  baseUrl?: string
  /** low, medium, high and so on; left out, the model's default applies. */
  reasoning?: string
  /** Share of traffic relative to other routes. */
  weight: number
}

const MAX_ROUTES = 50

/**
 * Reads API_KEY_1, MODEL_1, REASONING_1, BASE_URL_1, WEIGHTING_1 and FORMAT_1, then _2 and
 * so on. Numbers may have gaps, so a key can be removed without renumbering the rest.
 */
export function loadRoutes(env: (name: string) => string | undefined): Route[] {
  const routes: Route[] = []
  for (let id = 1; id <= MAX_ROUTES; id++) {
    const apiKey = env(`API_KEY_${id}`)
    if (!apiKey) continue
    const model = env(`MODEL_${id}`)
    if (!model) throw new Error(`MODEL_${id} is required alongside API_KEY_${id}.`)

    const baseUrl = env(`BASE_URL_${id}`) || undefined
    const format = env(`FORMAT_${id}`) ?? (!baseUrl || baseUrl.includes('anthropic') ? 'anthropic' : 'openai')
    if (format !== 'anthropic' && format !== 'openai') throw new Error(`FORMAT_${id} must be anthropic or openai.`)

    const weight = Number(env(`WEIGHTING_${id}`) ?? 1)
    if (!Number.isFinite(weight) || weight < 0) throw new Error(`WEIGHTING_${id} must be zero or more.`)

    const reasoning = env(`REASONING_${id}`) || undefined
    if (weight > 0) routes.push({ id, apiKey, model, format, weight, ...(baseUrl ? { baseUrl } : {}), ...(reasoning ? { reasoning } : {}) })
  }
  if (routes.length === 0) throw new Error('Set API_KEY_1 and MODEL_1 before starting the server.')
  return routes
}

/** A random order favouring heavier routes; the first is used and the rest are backups. */
export function shuffleByWeight<T extends { weight: number }>(routes: T[], random: () => number = Math.random): T[] {
  const remaining = [...routes]
  const order: T[] = []
  while (remaining.length > 1) {
    let point = random() * remaining.reduce((sum, route) => sum + route.weight, 0)
    const index = remaining.findIndex((route) => (point -= route.weight) < 0)
    order.push(...remaining.splice(index === -1 ? remaining.length - 1 : index, 1))
  }
  return [...order, ...remaining]
}
