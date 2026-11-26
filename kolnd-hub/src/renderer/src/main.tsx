import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { HudOverlay } from './components/HudOverlay'
// Inter empacotada offline: só os `.woff2` do subconjunto `latin` (cobre pt-BR)
// vivem em `assets/fonts`; o `fonts.css` mantém os mesmos pesos da @fontsource
// sem os `.woff` duplicados. Ver `styles/fonts.css` e a licença em `OFL.txt`.
import './styles/fonts.css'
import './index.css'

// A MESMA origem serve o shell e a sobreposição: a janela do HUD carrega a URL
// com `#hud` e aqui decidimos qual árvore montar (sem segundo entry no
// electron-vite). O HUD usa o mesmo preload, só lê dados por IPC push.
//
// `App` é lazy de propósito: a rota `#hud` monta só o `HudOverlay` e nunca deve
// baixar/parsear o app inteiro (Dashboard, modais, framer-motion). O fallback é
// nulo porque a janela já nasce com fundo escuro — sem spinner/tela branca.
const App = React.lazy(() => import('./App'))
const isHudOverlay = window.location.hash === '#hud'
if (isHudOverlay) {
  // A janela do HUD é transparente: o fundo do body (gradiente do app) cobriria
  // os 320×240 inteiros. A classe só existe nesta rota.
  document.body.classList.add('hud-body')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isHudOverlay ? (
      <HudOverlay />
    ) : (
      <Suspense fallback={null}>
        <App />
      </Suspense>
    )}
  </React.StrictMode>
)
