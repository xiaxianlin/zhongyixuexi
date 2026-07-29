import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import '@shared/ui/theme.css'
import '@shared/ui/main.css'

// Apply default theme before first paint (persisted theme wiring lands in SET-02).
document.documentElement.dataset.theme = 'paper'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
