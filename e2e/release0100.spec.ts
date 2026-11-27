import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { startAiMock, type AiMock } from './aiMock'
import { activeTab, go, launch, serveSite, setSetting, shortcut, titled, type Harness, type Site } from './app'

let h: Harness
let site: Site
let mock: AiMock | null = null
let github: FakeGithub | null = null
let scratch = ''

/** A 1×1 PNG, for a page's picture. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test.beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'scb-0100-'))
  site = await serveSite({
    '/other': titled('Other page'),
    '/content': `<!doctype html><title>Content</title><h1>Content</h1><img id="pic" alt="pic"><script>document.title = 'Scripts ran'</script><script>document.getElementById('pic').src = location.origin + '/pic'</script>`,
    '/still': `<!doctype html><title>Still</title><img id="pic" alt="pic" src="/pic">`,
    '/popper': titled('Popper', `<button id="open" style="width:200px;height:60px">Open one</button><script>document.getElementById('open').onclick = () => window.open('/other', '_blank')</script>`),
    '/notify': titled('Notify'),
    '/links': titled('Links', '<a href="/article" style="font-size:40px">The otter article</a>'),
    '/article': titled('All about otters', '<p>Otters hold hands while they sleep so they don’t drift apart. Sea otters use stones as tools to open shellfish.</p>'),
    '/fruit': titled('Fruit stall prices', '<p>Apples and pears</p>')
  })
  // The picture, which the HTML-only test site can't serve.
  const pictures = site.server.listeners('request')[0] as (req: { url?: string }, res: { writeHead: (status: number, headers: object) => void; end: (body: Buffer) => void }) => void
  site.server.removeAllListeners('request')
  site.server.on('request', (req, res) => {
    if (req.url === '/pic') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PIXEL)
    } else pictures(req, res)
  })
})

test.afterEach(async () => {
  await h.close().catch(() => undefined)
  for (const server of [mock?.server, github?.server]) {
    server?.closeAllConnections()
    server?.close()
  }
  mock = null
  github = null
  site.server.close()
  rmSync(scratch, { recursive: true, force: true })
})

const main = <T, A = undefined>(fn: (g: any, arg: A) => T, arg?: A) => h.app.evaluate((_, [source, value]) => eval(source as string)(globalThis, value), [fn.toString(), arg] as const) as Promise<Awaited<T>>
const tool = (call: object) => `Working.\n\`\`\`tool\n${JSON.stringify(call)}\n\`\`\``

/** The mock model as the chat model, through sc://ai as a person would set it up. */
async function withMockModel(switches: string[] = [], env: Record<string, string> = {}): Promise<void> {
  h = await launch(undefined, switches, env)
  mock = await startAiMock()
  await go(h, 'sc://ai')
  const ai = await h.page('sc://ai')
  await ai.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('custom')
  await ai.getByRole('textbox', { name: 'Name', exact: true }).fill('Mock AI')
  await ai.getByRole('textbox', { name: 'Base URL' }).fill(`${mock.url}/v1`)
  await ai.getByRole('combobox', { name: 'API format' }).selectOption('openai')
  await ai.getByRole('textbox', { name: 'API key' }).fill('test-key-not-real-12345')
  await ai.getByRole('button', { name: 'Add provider' }).click()
  await expect(ai.getByText('Connected, 1 model available')).toBeVisible()
  await ai.getByRole('combobox', { name: 'Chat model for Mock AI' }).selectOption('mock-model')
  await setSetting(h, { httpsOnly: false, saveChats: false })
}

