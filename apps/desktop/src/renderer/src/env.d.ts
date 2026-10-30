import type { ChromeBridge, OverlayBridge } from '@scbrowser/shared'

declare global {
  interface Window {
    scb: ChromeBridge
    scbOverlay: OverlayBridge
  }
}
