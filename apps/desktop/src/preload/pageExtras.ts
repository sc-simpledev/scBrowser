import { ipcRenderer } from 'electron'
import { GESTURE_ACTIONS, gestureFrom, type GestureAction } from '@scbrowser/shared'

/*
 * Mouse gestures and middle-click scrolling, for websites, when the person turned them on. They run
 * in the preload's own world, so a page can't see them or pretend to be one, and only reach the main
 * process to go back, forward, close a tab and the like.
 *
 * This build has no DOM types, so the few browser objects used here are declared loosely.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// Everything goes through the global object: early in a sandboxed preload, `window` and bare calls
// like getComputedStyle() can throw "Illegal invocation".
const page = globalThis as any
const doc = () => page.document

/** A small fixed label or ring drawn over the page, in a shadow root the page's styles can't reach. */
function marker(css: string): { host: any; box: any; remove: () => void } {
  const host = doc().createElement('scterra-marker')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647'
  const root = host.attachShadow({ mode: 'closed' })
  const box = doc().createElement('div')
  box.style.cssText = css
  root.append(box)
  doc().documentElement.append(host)
  return { host, box, remove: () => host.remove() }
}

const LABELS: Record<GestureAction, string> = Object.fromEntries(GESTURE_ACTIONS.map((action) => [action.id, action.label])) as Record<GestureAction, string>

/**
 * Hold the right button and draw. Where menus open as the button goes down (Linux, Mac), the menu
 * waits for the button to come up, and opens then if nothing was drawn.
 */
