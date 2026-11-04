import type { ChromeBridge, InternalBridge, OverlayBridge } from '@scbrowser/shared'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'browser-action-list': { class?: string; partition?: string; alignment?: string; ref?: React.Ref<HTMLElement> }
    }
  }
}

declare global {
  interface Window {
    scb: ChromeBridge
    scbOverlay: OverlayBridge
    scbInternal: InternalBridge
    /** From the extensions library. */
    browserAction: {
      activate: (partition: string, details: { eventType: 'click'; extensionId: string; tabId: number; alignment: string; anchorRect: { x: number; y: number; width: number; height: number } }) => Promise<void>
    }
  }
}
