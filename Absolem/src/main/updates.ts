import { shell } from 'electron'
import type { SimpleResult } from '../shared/ipc'
import packageJson from '../../package.json'

/**
 * Updater manual na v1 (task 12, T9).
 *
 * Sem auto-update silencioso, sem `electron-updater`, sem download. O botao
 * "Verificar atualizacoes" na aba Sobre abre a pagina de releases no navegador
 * padrao com `shell.openExternal`. SO abre `https`. A URL vem de
 * `package.json.repository`. Nada e baixado, executado ou instalado pelo app.
 */

/** Subconjunto de `shell` usado (injetavel em teste). */
export interface UpdatesShell {
  openExternal(url: string): Promise<void>
}

/** `package.json.repository` aceito como string ou `{ type, url }`. */
interface PackageJsonShape {
  repository?: string | { type?: string; url?: string }
}

/** Confirma que a URL e `https`. Qualquer outro esquema e recusado. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** URL de `repository` em package.json (string ou objeto), ja sem `git+`, `.git`, `/`. */
export function repositoryUrl(): string | null {
  const repo = (packageJson as PackageJsonShape).repository
  const raw = typeof repo === 'string' ? repo : (repo?.url ?? null)
  if (!raw) return null
  let url = raw.trim()
  if (url.startsWith('git+')) url = url.slice(4)
  // `git@github.com:org/repo` (scp-like) -> https.
  const scp = url.match(/^git@([^:]+):(.+)$/)
  if (scp) url = `https://${scp[1]}/${scp[2]}`
  url = url.replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!isHttpsUrl(url)) return null
  return url
}

/** Pagina de releases do repositorio, derivada de `package.json.repository`. */
export function releasesUrl(): string | null {
  const base = repositoryUrl()
  if (!base) return null
  return `${base}/releases`
}

/**
 * Abre a pagina de releases no navegador padrao. SO `https`. Nao baixa nada.
 * Nunca lanca; devolve `{ ok, error }`.
 */
export async function openReleasesPage(shellApi: UpdatesShell = shell): Promise<SimpleResult> {
  const url = releasesUrl()
  if (!url) {
    return {
      ok: false,
      error: 'URL de releases indisponivel (package.json.repository ausente ou nao-https).'
    }
  }
  if (!isHttpsUrl(url)) {
    return { ok: false, error: 'Pagina de atualizacoes nao-https recusada.' }
  }
  try {
    await shellApi.openExternal(url)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Nao foi possivel abrir a pagina de atualizacoes: ${message}` }
  }
}
