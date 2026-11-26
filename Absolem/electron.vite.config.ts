import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import pkg from './package.json'

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
    plugins: [externalizeDepsPlugin()]
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
    // Fonte única da versão: Absolem/package.json.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [react(), devCspPlugin()]
  }
})
