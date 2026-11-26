/**
 * Rota `#region` da janela de seleção (task 07, T5).
 *
 * O hash carrega apenas o `displayId`; o retângulo é desenhado em DIPs locais
 * à janela, que cobre exatamente um display. Nenhum parâmetro sensível vai na
 * URL.
 */

function hashBody(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash
}

export function isRegionHash(hash: string): boolean {
  return hashBody(hash).split('?')[0] === 'region'
}

export function regionDisplayId(hash: string): string | null {
  const body = hashBody(hash)
  const queryIndex = body.indexOf('?')
  if (queryIndex < 0) return null
  const params = new URLSearchParams(body.slice(queryIndex + 1))
  const displayId = params.get('displayId')
  return displayId && displayId.trim() ? displayId.trim() : null
}
