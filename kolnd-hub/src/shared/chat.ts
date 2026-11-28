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
 * Hosts do login (OAuth do Discord) por onde a página passa sozinha durante
 * "Continuar com Discord": a API própria inicia o fluxo e o Discord autoriza,
 * voltando para o callback da API e então para `golive.nemtudo.me`. Sem eles a
 * navegação é mandada para o navegador externo e o login nunca volta para o
 * webview (o cookie/sessão fica no outro navegador).
 */
export const CHAT_LOGIN_HOSTS = ['apigolive.nemtudo.me', 'discord.com'] as const

/** Hosts que podem navegar DENTRO do guest (site + login). */
export const CHAT_NAVIGATION_HOSTS: readonly string[] = [CHAT_HOST, ...CHAT_LOGIN_HOSTS]

function parseHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    // `port` vazio cobre a porta padrão (443); porta explícita diferente falha.
    return url.protocol === 'https:' && url.port === '' ? url : null
  } catch {
    return null
  }
}

/**
 * `true` só para https no host exato do Go Live (sem subdomínio nem porta
 * alternativa). Vale para o `src` do `<webview>` e para permissões de mídia —
 * é a origem do site, não a do login. `http:`, `javascript:`, `data:`, `file:`
 * e hosts parecidos (`golive.nemtudo.me.evil.com`) ficam de fora.
 */
export function isChatUrl(raw: string): boolean {
  return parseHttpsUrl(raw)?.hostname === CHAT_HOST
}

/** `true` para https nos hosts do site e do login (navegação interna do guest). */
export function isChatNavigationUrl(raw: string): boolean {
  const url = parseHttpsUrl(raw)
  return url !== null && CHAT_NAVIGATION_HOSTS.includes(url.hostname)
}

export type ChatNavigation = 'allow' | 'external' | 'block'

/**
 * Decide o destino de uma navegação disparada pelo site:
 * - `allow`: continua dentro do guest (https nos hosts do site/login);
 * - `external`: abre no navegador do sistema (http/https/mailto de outro host);
 * - `block`: esquema perigoso/desconhecido ou URL inválida.
 */
export function classifyChatNavigation(raw: string): ChatNavigation {
  if (isChatNavigationUrl(raw)) return 'allow'

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
