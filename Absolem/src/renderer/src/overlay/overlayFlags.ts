import type { AvatarState } from '../../../shared/avatar'
import { isAvatarState } from '../../../shared/avatar'
import type { AvatarLook } from './avatar/looks'
import { AVATAR_LOOKS } from './avatar/looks'

/**
 * Flags de desenvolvimento do overlay, lidas do hash (sem query string na URL).
 *
 * Formatos aceitos: `#overlay`, `#overlay?debug=1`, `#overlay?slow=1&debug=1`.
 * Qualquer valor diferente de `1`/`true` desliga a flag booleana; sem flags,
 * nenhum gerador fake, degradação forçada ou HUD aparece. `look` aceita apenas
 * `holo` ou `storybook` e `state` aceita os cinco estados do avatar; qualquer
 * outro valor é ignorado. As flags só valem em desenvolvimento: o OverlayApp
 * passa `enabled: import.meta.env.DEV`, então o build empacotado as ignora.
 */
export interface OverlayFlags {
  fakeVoice: boolean
  slow: boolean
  debug: boolean
  /** Acabamento pedido pelo hash; `null` deixa a cena usar o default. */
  look: AvatarLook | null
  /** Estado visual de QA (`idle`..`error`); `null` deixa a voz real mandar. */
  state: AvatarState | null
}

export const NO_OVERLAY_FLAGS: OverlayFlags = {
  fakeVoice: false,
  slow: false,
  debug: false,
  look: null,
  state: null
}

export interface ParseOverlayFlagsOptions {
  /** `false` no build empacotado (`!app.isPackaged`). Default: true. */
  enabled?: boolean
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

function parseLook(value: string | null): AvatarLook | null {
  return value !== null && (AVATAR_LOOKS as readonly string[]).includes(value)
    ? (value as AvatarLook)
    : null
}

function parseState(value: string | null): AvatarState | null {
  return isAvatarState(value) ? value : null
}

/** Estado inicial aplicado por QA; nunca toca em voz, áudio ou sessão. */
export function qaInitialState(flags: OverlayFlags): AvatarState | null {
  return flags.state
}

export function parseOverlayFlags(
  hash: string,
  options: ParseOverlayFlagsOptions = {}
): OverlayFlags {
  if (options.enabled === false) return { ...NO_OVERLAY_FLAGS }

  const body = hashBody(hash)
  const queryIndex = body.indexOf('?')
  if (queryIndex < 0) return { ...NO_OVERLAY_FLAGS }

  const params = new URLSearchParams(body.slice(queryIndex + 1))
  return {
    fakeVoice: isTruthy(params.get('fakeVoice')),
    slow: isTruthy(params.get('slow')),
    debug: isTruthy(params.get('debug')),
    look: parseLook(params.get('look')),
    state: parseState(params.get('state'))
  }
}
