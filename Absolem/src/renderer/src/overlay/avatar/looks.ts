/**
 * Acabamentos do avatar.
 *
 * `holo` mantém o visual holográfico herdado da task 03; `storybook` usa cor
 * plana por papel para provar o encanamento da recriação ilustrada. A
 * iluminação real do acabamento ilustrado é a task 19. O default é `storybook`
 * por decisão de produto da task 14; trocar aqui não exige mudar a geometria.
 */
export const AVATAR_LOOKS = ['holo', 'storybook'] as const

export type AvatarLook = (typeof AVATAR_LOOKS)[number]

export const DEFAULT_AVATAR_LOOK: AvatarLook = 'storybook'

/** Valor desconhecido ou ausente cai no default, sem lançar. */
export function resolveAvatarLook(value: unknown): AvatarLook {
  return typeof value === 'string' && (AVATAR_LOOKS as readonly string[]).includes(value)
    ? (value as AvatarLook)
    : DEFAULT_AVATAR_LOOK
}
