import { describe, expect, it } from 'vitest'
import { countSelfLoad, RELOAD_LOOP_LIMIT, RELOAD_LOOP_WINDOW_MS } from './tabs/TabManager'
import { mayPress, notePress } from './cookieBanners'

describe('countSelfLoad', () => {
  it('only calls it a loop past the limit inside the window', () => {
    let times: number[] = []
    let looping = false
    for (let i = 0; i <= RELOAD_LOOP_LIMIT; i++) ({ times, looping } = countSelfLoad(times, 1000 + i * 100))
    expect(looping).toBe(true)
    const spaced = Array.from({ length: RELOAD_LOOP_LIMIT }, (_, i) => i * RELOAD_LOOP_WINDOW_MS)
    expect(countSelfLoad(spaced, RELOAD_LOOP_LIMIT * RELOAD_LOOP_WINDOW_MS).looping).toBe(false)
  })
})

describe('cookie banner presses', () => {
  it('stops pressing on a site that keeps showing its banner', () => {
    const site = 'loop.example'
    expect(mayPress(site, 0)).toBe(true)
    notePress(site, 0)
    notePress(site, 1000)
    expect(mayPress(site, 2000)).toBe(false)
    expect(mayPress(site, 10 * 60_000)).toBe(true)
  })
})
