import React from 'react'
import ReactDOM from 'react-dom/client'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import App from './App'
import './styles/global.css'

gsap.registerPlugin(useGSAP)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
