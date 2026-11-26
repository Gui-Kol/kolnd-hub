/**
 * Flags de desenvolvimento do overlay, lidas do hash (sem query string na URL).
 *
 * Formatos aceitos: `#overlay`, `#overlay?debug=1`, `#overlay?slow=1&debug=1`.
 * Qualquer valor diferente de `1`/`true` desliga a flag; sem flags, nenhum
 * gerador fake, degradação forçada ou HUD aparece.
 */
export interface OverlayFlags {
  fakeVoice: boolean
  slow: boolean
  debug: boolean
}

export const NO_OVERLAY_FLAGS: OverlayFlags = {
  fakeVoice: false,
  slow: false,
  debug: false
}

function hashBody(hash: string): string {
  return hash.startsWith('#') ? hash.slice(1) : hash
}

/** `true` para `#overlay` e `#overlay?...`; a rota principal não tem hash. */
export function isOverlayHash(hash: string): boolean {
  const route = hashBody(hash).split('?')[0]
  return route === 'overlay'
}

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true'
}

export function parseOverlayFlags(hash: string): OverlayFlags {
  const body = hashBody(hash)
  const queryIndex = body.indexOf('?')
  if (queryIndex < 0) return { ...NO_OVERLAY_FLAGS }

  const params = new URLSearchParams(body.slice(queryIndex + 1))
  return {
    fakeVoice: isTruthy(params.get('fakeVoice')),
    slow: isTruthy(params.get('slow')),
    debug: isTruthy(params.get('debug'))
  }
}
