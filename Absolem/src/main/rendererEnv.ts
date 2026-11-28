import { app } from 'electron'

/**
 * Fronteira entre o ambiente do processo e as URLs do renderer.
 *
 * O Hub (ou qualquer launcher) pode nos passar `ELECTRON_RENDERER_URL` herdada
 * do PRÓPRIO Hub em dev. No Absolem empacotado essa variável não tem sentido:
 * as janelas devem carregar sempre o `renderer/index.html` de dentro do asar.
 * Se ela vazar, o overlay e as Configurações abrem a página do Hub (overlay
 * preto/quadrado, Configurações em branco com título "Kolnd Hub").
 *
 * A sanitização apaga a variável do processo empacotado; todo o código
 * existente (`overlayWindow`, `lifecycle`, `capture/instance`, `ipcGuard`)
 * continua lendo `process.env['ELECTRON_RENDERER_URL']` do mesmo jeito e passa
 * a ver `undefined`. Em dev nada muda: o servidor do electron-vite continua
 * valendo.
 */
export function sanitizeRendererUrlEnv(env: NodeJS.ProcessEnv, isPackaged: boolean): void {
  if (!isPackaged) return
  delete env['ELECTRON_RENDERER_URL']
}

// Efeito colateral único no import: `index.ts` importa este módulo ANTES de
// qualquer janela (e antes de `testUserData`) para que a variável já esteja
// limpa quando o primeiro BrowserWindow for criado.
sanitizeRendererUrlEnv(process.env, app.isPackaged)
