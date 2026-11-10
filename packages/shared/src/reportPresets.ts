import type { Report, ReportThemeId } from './report'

export interface ReportPreset {
  id: string
  name: string
  /** One line for the gallery. */
  description: string
  /** A Lucide icon name, drawn by the interface. */
  icon: string
  theme: ReportThemeId
  /** How the report should be laid out, in the model's words. */
  shape: string
}

/** Ready-made kinds of report. Each picks a design and tells the model what to put where. */
export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: 'compare',
    name: 'Compare these tabs',
    description: 'A side-by-side table of the pages you picked',
    icon: 'Columns3',
    theme: 'clean',
    shape: 'Open with a callout naming the best choice and why, in two sentences. Then one table with a column for each page and a row for each thing worth comparing (price, features, limits and so on, whatever these pages share); write "not stated" where a page does not say, and never guess. Then proscons for each page if they differ meaningfully, and finish with a section on who should pick which.'
  },
  {
    id: 'brief',
    name: 'Research brief',
    description: 'What it is, what matters, and what to read next',
    icon: 'BookOpen',
    theme: 'clean',
    shape: 'Open with a callout giving the answer in two sentences. Then stats for up to four key figures if the material has real ones, sections for background, key findings and open questions, and finish with a list of what to look into next.'
  },
  {
    id: 'executive',
    name: 'Executive summary',
    description: 'One page for someone with five minutes',
    icon: 'Briefcase',
    theme: 'brief',
    shape: 'Keep it under 400 words. Start with a callout holding the bottom line, then stats for the headline numbers, then three short sections: situation, what it means, and recommended actions as an ordered list.'
  },
  {
    id: 'comparison',
    name: 'Comparison',
    description: 'Options side by side, with a verdict',
    icon: 'Columns3',
    theme: 'modern',
    shape: 'Put the options in a table, one column each, with rows for the criteria that matter. Add a cards block with one card per option giving who it suits. End with a callout naming the best choice and why.'
  },
  {
    id: 'proscons',
    name: 'Pros and cons',
    description: 'The trade-offs, weighed up',
    icon: 'Scale',
    theme: 'clean',
    shape: 'Start with one paragraph framing the decision, then a proscons block, then a short section on what would change the answer, and a callout with a balanced conclusion.'
  },
  {
    id: 'decision',
    name: 'Decision memo',
    description: 'Options, risks and a recommendation',
    icon: 'Signpost',
    theme: 'brief',
    shape: 'Sections: the decision to make, options as cards, risks as a table with likelihood and impact columns, and the recommendation as a callout followed by next steps.'
  },
  {
    id: 'swot',
    name: 'SWOT analysis',
    description: 'Strengths, weaknesses, opportunities and threats',
    icon: 'LayoutGrid',
    theme: 'modern',
    shape: 'Open with a short paragraph of context. Then a cards block with exactly four cards titled Strengths, Weaknesses, Opportunities and Threats, each holding two or three short points in one sentence each. End with a section on what to do about it.'
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'How it unfolded, in order',
    icon: 'History',
    theme: 'editorial',
    shape: 'A short introduction, then a timeline block with the events in order, then sections on turning points and what came after. Only use dates that the material or well-known history supports.'
  },
  {
    id: 'howto',
    name: 'How-to guide',
    description: 'Clear steps from start to finish',
    icon: 'ListChecks',
    theme: 'modern',
    shape: 'Begin with a callout listing what you need first. Then a steps block with each step as a short title and a sentence or two. Finish with a section of common problems and fixes.'
  },
  {
    id: 'study',
    name: 'Study notes',
    description: 'Key ideas, terms and questions to test yourself',
    icon: 'GraduationCap',
    theme: 'notebook',
    shape: 'Sections: the big idea in a callout, key concepts as cards, a table of terms and definitions, and finish with a quiz block of five to eight practice questions, each with a short answer.'
  },
  {
    id: 'literature',
    name: 'Literature review',
    description: 'What the sources say, and where they disagree',
    icon: 'Library',
    theme: 'academic',
    shape: 'A formal tone. Sections: scope, main themes, points of agreement, points of disagreement, gaps in what is known, and a conclusion. Quote sources sparingly with quote blocks, and name the sources the material gives.'
  },
  {
    id: 'review',
    name: 'Product review',
    description: 'A verdict, a score and who it is for',
    icon: 'Star',
    theme: 'magazine',
    shape: 'Start with stats holding a score out of 10 and one or two key specs, then a callout verdict. Then a proscons block, sections on design, performance and value, and cards for who should and shouldn’t buy it.'
  },
  {
    id: 'trip',
    name: 'Trip plan',
    description: 'Day by day, with what to book and pack',
    icon: 'Map',
    theme: 'magazine',
    shape: 'Start with stats for length, rough budget and best time to go if known. Then a timeline with one item per day, a table of places to stay or book, and a list of what to pack.'
  },
  {
    id: 'meeting',
    name: 'Meeting notes',
    description: 'Decisions, actions and owners',
    icon: 'Users',
    theme: 'brief',
    shape: 'Sections: summary in a callout, decisions made as a list, action items as a table with action, owner and due date columns, and open questions.'
  },
  {
    id: 'factsheet',
    name: 'Fact sheet',
    description: 'The essentials on one page',
    icon: 'Info',
    theme: 'modern',
    shape: 'Stats for the headline facts, a table of key details, cards for three to six things worth knowing, and a short list of sources or where to learn more.'
  },
  {
    id: 'explainer',
    name: 'Explainer',
    description: 'A topic made simple, from the ground up',
    icon: 'Lightbulb',
    theme: 'editorial',
    shape: 'Write for someone new to the topic. Start with a callout giving the one-sentence version, then sections that build up step by step, cards for common misconceptions, and a short glossary table.'
  },
  {
    id: 'news',
    name: 'News roundup',
    description: 'What happened, why it matters, what’s next',
    icon: 'Newspaper',
    theme: 'magazine',
    shape: 'A short lead paragraph, then cards with one card per story or development, a timeline if the order matters, and a section on what to watch next. Stick to what the material says.'
  }
]

