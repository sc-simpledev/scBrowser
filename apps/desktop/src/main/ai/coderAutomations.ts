import { randomBytes } from 'node:crypto'
import { AUTOMATIONS_WORKFLOW_PATH, CLOUD_SECRET, RUNNER_DOWNLOAD_URL, type CoderAutomations, type CoderCloudModel } from '@scbrowser/shared'
import { sealForGithub } from './coderCloud'
import { GithubError, type CoderGithub } from './coderGithub'

/** A value for a single-quoted YAML string. */
const yamlQuote = (text: string) => `'${text.replace(/'/g, "''")}'`

/**
 * The workflow that lets Terra Code work on GitHub by itself: when someone who can push comments
 * "@terra …" on an issue or pull request, on the person's timetable, or when started by hand. It
 * downloads the runner from scTerra's latest release, so it stays current without changes here.
 */
export function automationsWorkflow(automations: CoderAutomations): string {
  const triggers = [
    ...(automations.comments ? ['  issue_comment:', '    types: [created]'] : []),
    ...(automations.schedules.length ? ['  schedule:', ...automations.schedules.map((one) => `    - cron: ${yamlQuote(one.cron)}`)] : []),
    '  workflow_dispatch:',
    '    inputs:',
    '      task:',
    '        description: What Terra Code should do',
    '        required: true'
  ]
  const schedules = JSON.stringify(automations.schedules.map(({ cron, task, pr }) => ({ cron, task, pr })))
  return `# Made by scTerra: Terra Code works here when someone who can push comments @terra on an issue
# or pull request${automations.schedules.length ? ', on the timetable below,' : ''} or when started from the Actions tab.
# Change it from Terra Code's settings in scTerra, or delete this file to stop it.
name: Terra Code
on:
${triggers.join('\n')}
permissions:
  contents: write
  pull-requests: write
  issues: write
  checks: write
concurrency:
  group: terra-code-\${{ github.event.issue.number || github.run_id }}
jobs:
  terra-code:
    # Only people who can already push may spend the key on a comment.
    if: github.event_name != 'issue_comment' || (contains(github.event.comment.body, '@terra') && contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association))
    runs-on: ubuntu-latest
    timeout-minutes: 300
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Get Terra Code
        run: curl -fsSL -o "$RUNNER_TEMP/runner.mjs" ${RUNNER_DOWNLOAD_URL}
      - name: Terra Code works on it
        env:
          ${CLOUD_SECRET}: \${{ secrets.${CLOUD_SECRET} }}
          GITHUB_TOKEN: \${{ github.token }}
          SCTERRA_MODEL: \${{ vars.SCTERRA_MODEL }}
          SCTERRA_SCHEDULES: ${yamlQuote(schedules)}
        run: node "$RUNNER_TEMP/runner.mjs" --event
`
}

/**
 * Installs (or changes) the workflow through a pull request, so nothing lands on the person's
 * default branch until they merge it. The model's key goes in as a repository secret and where to
 * reach the model as a repository variable.
 */
export async function installAutomations(github: CoderGithub, repo: string, automations: CoderAutomations, model: { model: CoderCloudModel; secret: string | null }): Promise<string> {
  const info = await github.call<{ default_branch: string }>('GET', `/repos/${repo}`)
  const base = info.default_branch
  if (model.model.needsKey) {
    if (!model.secret) throw new Error('This model needs a key, and none is saved for it. Add one in AI settings.')
    const key = await github.call<{ key_id: string; key: string }>('GET', `/repos/${repo}/actions/secrets/public-key`)
    await github.call('PUT', `/repos/${repo}/actions/secrets/${CLOUD_SECRET}`, { encrypted_value: sealForGithub(key.key, model.secret), key_id: key.key_id })
  }
  const value = JSON.stringify(model.model)
  try {
    await github.call('PATCH', `/repos/${repo}/actions/variables/SCTERRA_MODEL`, { name: 'SCTERRA_MODEL', value })
  } catch (error) {
    if (!(error instanceof GithubError && error.status === 404)) throw error
    await github.call('POST', `/repos/${repo}/actions/variables`, { name: 'SCTERRA_MODEL', value })
  }
  const sha = (await github.call<{ commit: { sha: string } }>('GET', `/repos/${repo}/branches/${encodeURIComponent(base)}`)).commit.sha
  const branch = `scterra/install-${randomBytes(3).toString('hex')}`
  await github.call('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha })
  const existing = await github.call<{ sha: string }>('GET', `/repos/${repo}/contents/${AUTOMATIONS_WORKFLOW_PATH}?ref=${encodeURIComponent(base)}`).catch(() => null)
  await github.call('PUT', `/repos/${repo}/contents/${AUTOMATIONS_WORKFLOW_PATH}`, {
    message: existing ? 'Change Terra Code on GitHub' : 'Add Terra Code on GitHub',
    content: Buffer.from(automationsWorkflow(automations)).toString('base64'),
    branch,
    ...(existing?.sha ? { sha: existing.sha } : {})
  })
  const lines = [
    automations.comments && '- Comment `@terra` and what you want on an issue or pull request. Only people who can push here can start it.',
    ...automations.schedules.map((one) => `- ${one.label}: ${one.task.split('\n')[0]!.slice(0, 120)}`),
    '- Or start it by hand from the Actions tab.'
  ].filter(Boolean)
  const pull = await github.call<{ html_url: string }>('POST', `/repos/${repo}/pulls`, {
    title: existing ? 'Change Terra Code on GitHub' : 'Add Terra Code on GitHub',
    head: branch,
    base,
    body: `This lets Terra Code work on this repository by itself, in GitHub Actions:\n\n${lines.join('\n')}\n\nIt uses the model chosen in scTerra (repository variable \`SCTERRA_MODEL\`, key in the secret \`${CLOUD_SECRET}\`), and your Actions minutes. Nothing runs until this is merged.\n\n---\nMade by scTerra.`
  })
  return pull.html_url
}