test.describe('site settings, notifications and protected content', () => {
  test('the padlock blocks a site’s scripts and pictures, and lets them back', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false })
    await go(h, site.url('/content'))
    await expect(activeTab(h)).toHaveText('Scripts ran')
    const page = await h.page('/content')
    await expect.poll(() => page.evaluate(() => (document.getElementById('pic') as HTMLImageElement).naturalWidth)).toBe(1)
    await h.chrome.evaluate(() => window.scb.invoke('site:controls', 120, 80))
    const overlay = await h.overlay()
    const panel = overlay.getByRole('dialog', { name: 'Controls for 127.0.0.1' })
    await panel.getByRole('button', { name: /^Site settings/ }).click()
    await panel.getByRole('switch', { name: 'JavaScript on 127.0.0.1' }).click()
    await expect(activeTab(h)).toHaveText('Content')
    await expect(panel.getByText('Blocked: most sites won’t work')).toBeVisible()
    expect(await page.evaluate(() => document.title)).toBe('Content')
    await overlay.keyboard.press('Escape')
    expect(await h.chrome.evaluate(() => window.scb.invoke('settings:get').then((settings) => settings.siteContent))).toEqual({ '127.0.0.1': ['scripts'] })

    // Pictures: blocked as the page loads them.
    await setSetting(h, { siteContent: { '127.0.0.1': ['images'] } })
    await go(h, site.url('/still'))
    await expect(activeTab(h)).toHaveText('Still')
    const still = await h.page('/still')
    await expect.poll(() => still.evaluate(() => (document.getElementById('pic') as HTMLImageElement).complete)).toBe(true)
    expect(await still.evaluate(() => (document.getElementById('pic') as HTMLImageElement).naturalWidth)).toBe(0)
    // Back on: everything as before.
    await setSetting(h, { siteContent: {} })
    await go(h, site.url('/content'))
    await expect(activeTab(h)).toHaveText('Scripts ran')
  })

  test('a site’s every pop-up can be stopped, even after a click, and allowed again from the address bar', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false, siteContent: { '127.0.0.1': ['popups'] } })
    await go(h, site.url('/popper'))
    await expect(activeTab(h)).toHaveText('Popper')
    const page = await h.page('/popper')
    await page.locator('#open').click()
    await expect(h.chrome.getByRole('button', { name: /pop-up/i })).toBeVisible()
    await expect(h.chrome.getByRole('tab')).toHaveCount(1)
    // With the block off, the same click opens it.
    await setSetting(h, { siteContent: {} })
    await page.locator('#open').click()
    await expect(h.chrome.getByRole('tab')).toHaveCount(2)
  })

  test('Settings shows Widevine, and turning protected content off locks it in the padlock', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false })
    await go(h, 'sc://settings/#privacy')
    const settings = await h.page('sc://settings')
    // Tests never download Widevine, so it says it starts with scTerra.
    await expect(settings.getByText('Widevine starts with scTerra.')).toBeVisible()
    await settings.getByRole('switch', { name: 'Play protected content' }).click()
    await expect(settings.getByText('Off: protected video and music won’t play anywhere.')).toBeVisible()
    await go(h, site.url('/other'))
    await expect(activeTab(h)).toHaveText('Other page')
    await h.chrome.evaluate(() => window.scb.invoke('site:controls', 120, 80))
    const panel = (await h.overlay()).getByRole('dialog', { name: 'Controls for 127.0.0.1' })
    await panel.getByRole('button', { name: /^Site settings/ }).click()
    await expect(panel.getByText('Off everywhere, in Settings')).toBeVisible()
    await expect(panel.getByRole('switch', { name: 'Protected content on 127.0.0.1' })).toHaveCount(0)
    // Pages are told no straight away.
    const page = await h.page('/other')
    const answer = await page.evaluate(() =>
      navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then(
        () => 'granted',
        (error: Error) => error.name
      )
    )
    expect(answer).toBe('NotSupportedError')
    // On everywhere but blocked for this one site, from its padlock: refused there too.
    await setSetting(h, { protectedContent: true, siteContent: { '127.0.0.1': ['drm'] } })
    await go(h, site.url('/notify'))
    await expect(activeTab(h)).toHaveText('Notify')
    const blocked = await (await h.page('/notify')).evaluate(() =>
      navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then(
        () => 'granted',
        (error: Error) => `${error.name}: ${error.message}`
      )
    )
    expect(blocked).toBe('NotSupportedError: Protected content is turned off for this site in scTerra.')
  })

  test('notifications from a site are listed, and held back during Do not disturb', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false, notificationQuiet: 'always' })
    await main((g, origin) => g.scbCore.services.permissions.set(origin, 'notifications', true), new URL(site.url('/')).origin)
    await go(h, site.url('/notify'))
    await expect(activeTab(h)).toHaveText('Notify')
    const page = await h.page('/notify')
    const made = await page.evaluate(() => {
      const shown = new Notification('Build finished', { body: 'All 12 checks passed' })
      return { permission: Notification.permission, title: (shown as unknown as { title: string }).title, isNotification: shown instanceof Notification }
    })
    expect(made).toEqual({ permission: 'granted', title: 'Build finished', isNotification: false })
    // During a focus session only, when that's the setting.
    await setSetting(h, { notificationQuiet: 'focus', focusMode: true })
    await page.evaluate(() => void new Notification('Second', { body: 'While focusing' }))
    const listed = await main((g) => g.scbCore.notifications.all().map((one: { title: string; body: string; held: boolean; site: string }) => [one.site, one.title, one.body, one.held]))
    expect(listed).toEqual([
      ['127.0.0.1', 'Second', 'While focusing', true],
      ['127.0.0.1', 'Build finished', 'All 12 checks passed', true]
    ])
    const rows = await main((g) => g.scbActions.notificationRows().map((row: { label?: string; type?: string; checked?: boolean }) => [row.label ?? row.type, row.checked ?? null]))
    expect(rows.slice(0, 2).map(([label]: [string]) => label)).toEqual(['127.0.0.1 · Second: While focusing (now, held)', '127.0.0.1 · Build finished: All 12 checks passed (now, held)'])
    expect(rows).toContainEqual(['Hold them during focus sessions', true])
    // Seen, and cleared.
    expect(await main((g) => g.scbCore.notifications.unread())).toBe(0)
  })
})