export function mouseGestures(enabled: () => boolean): void {
  let stroke: { lastX: number; lastY: number; path: string; moved: boolean; menuHeld: boolean } | null = null
  let swallowMenu = false
  let replaying = false
  let hint: ReturnType<typeof marker> | null = null
  const clearHint = () => {
    hint?.remove()
    hint = null
  }

  page.addEventListener(
    'mousedown',
    (event: any) => {
      if (!event.isTrusted || event.button !== 2 || replaying || !enabled()) return
      stroke = { lastX: event.clientX, lastY: event.clientY, path: '', moved: false, menuHeld: false }
    },
    true
  )
  page.addEventListener(
    'mousemove',
    (event: any) => {
      if (!stroke) return
      if (!(event.buttons & 2)) {
        stroke = null
        clearHint()
        return
      }
      const dx = event.clientX - stroke.lastX
      const dy = event.clientY - stroke.lastY
      if (Math.hypot(dx, dy) < 28) return
      const step = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'
      if (!stroke.path.endsWith(step)) stroke.path += step
      stroke.lastX = event.clientX
      stroke.lastY = event.clientY
      stroke.moved = true
      const action = gestureFrom(stroke.path)
      hint ??= marker(
        'position: fixed; padding: 6px 10px; border-radius: 6px; font: 500 13px/1.2 system-ui, sans-serif; color: #fff; background: rgba(20, 22, 26, 0.86); box-shadow: 0 2px 8px rgba(0,0,0,.25); white-space: nowrap'
      )
      hint.box.textContent = action ? LABELS[action] : 'No gesture'
      hint.box.style.left = `${event.clientX + 16}px`
      hint.box.style.top = `${event.clientY + 16}px`
    },
    true
  )
  page.addEventListener(
    'contextmenu',
    (event: any) => {
      if (replaying) {
        replaying = false
        return
      }
      // The button is still down: this system opens menus on press, so it waits to see if a gesture comes.
      if (stroke) {
        stroke.menuHeld = true
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      if (swallowMenu) {
        swallowMenu = false
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true
  )
  page.addEventListener(
    'mouseup',
    (event: any) => {
      if (event.button !== 2 || !stroke) return
      const { path, moved, menuHeld } = stroke
      stroke = null
      clearHint()
      const action = gestureFrom(path)
      if (moved) {
        // Systems that open menus on release send one after this, which a stroke never wants.
        swallowMenu = !menuHeld
        page.setTimeout(() => (swallowMenu = false), 400)
        if (!action) return
        if (action === 'top') return page.scrollTo({ top: 0, behavior: 'smooth' })
        if (action === 'bottom') return page.scrollTo({ top: doc().scrollingElement?.scrollHeight ?? 0, behavior: 'smooth' })
        ipcRenderer.send('page:gesture', action)
        return
      }
      // A plain right click: the menu held back on press opens now.
      if (menuHeld) {
        replaying = true
        page.setTimeout(() => (replaying = false), 1000)
        ipcRenderer.send('page:context-menu', event.clientX, event.clientY)
      }
    },
    true
  )
  page.addEventListener('blur', () => {
    stroke = null
    clearHint()
  })
}

/** The nearest box under the pointer that can scroll, or the page itself. */
function scrollerAt(start: any): any {
  for (let element = start; element && element !== doc().documentElement; element = element.parentElement) {
    const style = page.getComputedStyle(element)
    const tall = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
    const wide = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1
    if (tall || wide) return element
  }
  return doc().scrollingElement
}

/**
 * Press the middle button on a page and move away from the mark to scroll that way, faster the
 * further you go, as on Windows and in Firefox. Press again, or Escape, to stop. Held and dragged,
 * it stops when the button comes up.
 */
export function middleClickScroll(enabled: () => boolean): void {
  let run: { x: number; y: number; pointerX: number; pointerY: number; scroller: any; ring: ReturnType<typeof marker>; frame: number; dragged: boolean; cursor: string } | null = null

  const stop = () => {
    if (!run) return
    page.cancelAnimationFrame(run.frame)
    run.ring.remove()
    doc().documentElement.style.cursor = run.cursor
    run = null
  }
  const speed = (offset: number) => {
    const past = Math.abs(offset) - 12
    return past <= 0 ? 0 : Math.sign(offset) * Math.min(80, (past / 10) ** 1.4)
  }
  const tick = () => {
    if (!run) return
    const target = run.scroller === doc().scrollingElement ? page : run.scroller
    target.scrollBy(speed(run.pointerX - run.x), speed(run.pointerY - run.y))
    run.frame = page.requestAnimationFrame(tick)
  }

  page.addEventListener(
    'mousedown',
    (event: any) => {
      if (run) {
        event.preventDefault()
        event.stopImmediatePropagation()
        stop()
        return
      }
      if (!event.isTrusted || event.button !== 1 || !enabled()) return
      const target = event.target
      // Links open in a new tab, and fields paste, as they always do.
      if (target?.closest?.('a[href], input, textarea, select, button, [contenteditable=""], [contenteditable="true"], video, audio, embed, object')) return
      const scroller = scrollerAt(target)
      if (!scroller) return
      event.preventDefault()
      const ring = marker(
        `position: fixed; left: ${event.clientX - 14}px; top: ${event.clientY - 14}px; width: 28px; height: 28px; border-radius: 50%; box-sizing: border-box; border: 1.5px solid rgba(20, 22, 26, 0.7); background: rgba(255, 255, 255, 0.85) radial-gradient(circle, rgba(20,22,26,.75) 0 2.5px, transparent 3px); box-shadow: 0 1px 4px rgba(0,0,0,.25)`
      )
      const cursor = doc().documentElement.style.cursor
      doc().documentElement.style.cursor = 'all-scroll'
      run = { x: event.clientX, y: event.clientY, pointerX: event.clientX, pointerY: event.clientY, scroller, ring, frame: 0, dragged: false, cursor }
      run.frame = page.requestAnimationFrame(tick)
    },
    true
  )
  page.addEventListener(
    'mousemove',
    (event: any) => {
      if (!run) return
      run.pointerX = event.clientX
      run.pointerY = event.clientY
      if (Math.hypot(event.clientX - run.x, event.clientY - run.y) > 16 && event.buttons & 4) run.dragged = true
    },
    true
  )
  page.addEventListener(
    'mouseup',
    (event: any) => {
      if (run && event.button === 1 && run.dragged) stop()
    },
    true
  )
  // Linux pastes on a middle click; while scrolling, that click belongs to the scroll.
  page.addEventListener(
    'auxclick',
    (event: any) => {
      if (event.button === 1 && run) event.preventDefault()
    },
    true
  )
  page.addEventListener('keydown', (event: any) => run && event.key === 'Escape' && stop(), true)
  page.addEventListener('wheel', stop, true)
  page.addEventListener('blur', stop)
}

/**
 * Block autoplay: sound or video that starts before the person has pressed anything on the page is
 * paused, as Safari and Firefox do. Chromium's own autoplay policy can't do it here, as a page loaded
 * from the address bar already counts as pressed. Muted video (backgrounds, GIF-like clips) plays on.
 * Players inside frames are left to Chromium's policy, which the tab also gets.
 */
export function holdAutoplay(): void {
  let pressed = false
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    page.addEventListener(
      type,
      (event: any) => {
        if (event.isTrusted) pressed = true
      },
      true
    )
  }
  page.addEventListener(
    'play',
    (event: any) => {
      const media = event.target
      if (pressed || !media || typeof media.pause !== 'function' || media.muted || media.volume === 0) return
      media.pause()
    },
    true
  )
}

