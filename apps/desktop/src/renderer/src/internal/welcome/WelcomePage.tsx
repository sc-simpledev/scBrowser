import { ArrowLeft, ArrowRight, Check, Columns2, PanelTop, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ACCENTS, type AccentId, type ImportResult, type ImportSource, type Settings } from '@scbrowser/shared'
import { api } from '../api'
import { createGlobe, type Globe, type Shot } from './globe'
import { startPad } from './sound'
import './welcome.css'

/** Seconds into the opening at which each shot lands. */
const OPENING: { at: number; shot: Shot }[] = [
  { at: 0, shot: { distance: 1.62, shift: [0, -0.84], sun: [0.06, 0.5, -0.86], lit: 0, stars: 0 } },
  { at: 3, shot: { distance: 1.62, shift: [0, -0.84], sun: [0.06, 0.6, -0.8], lit: 0.05, stars: 0.6 } },
  { at: 7, shot: { distance: 1.95, shift: [0, -0.86], sun: [0.3, 0.68, -0.66], lit: 0.35, stars: 0.9 } },
  { at: 12, shot: { distance: 2.5, shift: [0, -0.8], sun: [0.4, 0.72, 0.4], lit: 1, stars: 1 } }
]
const SETUP_SHOT: Shot = { distance: 3.3, shift: [0.4, -0.02], sun: [-0.5, 0.45, 0.8], lit: 1, stars: 1 }
const DEPARTURE_SHOT: Shot = { distance: 1.03, shift: [0, 0], sun: [0, 0.3, 1], lit: 1.6, stars: 0 }
const MOVE_SECONDS = 1.6
const DEPARTURE_MS = 1500
const SETUP_STEPS = 4

const ease = (t: number) => t * t * t * (t * (6 * t - 15) + 10)
const blend = (a: number, b: number, t: number) => a + (b - a) * t
const blendShots = (a: Shot, b: Shot, t: number): Shot => ({
  distance: blend(a.distance, b.distance, t),
  shift: [blend(a.shift[0], b.shift[0], t), blend(a.shift[1], b.shift[1], t)],
  sun: [blend(a.sun[0], b.sun[0], t), blend(a.sun[1], b.sun[1], t), blend(a.sun[2], b.sun[2], t)],
  lit: blend(a.lit, b.lit, t),
  stars: blend(a.stars, b.stars, t)
})

function openingShot(seconds: number): Shot {
  const next = OPENING.findIndex(({ at }) => at > seconds)
  if (next === -1) return OPENING.at(-1)!.shot
  const from = OPENING[next - 1]!
  const to = OPENING[next]!
  return blendShots(from.shot, to.shot, ease((seconds - from.at) / (to.at - from.at)))
}

/** The accent as linear-ish RGB for the shader, read back so it follows every theme. */
function readTint(): [number, number, number] {
  const swatch = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
  swatch.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--sc-accent')
  swatch.fillRect(0, 0, 1, 1)
  const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data
  return [(r ?? 0) / 255, (g ?? 0) / 255, (b ?? 0) / 255]
}

type Stage = 'opening' | 'setup' | 'leaving'

