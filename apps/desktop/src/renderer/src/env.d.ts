import type { ChromeBridge, InternalBridge, OverlayBridge } from '@scbrowser/shared'

declare global {
  interface Window {
    scb: ChromeBridge
    scbOverlay: OverlayBridge
    scbInternal: InternalBridge
  }
}
