import { contextBridge } from 'electron'
import { COMMAND_CHANNELS, EVENT_CHANNELS, type ChromeCommands, type ChromeEvents } from '@scbrowser/shared'
import { createBridge } from './bridge'

contextBridge.exposeInMainWorld('scb', createBridge<ChromeCommands, ChromeEvents>(COMMAND_CHANNELS, EVENT_CHANNELS))