export function WelcomePage() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const trails = useRef<HTMLCanvasElement>(null)
  const globe = useRef<Globe | null>(null)
  const scene = useRef({ shot: OPENING[0]!.shot, from: OPENING[0]!.shot, to: null as Shot | null, moveStart: 0, seconds: 0 })
  const tint = useRef<[number, number, number]>([0.3, 0.7, 0.8])
  const [stage, setStage] = useState<Stage>('opening')
  const [noGlobe, setNoGlobe] = useState(false)
  const [settled, setSettled] = useState(false)
  const [sound, setSound] = useState(false)
  const stopSound = useRef<(() => void) | null>(null)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    document.title = 'Welcome to scTerra'
    void api().invoke('settings:get').then(({ accent }) => {
      document.documentElement.dataset.accent = accent
      tint.current = readTint()
    })
    if (!canvas.current || !trails.current) return
    const created = createGlobe(canvas.current, trails.current)
    globe.current = created
    if (!created) setNoGlobe(true)
    const started = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const state = scene.current
      // The frame's clock can read slightly earlier than the moment the loop started.
      const seconds = still ? 12 : Math.max(0, now - started) / 1000
      state.seconds = seconds
      if (state.to) {
        const t = Math.min(1, (now - state.moveStart) / (MOVE_SECONDS * 1000))
        state.shot = blendShots(state.from, state.to, ease(t))
      } else state.shot = openingShot(seconds)
      globe.current?.draw(state.shot, seconds, tint.current)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    const timer = setTimeout(() => setSettled(true), still ? 0 : 10_500)
    const onResize = () => globe.current?.resize()
    addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      removeEventListener('resize', onResize)
      created?.destroy()
      stopSound.current?.()
    }
  }, [still])

  const moveTo = (shot: Shot) => {
    const state = scene.current
    state.from = state.shot
    state.to = shot
    state.moveStart = performance.now()
  }

  const begin = () => {
    setSettled(true)
    setStage('setup')
    moveTo(SETUP_SHOT)
  }

  const finish = (then?: string) => {
    setStage('leaving')
    moveTo(DEPARTURE_SHOT)
    stopSound.current?.()
    setTimeout(
      () => {
        void api().invoke('welcome:finish').then(() => {
          if (then) void api().invoke('browser:open', then)
        })
      },
      still ? 0 : DEPARTURE_MS
    )
  }

  const toggleSound = () => {
    if (sound) {
      stopSound.current?.()
      stopSound.current = null
    } else stopSound.current = startPad()
    setSound(!sound)
  }

  return (
    <main className="sc-welcome" data-stage={stage} data-still={still || undefined} data-fallback={noGlobe || undefined}>
      <canvas ref={canvas} aria-hidden className="sc-welcome-scene" />
      <canvas ref={trails} aria-hidden className="sc-welcome-scene" />
      <div aria-hidden className="sc-welcome-grab" />

      {stage === 'opening' && (
        <section className="sc-welcome-title" aria-label="scTerra">
          <h1 aria-label="scTerra">
            {'scTerra'.split('').map((letter, index) => (
              <span key={index} aria-hidden style={{ animationDelay: `${3.2 + index * 0.09}s` }}>
                {letter}
              </span>
            ))}
          </h1>
          <p>
            {['Browse', 'the', 'World'].map((word, index) => (
              <span key={word} style={{ animationDelay: `${6.2 + index * 0.42}s` }}>
                {word}
              </span>
            ))}
          </p>
          <button type="button" className="sc-welcome-begin" data-show={settled || undefined} onClick={begin}>
            Begin
            <ArrowRight aria-hidden size={15} strokeWidth={1.75} />
          </button>
        </section>
      )}

      {stage === 'setup' && <Setup onFinish={finish} onAccent={() => (tint.current = readTint())} />}

      <div aria-hidden={stage === 'leaving'} className="sc-welcome-corner">
        <button type="button" aria-label={sound ? 'Turn sound off' : 'Turn sound on'} aria-pressed={sound} onClick={toggleSound}>
          {sound ? <Volume2 size={15} strokeWidth={1.75} /> : <VolumeX size={15} strokeWidth={1.75} />}
        </button>
        {stage === 'opening' && !settled && (
          <button type="button" onClick={begin}>
            Skip intro
          </button>
        )}
        {stage !== 'leaving' && (
          <button type="button" onClick={() => finish()}>
            {stage === 'setup' ? 'Skip setup' : 'Go straight to browsing'}
          </button>
        )}
      </div>
      <div aria-hidden className="sc-welcome-flash" />
    </main>
  )
}

