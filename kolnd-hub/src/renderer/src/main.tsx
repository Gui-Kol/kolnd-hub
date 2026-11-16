import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
