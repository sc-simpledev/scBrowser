import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ session: {} }))
const { decodeEntities, htmlToText, parseResults, resultAddress } = await import('./webSearch')

describe('web search', () => {
  it('takes the real address out of the redirect and skips adverts', () => {
    expect(resultAddress('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=x')).toBe('https://example.com/a?b=1')
    expect(resultAddress('https://duckduckgo.com/y.js?ad_domain=x')).toBeNull()
    expect(resultAddress('javascript:alert(1)')).toBeNull()
  })

  it('reads results from the HTML page', () => {
    const html = `
      <div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fone.test%2F">One &amp; only</a></h2>
      <a class="result__snippet" href="x">First <b>snippet</b></a></div>
      <div class="result"><h2><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftwo.test%2Fpage">Two</a></h2>
      <a class="result__snippet" href="x">Second</a></div>`
    expect(parseResults(html)).toEqual([
      { url: 'https://one.test/', title: 'One & only', snippet: 'First snippet' },
      { url: 'https://two.test/page', title: 'Two', snippet: 'Second' }
    ])
  })

  it('reads results from the lite page', () => {
    const html = `<tr><td><a rel="nofollow" href="https://lite.test/x" class='result-link'>Lite result</a></td></tr>
      <tr><td class='result-snippet'>Lite snippet</td></tr>`
    expect(parseResults(html)).toEqual([{ url: 'https://lite.test/x', title: 'Lite result', snippet: 'Lite snippet' }])
  })

  it('turns a page into text without its scripts, menus or footers', () => {
    const { title, text } = htmlToText('<html><head><title>T &#8211; x</title><script>evil()</script></head><body><nav>Menu</nav><p>Hello&nbsp;there</p><ul><li>One</li></ul><footer>Foot</footer></body></html>')
    expect(title).toBe('T – x')
    expect(text).toContain('Hello there')
    expect(text).toContain('• One')
    expect(text).not.toMatch(/evil|Menu|Foot/)
  })

  it('reads a page of many cards as a whole, and keeps an article\'s own headline', () => {
    const cards = htmlToText('<body><article><p>First teaser</p></article><article><p>Second teaser</p></article></body>')
    expect(cards.text).toContain('First teaser')
    expect(cards.text).toContain('Second teaser')
    const story = htmlToText('<body><header><a>Site</a></header><article><header><h1>The headline</h1></header><p>The story</p></article></body>')
    expect(story.text).toContain('The headline')
    expect(story.text).not.toContain('Site')
  })

  it('decodes entities', () => {
    expect(decodeEntities('&lt;a&gt; &#x27;b&#39; &unknown;')).toBe("<a> 'b' &unknown;")
  })
})
