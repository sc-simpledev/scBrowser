import type { ChromeBridge } from '@scbrowser/shared'

declare global {
  interface Window {
    scb: ChromeBridge
  }
}
