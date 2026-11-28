/**
 * Preferências e travas de segurança do Electron (task 13/T5).
 *
 * As três janelas do app (Configurações, overlay e seleção de região) usam
 * exatamente o mesmo bloco. Nenhuma delas precisa de Node no renderer, de
 * webview ou de recursos experimentais. Manter os valores aqui evita que uma
 * janela nova nasça com uma combinação diferente.
 */

export const SECURE_WEB_PREFERENCES = Object.freeze({
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webviewTag: false,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  safeDialogs: true
})

export interface WebContentsLike {
  on: (
    event: 'will-attach-webview',
    listener: (event: { preventDefault: () => void }) => void
  ) => void
}

/**
 * Nega qualquer tentativa de anexar um `<webview>`. A regra é global: o app
 * não usa webview em nenhuma janela, então não existe exceção.
 */
export function blockWebviewAttach(contents: WebContentsLike): void {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

/**
 * Predicado puro para reuso em teste/diagnóstico: a combinação é segura quando
 * todo flag perigoso está desligado e o isolamento está ligado.
 */
export function isSecureWebPreferences(preferences: Record<string, unknown>): boolean {
  return (
    preferences.sandbox === true &&
    preferences.contextIsolation === true &&
    preferences.nodeIntegration === false &&
    preferences.nodeIntegrationInWorker === false &&
    preferences.nodeIntegrationInSubFrames === false &&
    preferences.webviewTag === false &&
    preferences.allowRunningInsecureContent === false &&
    preferences.experimentalFeatures === false
  )
}
