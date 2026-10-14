import './ui/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './ui/App'
import { createUpdatePort, NO_UPDATES } from './ui/pwa'

// #dev 是音色调试页，不注册 Service Worker，避免调试时被旧缓存困住
const updates = location.hash === '#dev' ? NO_UPDATES : createUpdatePort(registerSW)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App updates={updates} />
  </StrictMode>,
)
