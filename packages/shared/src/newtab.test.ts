import { describe, expect, it } from 'vitest'
import { DEFAULT_NEW_TAB, imageType, isDarkColor, isNewTabConfig } from './newtab'
import { scrubStack } from './reports'
import { sanitizeSettings } from './settings'

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])))

describe('new tab settings', () => {
  it('accepts the defaults and older partial settings', () => {
    expect(isNewTabConfig(DEFAULT_NEW_TAB)).toBe(true)
    expect(isNewTabConfig({ dim: 10 })).toBe(true)
  })

  it.each([
    [{ widgets: [{ id: 'nope', size: 'full' }] }],
    [{ widgets: [{ id: 'clock', size: 'full' }, { id: 'clock', size: 'half' }] }],
    [{ color: 'red;background:url(x)' }],
    [{ dim: 99 }],
    [{ links: [{ title: 'x', url: 'javascript:alert(1)' }] }],
    [{ unknown: true }]
  ])('rejects %j', (value) => {
    expect(isNewTabConfig(value)).toBe(false)
    expect(sanitizeSettings({ newTab: value })).toEqual({})
  })
})

describe('imageType', () => {
  it('goes by the bytes, whatever the file is called', () => {
    expect(imageType(bytes(0x89, 'PNG', 13, 10))).toBe('image/png')
    expect(imageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(imageType(bytes('GIF89a'))).toBe('image/gif')
    expect(imageType(bytes('RIFF', 1, 2, 3, 4, 'WEBP'))).toBe('image/webp')
    expect(imageType(bytes(0, 0, 0, 32, 'ftypavif'))).toBe('image/avif')
  })

  it('refuses SVG and anything else', () => {
    expect(imageType(bytes('<svg onload="alert(1)">'))).toBeNull()
    expect(imageType(bytes('<html>'))).toBeNull()
    expect(imageType(new Uint8Array())).toBeNull()
  })
})

it('picks readable text for a colour', () => {
  expect(isDarkColor('#101010')).toBe(true)
  expect(isDarkColor('#f0f0f0')).toBe(false)
})

describe('scrubStack', () => {
  it('drops the message and folders', () => {
    const stack = `TypeError: secret https://bank.example/a\n    at run (/home/alex/app/out/main/index.js:10:2)\n    at C:\\Users\\alex\\app\\x.js:1:1`
    expect(scrubStack(stack)).toBe('at run (index.js:10:2)\nat x.js:1:1')
  })
})
