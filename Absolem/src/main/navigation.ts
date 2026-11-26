/**
 * Predicado puro de navegação permitida.
 *
 * Em produção (`loadFile`) nenhuma navegação in-window é permitida. Em dev, só
 * a origem do servidor do electron-vite (HMR) pode navegar. Fica separado do
 * `index.ts` para ser testável sem Electron.
 */
export function isAllowedNavigationUrl(url: string, devRendererUrl?: string | null): boolean {
  if (!devRendererUrl) return false
  try {
    return new URL(url).origin === new URL(devRendererUrl).origin
  } catch {
    return false
  }
}
