import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import pkg from './package.json'

export default defineConfig({
  main: {
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
    // Versao unica de verdade: kolnd-hub/package.json -> __APP_VERSION__ no renderer
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
      react(),
      // Relatório de bundle somente com BUNDLE_ANALYZE=1 — sem a flag o build é idêntico
      ...(process.env.BUNDLE_ANALYZE === '1'
        ? [
            visualizer({
              template: 'treemap',
              gzipSize: true,
              brotliSize: true,
              filename: 'dist/bundle-report.html'
            })
          ]
        : [])
    ]
  }
})
