import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { HudOverlay } from './components/HudOverlay'
// Inter empacotada offline (13.5): só latin + latin-ext para pt-BR.
// O css default do pacote (`@fontsource/inter/400.css`) embute todos os subconjuntos
// (cyrillic/greek/vietnamese) e fallback .woff — os imports `latin-*`/`latin-ext-*`
// mantêm o bundle dentro do orçamento (~240 KB woff2).
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-ext-700.css'
import './index.css'

// A MESMA origem serve o shell e a sobreposição: a janela do HUD carrega a URL
// com `#hud` e aqui decidimos qual árvore montar (sem segundo entry no
// electron-vite). O HUD usa o mesmo preload, só lê dados por IPC push.
const isHudOverlay = window.location.hash === '#hud'
if (isHudOverlay) {
  // A janela do HUD é transparente: o fundo do body (gradiente do app) cobriria
  // os 320×240 inteiros. A classe só existe nesta rota.
  document.body.classList.add('hud-body')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isHudOverlay ? <HudOverlay /> : <App />}</React.StrictMode>
)
