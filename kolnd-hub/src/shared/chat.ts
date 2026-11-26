// Fonte única da página Chat (Go Live embutido via <webview>).
//
// FRONTEIRA: este arquivo não importa `electron` — main e renderer usam estas
// constantes e a classificação pura é testável em vitest node. O site é de
// terceiros: a allowlist existe para o Hub carregar SÓ ele no guest e para
// nunca transformar a navegação do site em navegação do Hub.

export const CHAT_URL = 'https://golive.nemtudo.me/groups'
export const CHAT_HOST = 'golive.nemtudo.me'
export const CHAT_PARTITION = 'persist:golive'

/**
 * `true` só para https no host exato do Go Live (sem subdomínio nem porta
 * alternativa). `http:`, `javascript:`, `data:`, `file:` e hosts parecidos
 * (`golive.nemtudo.me.evil.com`) ficam de fora.
 */
export function isChatUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    // `port` vazio cobre a porta padrão (443); porta explícita diferente falha.
    return url.protocol === 'https:' && url.hostname === CHAT_HOST && url.port === ''
  } catch {
    return false
  }
}

export type ChatNavigation = 'allow' | 'external' | 'block'

/**
 * Decide o destino de uma navegação disparada pelo site:
 * - `allow`: continua dentro do guest (https no host do Go Live);
 * - `external`: abre no navegador do sistema (http/https/mailto de outro host);
 * - `block`: esquema perigoso/desconhecido ou URL inválida.
 */
export function classifyChatNavigation(raw: string): ChatNavigation {
  if (isChatUrl(raw)) return 'allow'

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'block'
  }

  const protocol = url.protocol.toLowerCase()
  if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') return 'external'
  return 'block'
}
