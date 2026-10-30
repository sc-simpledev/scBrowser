import { contextBridge } from 'electron'
import {
  OVERLAY_COMMAND_CHANNELS,
  OVERLAY_EVENT_CHANNELS,
  type OverlayCommands,
  type OverlayEvents
} from '@scbrowser/shared'
import { createBridge } from './bridge'

contextBridge.exposeInMainWorld(
  'scbOverlay',
  createBridge<OverlayCommands, OverlayEvents>(OVERLAY_COMMAND_CHANNELS, OVERLAY_EVENT_CHANNELS)
)
