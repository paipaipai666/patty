import './api'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import './styles/global.css'

// Apply cached theme synchronously before React renders to prevent dark flash.
// localStorage is written by settingsStore (init + theme changes) and survives
// app restarts in the WebView2 user data folder.
try {
  const cachedTheme = localStorage.getItem('patty-theme')
  if (cachedTheme) {
    document.documentElement.dataset.theme = cachedTheme
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
