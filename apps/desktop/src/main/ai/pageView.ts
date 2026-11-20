/** What the page-view script reads from a page. */
export interface PageView {
  title: string
  description: string
  text: string
  visible: string
  links: string
  bodyChars: number
  scrolled: number
}

/**
 * What the model is given for a web page. An article that is most of the page goes as the article
 * (cleaner, and cheaper); anything else goes as the whole page's structure. Either way, what's on
 * screen comes first, and links follow, so it can point to them.
 */
export function pageText(article: { text: string }, view: PageView): string {
  // A real article: long, and most of the page. Short pages keep their structure (tables, buttons, fields).
  const isArticle = article.text.length >= 1500 && article.text.length >= view.bodyChars * 0.6
  const body = isArticle ? article.text : view.text || article.text
  const parts = [
    view.description && `Description: ${view.description}`,
    view.visible && `On screen now (scrolled ${view.scrolled}% down):\n${view.visible}`,
    `${isArticle ? 'The article' : 'The whole page'}:\n${body}`,
    view.links && `Links on the page:\n${view.links}`
  ]
  return parts.filter(Boolean).join('\n\n')
}
