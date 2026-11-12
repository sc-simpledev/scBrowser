import { describe, expect, it } from 'vitest'
import { aiTweaksOf, cleanAiCss, tweakCommand, withAiTweak, withoutLastAiTweak } from './siteAiTweak'

describe('AI site tweaks', () => {
  it('reads the command', () => {
    expect(tweakCommand('/tweak hide the sidebar')).toBe('hide the sidebar')
    expect(tweakCommand('/tweak')).toBe('')
    expect(tweakCommand('tweak this')).toBeNull()
  })

  it('keeps plain CSS and refuses anything that loads from elsewhere', () => {
    expect(cleanAiCss('```css\n#side { display: none !important; }\n```')).toBe('#side { display: none !important; }')
    expect(cleanAiCss('body { background: url(https://evil.test/x) }')).toBeNull()
    expect(cleanAiCss('@import "https://evil.test/a.css"; p { color: red }')).toBeNull()
    expect(cleanAiCss('p { color: red } } body { display: none }')).toBeNull()
    expect(cleanAiCss('CANNOT')).toBeNull()
    expect(cleanAiCss('Sure, here you go!')).toBeNull()
  })

  it('adds a marked block and takes the newest back out', () => {
    const one = withAiTweak('p { margin: 0 }', 'hide the */ sidebar', '#side { display: none !important; }')!
    expect(aiTweaksOf(one)).toEqual(['hide the sidebar'])
    const two = withAiTweak(one, 'bigger text', 'p { font-size: 20px !important; }')!
    expect(aiTweaksOf(two)).toEqual(['hide the sidebar', 'bigger text'])
    expect(withoutLastAiTweak(two)).toBe(one)
    expect(withoutLastAiTweak(one).trim()).toBe('p { margin: 0 }')
  })
})
