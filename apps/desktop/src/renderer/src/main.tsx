import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyFunFlags } from './shared/funFlags'
import './index.css'

document.documentElement.dataset.platform = window.scb.platform
void window.scb.invoke('flags:get').then(applyFunFlags)
window.scb.on('ui:site-colour', (color) => document.documentElement.style.setProperty('--sc-site-colour', color ?? 'transparent'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