interface FakeGithub {
  url: string
  server: Server
  calls: { method: string; path: string; body: unknown }[]
  pull: { number: number; title: string; html_url: string; state: 'open' | 'closed'; merged: boolean; draft: boolean; mergeable: boolean; base: { ref: string }; head: { sha: string; ref: string } } | null
}

/** Enough of GitHub for connecting, opening a pull request, its checks, and merging it. */
async function startGithub(): Promise<FakeGithub> {
  const fake: FakeGithub = { url: '', server: null!, calls: [], pull: null }
  fake.server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const path = req.url ?? ''
      const text = Buffer.concat(chunks).toString()
      const body = text ? JSON.parse(text) : null
      fake.calls.push({ method: req.method ?? '', path, body })
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, workflow' })
        res.end(value === '' ? '' : JSON.stringify(value))
      }
      const method = req.method
      if (method === 'GET' && path === '/user') return send(200, { login: 'tester' })
      if (method === 'GET' && path === '/repos/me/project') return send(200, { default_branch: 'main', permissions: { push: true } })
      if (method === 'GET' && path.startsWith('/repos/me/project/pulls?')) return send(200, fake.pull ? [fake.pull] : [])
      if (method === 'POST' && path === '/repos/me/project/pulls') {
        fake.pull = { number: 7, title: body.title, html_url: 'https://github.com/me/project/pull/7', state: 'open', merged: false, draft: body.draft, mergeable: true, base: { ref: body.base }, head: { sha: 'abc123', ref: body.head } }
        return send(201, fake.pull)
      }
      if (method === 'GET' && path === '/repos/me/project/pulls/7') return send(fake.pull ? 200 : 404, fake.pull ?? { message: 'Not Found' })
      if (method === 'PUT' && path === '/repos/me/project/pulls/7/merge' && fake.pull) {
        fake.pull = { ...fake.pull, state: 'closed', merged: true }
        return send(200, { merged: true })
      }
      if (method === 'DELETE' && path.startsWith('/repos/me/project/git/refs/heads/')) return send(204, '')
      if (method === 'GET' && /\/commits\/[^/]+\/check-runs/.test(path)) return send(200, { check_runs: [{ status: 'completed', conclusion: 'success' }] })
      if (method === 'GET' && /\/commits\/[^/]+\/status$/.test(path)) return send(200, { statuses: [] })
      send(404, { message: 'Not Found' })
    })
  })
  await new Promise<void>((done) => fake.server.listen(0, '127.0.0.1', done))
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`
  return fake
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/**
 * A project on "GitHub": origin says github.com/me/project as people's do, and git itself is sent
 * to a bare repository here. Returns the project folder and the bare one.
 */
function githubProject(): { folder: string; bare: string } {
  const folder = join(scratch, 'project')
  const bare = join(scratch, 'remote.git')
  mkdirSync(folder)
  git(scratch, 'init', '-q', '--bare', '-b', 'main', bare)
  git(folder, 'init', '-q', '-b', 'main')
  git(folder, 'config', 'user.name', 'Test')
  git(folder, 'config', 'user.email', 't@example.com')
  writeFileSync(join(folder, 'a.txt'), 'one\n')
  git(folder, 'add', '-A')
  git(folder, 'commit', '-qm', 'First')
  git(folder, 'remote', 'add', 'origin', 'https://github.com/me/project.git')
  git(folder, 'config', `url.${bare}.insteadOf`, 'https://github.com/me/project.git')
  git(folder, 'push', '-q', '-u', 'origin', 'main')
  return { folder, bare }
}

/** Terra Code on a folder, with the mock model and (when asked) the stand-in GitHub connected. */
async function terraCode(folder: string, { connect = false, settings = {} }: { connect?: boolean; settings?: Record<string, unknown> } = {}): Promise<Page> {
  github = await startGithub()
  await withMockModel([], { SCB_GITHUB_API: github.url })
  await setSetting(h, { coderFolder: folder, coderMode: 'edits', saveChats: true, coderNotify: false, ...settings })
  await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1480, 920))
  await go(h, 'sc://assistant/?mode=code')
  const page = await h.page('sc://assistant')
  if (connect) {
    const panel = await showPanel(page)
    await panel.getByRole('tab', { name: 'Settings' }).click()
    const region = panel.getByRole('region', { name: 'Terra Code settings' })
    await region.getByRole('button', { name: /GitHub\s*Not connected/ }).click()
    await region.getByRole('button', { name: 'Paste a token' }).click()
    await region.getByRole('textbox', { name: 'GitHub token' }).fill('github_pat_testtokentesttokentest1234')
    await region.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(region).toContainText('Signed in as @tester')
    await region.getByRole('radio', { name: /Look and act/ }).click()
    await page.getByRole('button', { name: 'Hide the session panel' }).first().click()
  }
  return page
}

const showPanel = async (page: Page) => {
  const panel = page.getByRole('complementary', { name: 'Session' })
  const show = page.getByRole('button', { name: 'Show the session panel' })
  await expect(panel.or(show).first()).toBeVisible()
  if (!(await panel.isVisible())) await show.click()
  await expect(panel).toBeVisible()
  return panel
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Describe a change' })
async function say(page: Page, text: string) {
  await box(page).fill(text)
  await box(page).press('Enter')
}
const gitButton = (page: Page) => page.getByRole('button', { name: /^Branch .*Git menu$/ })

test.describe('Terra Code: git without a terminal', () => {
  test('commit, open a pull request written for you, and merge it, all from Terra Code', async () => {
    const { folder, bare } = githubProject()
    const page = await terraCode(folder, { connect: true })
    mock!.queue.push(tool({ tool: 'write', path: 'login.txt', content: 'Sign in here\n' }), 'Added the login page.', 'Add a login page', '{"title":"Add a login page","body":"## Summary\\n- Adds login.txt\\n\\n## Testing\\nOpened it."}')
    await say(page, 'add a login page')
    await expect(page.getByText('Added the login page.')).toBeVisible()
    await page.getByRole('button', { name: 'Commit', exact: true }).click()
    const commit = page.getByRole('region', { name: 'Commit' })
    await expect(commit.getByRole('textbox', { name: 'Commit message' })).toHaveValue('Add a login page')
    await commit.getByRole('button', { name: 'Commit and open a pull request' }).click()
    await expect(page.getByText(/^Committed [0-9a-f]+ Add a login page\.$/)).toBeVisible()

    // On main, so the card makes a branch first, named from the title the model wrote.
    const card = page.getByRole('region', { name: 'Create a pull request' })
    await expect(card.getByRole('textbox', { name: 'Pull request title' })).toHaveValue('Add a login page')
    await expect(card.getByRole('textbox', { name: 'Pull request description' })).toHaveValue(/## Summary/)
    await expect(card.getByRole('textbox', { name: 'New branch name' })).toHaveValue('add-a-login-page')
    expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain('Write a GitHub pull request')
    await card.getByRole('button', { name: 'Open the pull request' }).click()
    await expect(page.getByText('Opened pull request #7: Add a login page')).toBeVisible()
    expect(github!.calls.find((call) => call.method === 'POST' && call.path === '/repos/me/project/pulls')?.body).toMatchObject({ head: 'add-a-login-page', base: 'main', title: 'Add a login page', draft: false })
    expect(git(bare, 'branch', '--list', 'add-a-login-page')).toContain('add-a-login-page')

    // The branch button shows the pull request, and merges it.
    await expect(gitButton(page)).toContainText('#7')
    await gitButton(page).click()
    await page.getByRole('menuitem', { name: /Merge #7 into main/ }).click()
    const merge = page.getByRole('region', { name: 'Merge #7 into main' })
    await expect(merge.getByRole('radio', { name: /Squash/ })).toHaveAttribute('aria-checked', 'true')
    await merge.getByRole('button', { name: 'Merge', exact: true }).click()
    await expect(page.getByText(/Merged #7 into main \(squashed\)\. Removed add-a-login-page from GitHub\./)).toBeVisible()
    expect(github!.calls.find((call) => call.method === 'PUT')?.body).toEqual({ merge_method: 'squash', sha: 'abc123' })
    await expect(gitButton(page)).toHaveAccessibleName(/^Branch main/)
  })

  test('a pull that stops on conflicts can go to Terra Code to resolve, or be given up', async () => {
    const { folder, bare } = githubProject()
    const other = join(scratch, 'other')
    git(scratch, 'clone', '-q', bare, other)
    writeFileSync(join(other, 'a.txt'), 'theirs\n')
    git(other, 'commit', '-qam', 'Theirs')
    git(other, 'push', '-q')
    writeFileSync(join(folder, 'a.txt'), 'mine\n')
    git(folder, 'commit', '-qam', 'Mine')
    const page = await terraCode(folder)
    await expect(gitButton(page)).toContainText('1')
    await gitButton(page).click()
    await page.getByRole('menuitem', { name: /^Pull\b/ }).click()
    await expect(page.getByText('Pulling stopped on conflicts. Resolve them, or give up the merge.')).toBeVisible()
    const bar = page.getByRole('region', { name: 'Merge conflicts' })
    await expect(bar).toContainText('A merge stopped on conflicts in a.txt.')
    mock!.queue.push('I looked at both sides.')
    await bar.getByRole('button', { name: 'Resolve with Terra Code' }).click()
    await expect(page.getByText('I looked at both sides.')).toBeVisible()
    const asked = JSON.stringify(mock!.requests.at(-1)!.body.messages)
    expect(asked).toContain('- a.txt')
    expect(asked).toContain('git commit --no-edit')
    await bar.getByRole('button', { name: 'Give up' }).click()
    await expect(page.getByText('Gave up the merge. Everything is as it was before.')).toBeVisible()
    await expect(bar).toHaveCount(0)
    expect(readFileSync(join(folder, 'a.txt'), 'utf8')).toBe('mine\n')
  })

  test('/branch makes a branch and /push sends it, with no GitHub sign-in needed for git itself', async () => {
    const { folder, bare } = githubProject()
    const page = await terraCode(folder)
    await say(page, '/branch feature/notes')
    await expect(page.getByText('Made feature/notes and switched to it.')).toBeVisible()
    writeFileSync(join(folder, 'notes.md'), 'Notes\n')
    git(folder, 'add', '-A')
    git(folder, 'commit', '-qm', 'Notes')
    await say(page, '/push')
    await expect(page.getByText('Pushed a commit to origin/feature/notes.')).toBeVisible()
    expect(git(bare, 'log', '--format=%s', 'feature/notes', '-1')).toBe('Notes')
    await expect(gitButton(page)).toHaveAccessibleName(/^Branch feature\/notes/)
  })
})

test.describe('Terra Code like Claude Code', () => {
  test('a plugin from a folder is listed before it’s added, and its command works', async () => {
    const plugin = join(scratch, 'kit')
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'greeter', version: '0.1.0', description: 'Says hello' }))
    mkdirSync(join(plugin, 'commands'))
    writeFileSync(join(plugin, 'commands', 'greet.md'), '---\ndescription: Greets someone\n---\nSay a warm hello to $ARGUMENTS.')
    const folder = join(scratch, 'plain')
    mkdirSync(folder)
    writeFileSync(join(folder, 'a.txt'), 'hello\n')
    const page = await terraCode(folder)
    await say(page, '/plugin')
    const settings = page.getByRole('region', { name: 'Terra Code settings' })
    await settings.getByRole('textbox', { name: 'Plugin source' }).fill(plugin)
    await settings.getByRole('button', { name: 'Look' }).click()
    await expect(settings.getByText('/greet')).toBeVisible()
    await expect(settings.getByText('Says hello')).toBeVisible()
    await settings.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(settings.getByRole('list', { name: 'Installed plugins' })).toContainText('greeter')
    mock!.queue.push('Hello, Sam!')
    await say(page, '/greet Sam')
    await expect(page.getByText('Hello, Sam!')).toBeVisible()
    expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain('Say a warm hello to Sam.')
  })

  test('Shift+Tab reaches Auto, and the status line runs your own command', async () => {
    const folder = join(scratch, 'plain')
    mkdirSync(folder)
    writeFileSync(join(folder, 'a.txt'), 'hello\n')
    const page = await terraCode(folder, { settings: { coderStatusLine: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('ctx '+JSON.parse(s).model.display_name))"` } })
    await box(page).click()
    await box(page).press('Shift+Tab')
    await expect.poll(() => h.chrome.evaluate(() => window.scb.invoke('settings:get').then((settings) => settings.coderMode))).toBe('auto')
    mock!.queue.push('Hi.')
    await say(page, 'hello')
    await expect(page.getByText('Hi.', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Status line')).toHaveText('ctx mock-model')
  })
})

