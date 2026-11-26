import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { OverlayApp } from './overlay/OverlayApp'
import { isOverlayHash } from './overlay/overlayFlags'
import { SettingsApp } from './settings/SettingsApp'
import { isSettingsHash } from './settings/settingsFlags'
import './index.css'

// Um único entry do electron-vite: a janela do overlay carrega a origem com
// `#overlay`, a janela principal (Configurações) com `#settings`, e a rota sem
// hash mantém a tela de fundação da task 00. A classe no <html> permite deixar o
// body transparente SOMENTE na rota do overlay. Flags de desenvolvimento viajam
// no próprio hash (`#overlay?debug=1`), nunca na URL.
const isOverlayRoute = isOverlayHash(window.location.hash)
const isSettingsRoute = isSettingsHash(window.location.hash)
if (isOverlayRoute) document.documentElement.classList.add('overlay-route')

let route = <App />
if (isOverlayRoute) route = <OverlayApp />
else if (isSettingsRoute) route = <SettingsApp />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{route}</React.StrictMode>
)
