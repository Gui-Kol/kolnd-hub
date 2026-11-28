/**
 * Versão do produto (task 32).
 *
 * O Absolem não tem versão/release próprios: ele é distribuído e atualizado
 * junto com o Kolnd Hub. A Hub injeta a própria versão em `ABSOLEM_HUB_VERSION`
 * no launch do processo; o Absolem só lê e valida aqui, sem inventar versão.
 */

/** Variável que o Kolnd Hub define no env ao lançar o Absolem. */
export const HUB_VERSION_ENV = 'ABSOLEM_HUB_VERSION'

/** Semver simples (`X.Y.Z`, com pre-release/build opcionais). */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/**
 * Versão da Hub vinda do ambiente, ou `fallback` quando ausente/inválida.
 * Espaços são removidos; qualquer coisa fora de semver é descartada — nunca
 * exibimos um valor arbitrário vindo do ambiente.
 */
export function resolveHubVersion(
  env: { readonly [key: string]: string | undefined } | undefined,
  fallback: string
): string {
  const raw = env?.[HUB_VERSION_ENV]
  if (typeof raw !== 'string') return fallback
  const version = raw.trim()
  return SEMVER.test(version) ? version : fallback
}