test.describe('AI in the browser', () => {
  test('a link preview’s Summarise sends the page to the assistant without opening it', async () => {
    await withMockModel()
    await go(h, site.url('/links'))
    await expect(activeTab(h)).toHaveText('Links')
    const page = await h.page('/links')
    await page.getByRole('link', { name: 'The otter article' }).click({ modifiers: ['Shift'] })
    const card = (await h.overlay()).getByRole('dialog', { name: /Preview of 127\.0\.0\.1/ })
    await expect(card).toContainText('All about otters')
    mock!.queue.push('A short page on otter habits.')
    await card.getByRole('button', { name: 'Summarise' }).click()
    const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
    await expect(panel.getByText('A short page on otter habits.')).toBeVisible()
    const asked = JSON.stringify(mock!.requests.at(-1)!.body.messages)
    expect(asked).toContain('Summarise the page I’m previewing')
    expect(asked).toContain('Otters hold hands while they sleep')
    await expect(h.chrome.getByRole('tab')).toHaveCount(1)
  })

  test('the assistant looks through history by itself when asked about something read before', async () => {
    await withMockModel()
    await go(h, site.url('/fruit'))
    await expect(activeTab(h)).toHaveText('Fruit stall prices')
    await shortcut(h, 'A', ['control', 'shift'])
    const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
    mock!.toolNames.push('search_history')
    mock!.toolQueue.push(['{"words":"fruit stall",', '"days":7}'])
    mock!.queue.push('You read “Fruit stall prices” today.')
    const input = panel.getByRole('textbox', { name: 'Message the assistant' })
    await input.fill('what was that fruit page I read?')
    await input.press('Enter')
    await expect(panel.getByText('You read “Fruit stall prices” today.')).toBeVisible()
    expect(mock!.requests.some((request) => request.body.tools?.some((one) => one.function?.name === 'search_history'))).toBe(true)
    expect(JSON.stringify(mock!.requests.at(-1)!.body.messages)).toContain(`Fruit stall prices | ${site.url('/fruit')}`)
    // Turned off, the tool isn't offered.
    await setSetting(h, { assistantHistory: false })
    mock!.queue.push('Fine.')
    await input.fill('and now?')
    await input.press('Enter')
    await expect(panel.getByText('Fine.')).toBeVisible()
    expect(mock!.requests.at(-1)!.body.tools?.some((one) => one.function?.name === 'search_history') ?? false).toBe(false)
  })

  test('the microphone turns speech into words in the box, through the AI service you set up', async () => {
    await withMockModel(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    await shortcut(h, 'A', ['control', 'shift'])
    const panel = h.chrome.getByRole('complementary', { name: 'Assistant' })
    const mic = panel.getByRole('button', { name: /^Speak instead of typing\. Mock AI \(on your network\) hears the recording\./ })
    await expect(mic).toBeVisible()
    await mic.click()
    const stop = panel.getByRole('button', { name: 'Stop and turn it into text' })
    await expect(stop).toBeVisible()
    await h.chrome.waitForTimeout(1200)
    await stop.click()
    await expect(panel.getByRole('textbox', { name: 'Message the assistant' })).toHaveValue('hello from the microphone')
    expect(mock!.audio).toHaveLength(1)
    expect(mock!.audio[0]).toBeGreaterThan(10_000)
  })
})

test.describe('screenshots and windows', () => {
  test('a screenshot can be marked up, copied and saved', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false, downloadDir: scratch })
    await go(h, site.url('/other'))
    await expect(activeTab(h)).toHaveText('Other page')
    await main((g) => g.scbActions.screenshotMarkup())
    const page = await h.page('sc://markup')
    const canvas = page.getByRole('img', { name: 'Screenshot to draw on' }).or(page.locator('canvas'))
    await expect(canvas.first()).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.querySelector('canvas')!.width)).toBeGreaterThan(100)
    const area = (await page.locator('canvas').boundingBox())!
    await page.mouse.move(area.x + 20, area.y + 20)
    await page.mouse.down()
    await page.mouse.move(area.x + 120, area.y + 80, { steps: 5 })
    await page.mouse.up()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled()
    await page.getByRole('button', { name: 'Blur', exact: true }).click()
    await page.mouse.move(area.x + 150, area.y + 20)
    await page.mouse.down()
    await page.mouse.move(area.x + 220, area.y + 60, { steps: 3 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Copy' }).click()
    await expect(page.getByRole('status')).toHaveText('Copied')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('status')).toContainText('Saved to')
    const saved = readdirSync(scratch).filter((name) => name.endsWith('.png'))
    expect(saved).toHaveLength(1)
    expect(readFileSync(join(scratch, saved[0]!)).subarray(1, 4).toString()).toBe('PNG')
  })

  test('a link from another app opens in a little window when that’s on', async () => {
    h = await launch()
    await setSetting(h, { httpsOnly: false, littleWindow: true })
    const url = site.url('/other')
    await h.app.evaluate(({ app }, address) => app.emit('second-instance', {}, ['electron', '.', address], '/'), url)
    await expect.poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    // The little one is an installed site's kind of window, with "Open in scTerra" in its bar.
    await expect.poll(() => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().includes('window=app')))).toBe(true)
    const widths = await h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getBounds().width))
    expect(Math.min(...widths)).toBeLessThanOrEqual(860)
    const bar = await h.page('window=app')
    await expect(bar.getByRole('button', { name: 'Open in scTerra' })).toBeVisible()
    // Off, the link is a tab in the browser as before.
    await setSetting(h, { littleWindow: false })
    await h.app.evaluate(({ app }, address) => app.emit('second-instance', {}, ['electron', '.', address], '/'), site.url('/notify'))
    await expect(h.chrome.getByRole('tab', { name: 'Notify' })).toBeVisible()
  })
})

