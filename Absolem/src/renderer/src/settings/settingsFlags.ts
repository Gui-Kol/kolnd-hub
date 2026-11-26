/**
 * Rotas do renderer via hash (`#overlay`, `#settings`).
 *
 * A janela do overlay carrega `#overlay`; a janela principal (Configurações)
 * carrega `#settings`. Sem hash continua montando a tela de fundação.
 */
function hashBody(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash
}

export function isSettingsHash(hash: string): boolean {
  return hashBody(hash).split('?')[0] === 'settings'
}
