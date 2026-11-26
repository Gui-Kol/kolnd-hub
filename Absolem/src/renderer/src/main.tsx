import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { OverlayApp } from './overlay/OverlayApp'
import './index.css'

// Um único entry do electron-vite: a janela principal carrega a origem sem
// hash e o overlay carrega a mesma origem com `#overlay` (task 02). A classe no
// <html> permite deixar o body transparente SOMENTE nessa rota.
const isOverlayRoute = window.location.hash === '#overlay'
if (isOverlayRoute) document.documentElement.classList.add('overlay-route')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isOverlayRoute ? <OverlayApp /> : <App />}</React.StrictMode>
)
