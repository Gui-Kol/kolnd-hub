import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * CSP de desenvolvimento: libera o websocket do HMR apenas em `serve`.
 * Em `build` o plugin não é aplicado, então o index.html mantém a CSP de
 * produção (`connect-src 'self'`).
 */
function devCspPlugin(): Plugin {
  return {
    name: 'absolem-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        "connect-src 'self'",
        "connect-src 'self' ws://localhost:* http://localhost:*"
      )
    }
  }
}

export default defineConfig({
  main: {
    // electron-store v8 é CJS: precisa ficar externo ao bundle do main.
    // `linkedom` NÃO fica externo: o entry CJS dele exige `css-select` (ESM),
    // que o Node 18 do Electron 28 não consegue carregar com require. O Vite
    // resolve o entry ESM e empacota o parser no main.
    plugins: [externalizeDepsPlugin({ exclude: ['linkedom'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      // O worklet precisa sair como arquivo real em `assets/`: o
      // `addModule` do AudioWorklet não aceita o conteúdo inline como data URL
      // em todos os casos. Não há outros assets pequenos no renderer.
      assetsInlineLimit: 0
    },
    plugins: [react(), devCspPlugin()]
  }
})
