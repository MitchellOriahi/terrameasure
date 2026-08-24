import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Must run before any map mounts: points MapLibre at its bundled Web
// Worker file (without this, vector maps and drawn shapes render nothing).
import './lib/maplibreWorker'
import './index.css'
// Keeps returning visitors from being served a stale cached app after a
// deploy (see lib/appUpdate.ts for the whole story).
import { initAppUpdate } from './lib/appUpdate'
import App from './App.tsx'

initAppUpdate()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