function Choice({ selected, onPick, title, hint, children }: { selected: boolean; onPick: () => void; title: string; hint?: string; children?: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="sc-welcome-choice" onClick={onPick}>
      {children}
      <span>
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <i aria-hidden>{selected && <Check size={12} strokeWidth={2.5} />}</i>
    </button>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="sc-welcome-toggle">
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function Setup({ onFinish, onAccent }: { onFinish: (then?: string) => void; onAccent: () => void }) {
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [sources, setSources] = useState<ImportSource[]>([])
  const [imported, setImported] = useState<Record<string, ImportResult>>({})
  const [ai, setAi] = useState<'hosted' | 'own' | 'later'>('hosted')
  const [hostedAvailable, setHostedAvailable] = useState(false)
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    void api().invoke('settings:get').then(setSettings)
    void api().invoke('import:sources').then(setSources)
    void api().invoke('browser:is-default').then(setIsDefault)
    void api().invoke('ai:status').then((status) => {
      setHostedAvailable(status.hostedAvailable)
      if (!status.hostedAvailable) setAi('later')
    })
  }, [])
  if (!settings) return null

  const update = (patch: Partial<Settings>) => {
    setSettings({ ...settings, ...patch })
    void api().invoke('settings:set', patch)
  }
  const pickAccent = (accent: AccentId) => {
    document.documentElement.dataset.accent = accent
    update({ accent })
    onAccent()
  }
  const leave = () => {
    if (ai === 'hosted') void api().invoke('ai:enable-hosted')
    onFinish(ai === 'own' ? 'sc://ai/' : undefined)
  }

  const pages: { title: string; lead: string; body: ReactNode }[] = [
    {
      title: 'Bring your world with you',
      lead: 'Copy bookmarks and history from another browser. Passwords stay where they are.',
      body:
        sources.length === 0 ? (
          <p className="sc-welcome-note">No other browsers found on this computer. You can always import later in Settings.</p>
        ) : (
          <div className="sc-welcome-list">
            {sources.map((source) => {
              const done = imported[source.id]
              return (
                <div key={source.id} className="sc-welcome-row">
                  <span>
                    <strong>{source.name}</strong>
                    {done && <small>Added {done.bookmarks} bookmarks and {done.history} history entries</small>}
                  </span>
                  <button
                    type="button"
                    disabled={!!done}
                    onClick={() => void api().invoke('import:run', source.id).then((result) => setImported((all) => ({ ...all, [source.id]: result })))}
                  >
                    {done ? 'Imported' : 'Import'}
                  </button>
                </div>
              )
            })}
          </div>
        )
    },
    {
      title: 'Make it yours',
      lead: 'Everything here can be changed later.',
      body: (
        <>
          <div role="radiogroup" aria-label="Theme" className="sc-welcome-segments">
            {(['system', 'light', 'dark'] as const).map((theme) => (
              <button key={theme} type="button" role="radio" aria-checked={settings.theme === theme} onClick={() => update({ theme })}>
                {theme === 'system' ? 'Match system' : theme === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Tab layout" className="sc-welcome-list">
            <Choice selected={settings.tabLayout === 'vertical'} onPick={() => update({ tabLayout: 'vertical' })} title="Tabs down the side" hint="More room for long titles">
              <Columns2 aria-hidden size={18} strokeWidth={1.5} />
            </Choice>
            <Choice selected={settings.tabLayout === 'horizontal'} onPick={() => update({ tabLayout: 'horizontal' })} title="Tabs across the top" hint="The familiar layout">
              <PanelTop aria-hidden size={18} strokeWidth={1.5} />
            </Choice>
          </div>
          <div role="radiogroup" aria-label="Accent colour" className="sc-welcome-swatches">
            {ACCENTS.map((accent) => (
              <button key={accent.id} type="button" role="radio" aria-checked={settings.accent === accent.id} aria-label={accent.name} title={accent.name} data-swatch={accent.id} onClick={() => pickAccent(accent.id)} />
            ))}
          </div>
        </>
      )
    },
    {
      title: 'Choose your AI',
      lead: 'Nothing goes to an AI service unless you ask it something.',
      body: (
        <div role="radiogroup" aria-label="AI" className="sc-welcome-list">
          {hostedAvailable && <Choice selected={ai === 'hosted'} onPick={() => setAi('hosted')} title="scTerra AI" hint="Ready now, with no key. Limited each day." />}
          <Choice selected={ai === 'own'} onPick={() => setAi('own')} title="Use my own key" hint="Anthropic, OpenAI, Gemini, Ollama and others" />
          <Choice selected={ai === 'later'} onPick={() => setAi('later')} title="Not now" hint="Set it up whenever you like" />
        </div>
      )
    },
    {
      title: 'Yours, and nobody else’s',
      lead: 'Sensible protection is already on.',
      body: (
        <>
          <div className="sc-welcome-list">
            <Toggle label="Block trackers and ads" hint="Stops most tracking before it loads" checked={settings.trackingProtection !== 'off'} onChange={(on) => update({ trackingProtection: on ? 'standard' : 'off' })} />
            <Toggle label="Secure connections only" hint="Asks before using an insecure site" checked={settings.httpsOnly} onChange={(httpsOnly) => update({ httpsOnly })} />
            <Toggle label="Update automatically" hint="Downloads fixes in the background" checked={settings.autoUpdate} onChange={(autoUpdate) => update({ autoUpdate })} />
            <Toggle label="Send crash reports" hint="Off unless you turn it on. Never pages or addresses" checked={settings.crashReports} onChange={(crashReports) => update({ crashReports })} />
          </div>
          {!isDefault && (
            <button
              type="button"
              className="sc-welcome-text"
              onClick={() => void api().invoke('browser:set-default').then(() => api().invoke('browser:is-default')).then(setIsDefault)}
            >
              Make scTerra my default browser
            </button>
          )}
        </>
      )
    }
  ]
  const page = pages[step]!
  const last = step === SETUP_STEPS - 1

  return (
    <section key={step} className="sc-welcome-panel" aria-label={`Setup step ${step + 1} of ${SETUP_STEPS}`}>
      <ol aria-hidden className="sc-welcome-steps">
        {pages.map((_, index) => (
          <li key={index} data-on={index <= step || undefined} />
        ))}
      </ol>
      <h2>{page.title}</h2>
      <p>{page.lead}</p>
      <div className="sc-welcome-body">{page.body}</div>
      <footer>
        {step > 0 ? (
          <button type="button" className="sc-welcome-back" aria-label="Back" onClick={() => setStep(step - 1)}>
            <ArrowLeft size={15} strokeWidth={1.75} />
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="sc-welcome-next" onClick={() => (last ? leave() : setStep(step + 1))}>
          {last ? 'Browse the World' : 'Continue'}
          <ArrowRight aria-hidden size={15} strokeWidth={1.75} />
        </button>
      </footer>
    </section>
  )
}
