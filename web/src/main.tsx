import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@shared/ui/theme.css'
import '@shared/ui/main.css'
import './index.css'

// Apply default theme before first paint (persisted theme wiring lands in SET-02).
document.documentElement.dataset.theme = 'paper'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
