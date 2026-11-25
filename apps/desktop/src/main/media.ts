import type { WebContents, WebFrameMain } from 'electron'

/**
 * Now playing's controls, run in every frame of a tab, as players often sit in an embedded frame.
 * They only press the page's own play, pause and picture-in-picture, the way its buttons would.
 * Each returns how many players it found, so the caller can say when there were none.
 */
const SCRIPTS = {
  // What it paused is marked, so play picks the same players up again.
  pause: `(() => {
    let n = 0
    for (const media of document.querySelectorAll('video, audio')) {
      if (!media.paused) { media.pause(); media.dataset.scPaused = '1'; n++ }
    }
    return n
  })()`,
  play: `(() => {
    const all = [...document.querySelectorAll('video, audio')]
    let picked = all.filter((media) => media.dataset.scPaused === '1')
    if (picked.length === 0) {
      const area = (media) => media.getBoundingClientRect().width * media.getBoundingClientRect().height
      const best = all.filter((media) => media.readyState > 0).sort((a, b) => area(b) - area(a))[0]
      picked = best ? [best] : []
    }
    for (const media of picked) { delete media.dataset.scPaused; void media.play().catch(() => {}) }
    return picked.length
  })()`,
  pip: `(async () => {
    if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return 1 }
    const area = (video) => video.getBoundingClientRect().width * video.getBoundingClientRect().height
    const videos = [...document.querySelectorAll('video')].filter((video) => video.readyState > 0 && !video.disablePictureInPicture)
    const best = videos.find((video) => !video.paused) ?? videos.sort((a, b) => area(b) - area(a))[0]
    if (!best) return 0
    await best.requestPictureInPicture()
    return 1
  })()`,
  enterPip: `(async () => {
    if (document.pictureInPictureElement) return 1
    const video = [...document.querySelectorAll('video')].find((video) => !video.paused && video.readyState > 1 && !video.disablePictureInPicture && video.getBoundingClientRect().width >= 160)
    if (!video) return 0
    await video.requestPictureInPicture()
    return 1
  })()`,
  leavePip: `(async () => {
    if (!document.pictureInPictureElement) return 0
    await document.exitPictureInPicture()
    return 1
  })()`
} as const

export type MediaScript = keyof typeof SCRIPTS

const speedScript = (rate: number) => `(() => {
  let n = 0
  for (const media of document.querySelectorAll('video, audio')) { media.playbackRate = ${rate}; n++ }
  return n
})()`

function framesOf(contents: WebContents): WebFrameMain[] {
  try {
    return contents.mainFrame.framesInSubtree.filter((frame) => !frame.isDestroyed?.())
  } catch {
    return []
  }
}

/** Runs one control in every frame, as a press by the person: picture in picture needs that. */
async function inFrames(contents: WebContents, code: string): Promise<number> {
  if (contents.isDestroyed()) return 0
  const counts = await Promise.all(framesOf(contents).map((frame) => frame.executeJavaScript(code, true).then((n: unknown) => (typeof n === 'number' ? n : 0)).catch(() => 0)))
  return counts.reduce((sum, n) => sum + n, 0)
}

export const runMedia = (contents: WebContents, script: MediaScript) => inFrames(contents, SCRIPTS[script])

export function setMediaSpeed(contents: WebContents, rate: number): Promise<number> {
  if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) return Promise.resolve(0)
  return inFrames(contents, speedScript(rate))
}
