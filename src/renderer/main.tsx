import React from 'react'
import ReactDOM from 'react-dom/client'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import App from './App'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import './styles/global.css'

gsap.registerPlugin(useGSAP)

// Apply cached theme synchronously before React renders to prevent dark flash.
// sessionStorage is set by settingsStore.init after the first successful load.
try {
  const cachedTheme = sessionStorage.getItem('patty-theme')
  if (cachedTheme) {
    document.documentElement.dataset.theme = cachedTheme
  }
} catch {
  // sessionStorage may be unavailable (privacy mode); ignore
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
