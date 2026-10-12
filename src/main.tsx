import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/* After a new version goes live, a page that was already open still asks for
   the old version's code files (Word report, PDF, Excel, other pages…), which
   no longer exist — so the button fails. Reload once to pick up the new
   version, then say so. At most one reload a minute, so a real outage can't
   loop. */
const RELOAD_KEY = 'alaya-reloaded-for-update'
window.addEventListener('vite:preloadError', e => {
  let last = 0
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return
  e.preventDefault()
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())) } catch { /* storage blocked */ }
  window.location.reload()
})
try {
  const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0
  if (Date.now() - last < 15_000) {
    const note = document.createElement('div')
    note.textContent = 'Alaya Pulse was just updated — please try that again.'
    note.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;background:#000079;color:#fff;'
      + 'font:500 14px Poppins,Arial,sans-serif;padding:10px 18px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,121,.25);transition:opacity .4s'
    document.body.appendChild(note)
    window.setTimeout(() => { note.style.opacity = '0'; window.setTimeout(() => note.remove(), 500) }, 6000)
  }
} catch { /* storage blocked */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
