import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { InternalApp } from './InternalApp'
import './internal.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InternalApp />
  </StrictMode>
)
