import './api'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './styles/global.css'

// Apply the cached theme synchronously before React renders to prevent a dark
// flash for light/custom-theme users. patty-boot-ui holds the resolved CSS
// variable map (written by settingsStore on every load/change) — this replaces
// the hand-maintained per-theme blocks that used to live in variables.css
// (REVIEW.md P1-7). The boot splash (--patty-boot-bg in index.html) covers the
// pre-bundle window; first-ever run with no cache falls back to :root dark.
try {
  const cachedTheme = localStorage.getItem('patty-theme')
  if (cachedTheme) {
    document.documentElement.dataset.theme = cachedTheme
    const vars: unknown = JSON.parse(localStorage.getItem('patty-boot-ui') ?? 'null')
    if (vars && typeof vars === 'object') {
      for (const [key, value] of Object.entries(vars)) {
        if (key.startsWith('--') && typeof value === 'string') {
          document.documentElement.style.setProperty(key, value)
        }
      }
    }
  }
} catch {
  // localStorage may be unavailable (privacy mode); ignore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
