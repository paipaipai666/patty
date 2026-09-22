import './api'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './styles/global.css'


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

}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
