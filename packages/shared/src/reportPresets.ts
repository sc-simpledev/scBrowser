import type { ReportThemeId } from './report'

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
    shape: 'Sections: the big idea in a callout, key concepts as cards, a table of terms and definitions, and a final ordered list of practice questions.'
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
  return asked ? `${asked[1]}: ${asked[4]}` : null
}
