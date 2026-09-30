import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/roboto-condensed/latin-400.css'
import '@fontsource/roboto-condensed/latin-700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