export const presetById = (id: string): ReportPreset | undefined => REPORT_PRESETS.find((preset) => preset.id === id)

const PRESET_ASK = /^Write a "(.+?)" report(?: about (this page))?\. Use the (\w+) theme and set "kind" to "\1"\. Layout: [\s\S]*?\n\nTopic: ([\s\S]*)$/

/** The message sent for a preset. What the person typed stays at the end, so it reads back cleanly. */
export function presetPrompt(preset: ReportPreset, topic: string, aboutPage: boolean): string {
  const asked = topic.trim() || (aboutPage ? 'this page' : preset.name)
  return `Write a "${preset.name}" report${aboutPage ? ' about this page' : ''}. Use the ${preset.theme} theme and set "kind" to "${preset.name}". Layout: ${preset.shape}\n\nTopic: ${asked}`
}

/** What to show for a preset message: the kind and the topic, not the layout instructions. */
export function shownPresetMessage(content: string): string | null {
  const asked = PRESET_ASK.exec(content)
  if (!asked) return null
  // A topic that already starts with the kind, like "Study notes: slide 1", doesn't need it twice.
  return asked[4]!.toLowerCase().startsWith(`${asked[1]!.toLowerCase()}:`) ? asked[4]! : `${asked[1]}: ${asked[4]}`
}

/** Report kinds people made themselves, from a report whose layout they liked. */
export const MAX_CUSTOM_PRESETS = 30
export const CUSTOM_PRESET_PREFIX = 'mine-'

const BLOCK_WORDS: Record<string, string> = {
  paragraph: 'a paragraph', list: 'a list', quote: 'a quote', callout: 'a callout', table: 'a table', stats: 'stats',
  timeline: 'a timeline', proscons: 'a proscons block', cards: 'cards', steps: 'steps', quiz: 'a quiz block'
}

/**
 * The layout of a report, put into words as a preset's instructions. Only the structure and the
 * headings are kept, never the content, so the template works for any topic.
 */
export function templateFrom(report: Report, name: string): ReportPreset {
  const parts: string[] = []
  let section: { title: string; blocks: string[] } | null = null
  const opening: string[] = []
  const add = (word: string) => {
    const list = section ? section.blocks : opening
    if (list.at(-1) !== word) list.push(word)
  }
  const sections: { title: string; blocks: string[] }[] = []
  for (const block of report.blocks) {
    if (block.type === 'heading' && block.level === 2) {
      section = { title: block.text, blocks: [] }
      sections.push(section)
    } else if (BLOCK_WORDS[block.type]) add(BLOCK_WORDS[block.type]!)
  }
  if (opening.length) parts.push(`Open with ${opening.join(', then ')}.`)
  if (sections.length) parts.push(`Then these sections, in order: ${sections.map((part) => `"${part.title}"${part.blocks.length ? ` with ${part.blocks.join(', then ')}` : ''}`).join('; ')}. Keep the section names, changing them only where the topic needs it.`)
  const clean = name.trim().slice(0, 60) || report.kind || report.title.slice(0, 60)
  return {
    id: `${CUSTOM_PRESET_PREFIX}${Date.now().toString(36)}`,
    name: clean,
    description: sections.length ? `${sections.length} sections, like “${report.title.slice(0, 40)}”` : `Laid out like “${report.title.slice(0, 40)}”`,
    icon: 'FileText',
    theme: report.theme,
    shape: (parts.join(' ') || 'Use the same plain layout as before.').slice(0, 1500)
  }
}

export const isCustomPreset = (value: unknown): value is ReportPreset => {
  const preset = value as Record<string, unknown> | null
  return (
    typeof preset === 'object' && preset !== null &&
    typeof preset.id === 'string' && preset.id.startsWith(CUSTOM_PRESET_PREFIX) && preset.id.length <= 40 &&
    typeof preset.name === 'string' && preset.name.length > 0 && preset.name.length <= 60 && !/["\n]/.test(preset.name) &&
    typeof preset.description === 'string' && preset.description.length <= 120 &&
    typeof preset.icon === 'string' && typeof preset.theme === 'string' &&
    typeof preset.shape === 'string' && preset.shape.length <= 1500
  )
}

/** Turns a video into a report: its transcript goes along as the page, and times are cited like [1:23]. */
export const videoReportPrompt = (preset: ReportPreset) =>
  presetPrompt({ ...preset, shape: `${preset.shape} This is a video: work from its transcript, and after each point give the time it comes from, like [1:23], so it can be jumped to.` }, 'this video', true)
