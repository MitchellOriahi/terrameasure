import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Must run before any map mounts: points MapLibre at its bundled Web
// Worker file (without this, vector maps and drawn shapes render nothing).
import './lib/maplibreWorker'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
