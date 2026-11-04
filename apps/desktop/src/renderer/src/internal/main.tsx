import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { InternalApp } from './InternalApp'
import { applyFunFlags } from '../shared/funFlags'
import './internal.css'

void window.scbInternal.invoke('flags:get').then(applyFunFlags)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InternalApp />
  </StrictMode>
)
