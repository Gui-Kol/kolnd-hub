import { win32 } from 'path'

/**
 * Guardas de caminho das ações (task 08).
 *
 * Toda entrada vinda do modelo é hostil: UNC, `..` residual, caminho relativo
 * e reparse point/junction precisam ser recusados ANTES de qualquer acesso.
 * A comparação é case-insensitive e usa o separador do Windows, porque o app é
 * exclusivo de Windows.
 */

const SEP = '\\'

/** `\\servidor\share`, `//servidor/share` e `\\?\C:\...` são UNC/device. */
export function isUncPath(input: string): boolean {
  return /^[\\/]{2}/.test(input.trim())
}

/** Caminho absoluto de drive (`C:\...` ou `C:/...`). */
export function isAbsoluteWindowsPath(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input.trim())
}

/** Segmento `..` em qualquer posição (antes do realpath). */
export function hasTraversal(input: string): boolean {
  return input
    .trim()
    .split(/[\\/]+/)
    .some((segment) => segment === '..')
}

export function normalizeForCompare(input: string): string {
  const trimmed = input.trim().replace(/\//g, SEP)
  const withoutTrailing = trimmed.replace(/\\+$/, '')
  return withoutTrailing.toLowerCase()
}

/** `true` quando `target` é `root` ou está abaixo dele. */
export function isPathInsideOrEqual(root: string, target: string): boolean {
  const normalizedRoot = normalizeForCompare(root)
  const normalizedTarget = normalizeForCompare(target)
  if (!normalizedRoot || !normalizedTarget) return false
  if (normalizedTarget === normalizedRoot) return true
  return normalizedTarget.startsWith(`${normalizedRoot}${SEP}`)
}

/** `true` somente para descendente estrito (arquivo não é a própria raiz). */
export function isPathInside(root: string, target: string): boolean {
  const normalizedRoot = normalizeForCompare(root)
  const normalizedTarget = normalizeForCompare(target)
  if (!normalizedRoot || !normalizedTarget) return false
  return (
    normalizedTarget.length > normalizedRoot.length &&
    normalizedTarget.startsWith(`${normalizedRoot}${SEP}`)
  )
}

/** Raiz Windows válida para as allowlists (drive absoluto, sem UNC/`..`). */
export function isAllowedRootInput(root: unknown): root is string {
  return (
    typeof root === 'string' &&
    root.trim().length > 0 &&
    !isUncPath(root) &&
    !hasTraversal(root) &&
    (isAbsoluteWindowsPath(root) || win32.isAbsolute(root.trim()))
  )
}

/** Caminho de entrada aceitável antes do realpath (absoluto, sem UNC/`..`). */
export function isSafeInputPath(input: unknown): input is string {
  return (
    typeof input === 'string' &&
    input.trim().length > 0 &&
    input.length <= 1024 &&
    !isUncPath(input) &&
    !hasTraversal(input) &&
    (isAbsoluteWindowsPath(input) || win32.isAbsolute(input.trim()))
  )
}
