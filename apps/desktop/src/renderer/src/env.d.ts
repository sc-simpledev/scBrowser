import type { ChromeBridge, InternalBridge, OverlayBridge } from '@scbrowser/shared'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'browser-action-list': { class?: string; partition?: string; alignment?: string }
    }
  }
}

declare global {
  interface Window {
    scb: ChromeBridge
    scbOverlay: OverlayBridge
    scbInternal: InternalBridge
  }
}
