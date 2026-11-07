import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input } from '@scbrowser/ui'
import { isSiteHost, MAX_SITE_CSS, siteBase, type Settings } from '@scbrowser/shared'
import { api } from '../api'

/** What someone types for a site, like https://www.Example.com/page, down to example.com. */
function typedSite(text: string): string | null {
  const trimmed = text.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!URL.canParse(withScheme)) return null
  const base = siteBase(new URL(withScheme).hostname)
  return isSiteHost(base) && base.includes('.') ? base : null
}

/** Changes from the latest stored settings, as a page may have hidden something since this one loaded. */
async function updateFresh(change: (current: Settings) => Partial<Settings>, apply: (patch: Partial<Settings>) => void) {
  apply(change(await api().invoke('settings:get')))
}

const FIELD = 'w-full resize-y rounded-md border border-border bg-field p-2 font-mono text-xs outline-none placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-focus-ring'

function SiteRow({ site, hint, children }: { site: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-6 border-b border-border px-3 py-2 last:border-b-0">
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <div>{site}</div>
        <div className="text-xs text-text-faint">{hint}</div>
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  )
}

function AddSite({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (site: string) => void }) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState(false)
  return (
    <form
      className="flex items-center gap-2 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault()
        const site = typedSite(text)
        if (!site) return setProblem(true)
        onAdd(site)
        setText('')
        setProblem(false)
      }}
    >
      <Input aria-label={label} placeholder={placeholder} className="min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={problem} />
      <Button type="submit" disabled={!text.trim()}>
        Add
      </Button>
      {problem && <span role="alert" className="text-xs text-danger">Enter a site, like example.com</span>}
    </form>
  )
}

function CssEditor({ editing, onChange, onSave }: { editing: { site: string; css: string }; onChange: (next: { site: string; css: string } | null) => void; onSave: () => void }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
      <div>{editing.site}</div>
      <textarea
        aria-label={`CSS for ${editing.site}`}
        rows={6}
        spellCheck={false}
        autoFocus
        placeholder={'.newsletter-popup { display: none !important; }'}
        className={FIELD}
        value={editing.css}
        maxLength={MAX_SITE_CSS}
        onChange={(e) => onChange({ ...editing, css: e.target.value })}
      />
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={() => {
            onSave()
            onChange(null)
          }}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={() => onChange(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Parts hidden with the picker, and the person's own CSS, by site. */
export function PageTweaks({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const [editing, setEditing] = useState<{ site: string; css: string } | null>(null)
  const sites = [...new Set([...Object.keys(settings.hiddenElements), ...Object.keys(settings.siteCss)])].sort()
  const saveCss = (site: string, css: string) =>
    void updateFresh(({ siteCss }) => {
      const { [site]: _old, ...others } = siteCss
      return { siteCss: css.trim() ? { ...others, [site]: css.slice(0, MAX_SITE_CSS) } : others }
    }, update)
  return (
    <>
      {sites.length === 0 && !editing && (
        <div className="px-3 py-2.5 text-xs text-text-faint">
          Nothing yet. Right-click a page and pick Hide part of this page to remove something you never want to see, like a sticky banner or a sidebar.
        </div>
      )}
      {sites.map((site) => {
        const hidden = settings.hiddenElements[site]?.length ?? 0
        const css = settings.siteCss[site]
        const hint = [hidden > 0 && `${hidden} hidden ${hidden === 1 ? 'part' : 'parts'}`, css && 'Own CSS'].filter(Boolean).join(' · ')
        if (editing?.site === site) return <CssEditor key={site} editing={editing} onChange={setEditing} onSave={() => saveCss(site, editing.css)} />
        return (
          <SiteRow key={site} site={site} hint={hint}>
            <Button variant="ghost" onClick={() => setEditing({ site, css: css ?? '' })}>
              {css ? 'Edit CSS' : 'Add CSS'}
            </Button>
            {hidden > 0 && (
              <Button
                variant="ghost"
                onClick={() =>
                  void updateFresh(({ hiddenElements }) => {
                    const { [site]: _old, ...others } = hiddenElements
                    return { hiddenElements: others }
                  }, update)
                }
              >
                Show all
              </Button>
            )}
          </SiteRow>
        )
      })}
      {editing && !sites.includes(editing.site) && <CssEditor editing={editing} onChange={setEditing} onSave={() => saveCss(editing.site, editing.css)} />}
      {!editing && <AddSite label="Add CSS for a site" placeholder="Add your own CSS for a site, like example.com" onAdd={(site) => setEditing({ site, css: settings.siteCss[site] ?? '' })} />}
    </>
  )
}

/** Sites cleared each time scTerra closes. */
export function ForgetOnClose({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <>
      {settings.forgetOnClose.length === 0 && (
        <div className="px-3 py-2.5 text-xs text-text-faint">
          No sites yet. Their cookies, site data and history are cleared each time scTerra closes, so you're signed out next time. To forget a site once, right-click its page and pick Forget this site.
        </div>
      )}
      {settings.forgetOnClose.map((site) => (
        <SiteRow key={site} site={site} hint="Forgotten when scTerra closes">
          <Button variant="ghost" onClick={() => void updateFresh(({ forgetOnClose }) => ({ forgetOnClose: forgetOnClose.filter((host) => host !== site) }), update)}>
            Remove
          </Button>
        </SiteRow>
      ))}
      <AddSite
        label="Add a site to forget when scTerra closes"
        placeholder="Add a site, like example.com"
        onAdd={(site) => void updateFresh(({ forgetOnClose }) => ({ forgetOnClose: [...new Set([...forgetOnClose, site])].sort() }), update)}
      />
    </>
  )
}

/** Pages the assistant wrote and the person kept, each opening in a window of its own. */
export function MiniAppsSection() {
  const [apps, setApps] = useState<{ id: string; name: string; createdAt: number }[] | null>(null)
  useEffect(() => void api().invoke('mini-apps:list').then(setApps), [])
  if (!apps || apps.length === 0) return null
  return (
    <section aria-label="Kept from the assistant" className="flex flex-col gap-1">
      <h3 className="px-1 pb-1 text-2xs font-semibold tracking-[0.06em] text-text-muted uppercase">Kept from the assistant</h3>
      <div className="flex flex-col rounded-lg bg-surface shadow-1">
        {apps.map((app) => (
          <SiteRow key={app.id} site={app.name} hint={`Kept ${new Date(app.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Works offline, and can't reach the internet.`}>
            <Button onClick={() => void api().invoke('mini-apps:open', app.id)}>Open</Button>
            <Button
              variant="ghost"
              onClick={() => {
                void api().invoke('mini-apps:remove', app.id)
                setApps(apps.filter((other) => other.id !== app.id))
              }}
            >
              Remove
            </Button>
          </SiteRow>
        ))}
      </div>
    </section>
  )
}
