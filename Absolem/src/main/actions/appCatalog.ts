/**
 * Catálogo de programas instalados e abertura (task 08, T2).
 *
 * - varre os dois menus Iniciar por `.lnk`, resolve os destinos em LOTE via
 *   PowerShell (`WScript.Shell.CreateShortcut`) e cacheia o resultado em
 *   `userData/app-catalog.json` com a assinatura de `mtime` dos diretórios;
 * - aceita AUMID de app UWP, aberto por `explorer.exe shell:AppsFolder\<AUMID>`;
 * - abre com `spawn(exe, [], { detached, stdio:'ignore', shell:false })` e
 *   confirma em até 3 s que o PID existe antes de reportar sucesso;
 * - nome fora do catálogo nunca abre.
 *
 * Nada aqui interpola texto do modelo em comando: o PowerShell recebe a lista
 * de caminhos como ARGUMENTOS (`$args`) e o destino do `.lnk` é apenas `file`
 * do `spawn`.
 */

export interface CatalogApp {
  name: string
  kind: 'shortcut' | 'aumid'
  /** Executável resolvido do `.lnk` (kind `shortcut`). */
  target?: string
  /** AUMID do app UWP (kind `aumid`). */
  aumid?: string
}

export interface DirentLike {
  name: string
  isDirectory: () => boolean
  isFile: () => boolean
  isSymbolicLink: () => boolean
}

export interface CatalogFs {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<DirentLike[]>
  stat: (path: string) => Promise<{ mtimeMs: number }>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>
  mkdir: (path: string, options: { recursive: true }) => Promise<unknown>
}

export interface ShortcutResolution {
  path: string
  target: string
}

export interface SpawnedProcessLike {
  pid?: number
  unref: () => void
}

export interface AppCatalogOptions {
  cachePath: string
  startMenuDirs: string[]
  fs: CatalogFs
  /** Resolve vários `.lnk` numa única chamada de PowerShell. */
  resolveShortcuts: (paths: string[]) => Promise<ShortcutResolution[]>
  spawn: (
    file: string,
    args: string[],
    options: { detached: true; stdio: 'ignore'; shell: false }
  ) => SpawnedProcessLike
  /** `tasklist /FI "PID eq <pid>"`; nunca lança. */
  isProcessAlive: (pid: number) => Promise<boolean>
  wait?: (ms: number) => Promise<void>
  verifyTimeoutMs?: number
  now?: () => number
}

export type OpenAppFailure = 'unknown' | 'spawn' | 'verify' | 'blocked'

export type OpenAppResult =
  | { ok: true; app: CatalogApp; pid: number; verified: boolean }
  | { ok: false; reason: OpenAppFailure; error: string }

export interface AppCatalog {
  load: () => Promise<{ apps: CatalogApp[]; cached: boolean }>
  listNames: () => Promise<string[]>
  open: (name: string) => Promise<OpenAppResult>
  registerAumid: (name: string, aumid: string) => Promise<{ ok: boolean; error?: string }>
}

const CACHE_VERSION = 1
const MAX_SCAN_DEPTH = 6
const MAX_NAME_LENGTH = 100
const MAX_AUMID_LENGTH = 200
const DEFAULT_VERIFY_TIMEOUT_MS = 3_000
const VERIFY_INTERVAL_MS = 250
const MAX_LISTED_NAMES = 20

interface CacheFile {
  version: number
  signature: string
  apps: CatalogApp[]
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeLookupName(input: string): string {
  return input
    .trim()
    .replace(/\.lnk$/i, '')
    .slice(0, MAX_NAME_LENGTH)
    .toLowerCase()
}

function isSafeAumid(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_AUMID_LENGTH &&
    /^[A-Za-z0-9._!-]+$/.test(value) &&
    !value.includes('..')
  )
}

function isCatalogApp(value: unknown): value is CatalogApp {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  if (typeof raw.name !== 'string' || !raw.name.trim()) return false
  if (raw.kind === 'shortcut') return typeof raw.target === 'string' && raw.target.length > 0
  if (raw.kind === 'aumid') return typeof raw.aumid === 'string' && isSafeAumid(raw.aumid)
  return false
}

export function createAppCatalog(options: AppCatalogOptions): AppCatalog {
  const wait = options.wait ?? defaultWait
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS
  let memory: { signature: string; apps: CatalogApp[] } | null = null

  async function dirSignature(): Promise<string> {
    const parts: string[] = []
    for (const dir of options.startMenuDirs) {
      try {
        const stat = await options.fs.stat(dir)
        parts.push(`${dir}:${Math.floor(stat.mtimeMs)}`)
      } catch {
        parts.push(`${dir}:0`)
      }
    }
    return parts.join('|')
  }

  async function readCache(signature: string): Promise<{ apps: CatalogApp[]; cached: boolean }> {
    try {
      const text = await options.fs.readFile(options.cachePath, 'utf8')
      const parsed = JSON.parse(text) as CacheFile
      if (
        parsed &&
        parsed.version === CACHE_VERSION &&
        parsed.signature === signature &&
        Array.isArray(parsed.apps)
      ) {
        const apps = parsed.apps.filter(isCatalogApp)
        if (apps.length > 0) return { apps, cached: true }
      }
    } catch {
      // Cache ausente/corrompido: varre de novo.
    }
    return { apps: [], cached: false }
  }

  async function writeCache(signature: string, apps: CatalogApp[]): Promise<void> {
    const cache: CacheFile = { version: CACHE_VERSION, signature, apps }
    try {
      await options.fs.mkdir(options.cachePath.replace(/[\\/][^\\/]+$/, ''), { recursive: true })
      await options.fs.writeFile(options.cachePath, JSON.stringify(cache), 'utf8')
    } catch {
      // Cache é otimização: falha de disco não impede abrir o app.
    }
  }

  async function scanShortcuts(dir: string, depth: number, found: string[]): Promise<void> {
    if (depth > MAX_SCAN_DEPTH || found.length >= 5_000) return
    let entries: DirentLike[]
    try {
      entries = await options.fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = `${dir.replace(/[\\/]+$/, '')}\\${entry.name}`
      if (entry.isDirectory()) {
        await scanShortcuts(full, depth + 1, found)
      } else if (entry.isFile() && /\.lnk$/i.test(entry.name)) {
        found.push(full)
      }
    }
  }

  async function scan(): Promise<CatalogApp[]> {
    const lnkPaths: string[] = []
    for (const dir of options.startMenuDirs) {
      await scanShortcuts(dir, 0, lnkPaths)
    }
    if (lnkPaths.length === 0) return []
    let resolved: ShortcutResolution[]
    try {
      resolved = await options.resolveShortcuts(lnkPaths)
    } catch {
      return []
    }
    const byName = new Map<string, CatalogApp>()
    for (const item of resolved) {
      if (typeof item?.path !== 'string' || typeof item?.target !== 'string') continue
      const target = item.target.trim()
      if (!target || !/^[A-Za-z]:[\\/]/.test(target)) continue
      const base = item.path.replace(/\\/g, '/').split('/').pop() ?? ''
      const name = base.replace(/\.lnk$/i, '').trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!byName.has(key)) {
        byName.set(key, { name: name.slice(0, MAX_NAME_LENGTH), kind: 'shortcut', target })
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  async function load(): Promise<{ apps: CatalogApp[]; cached: boolean }> {
    const signature = await dirSignature()
    if (memory && memory.signature === signature) {
      return { apps: [...memory.apps], cached: true }
    }
    const cached = await readCache(signature)
    if (cached.cached) {
      memory = { signature, apps: cached.apps }
      return cached
    }
    const apps = await scan()
    memory = { signature, apps }
    await writeCache(signature, apps)
    return { apps: [...apps], cached: false }
  }

  async function listNames(): Promise<string[]> {
    const { apps } = await load()
    return apps.map((app) => app.name)
  }

  async function findByName(name: string): Promise<CatalogApp | null> {
    const lookup = normalizeLookupName(name)
    if (!lookup) return null
    const { apps } = await load()
    return apps.find((app) => normalizeLookupName(app.name) === lookup) ?? null
  }

  async function verifyPid(pid: number): Promise<boolean> {
    const startedAt = options.now?.() ?? Date.now()
    const maxAttempts = Math.ceil(verifyTimeoutMs / VERIFY_INTERVAL_MS) + 1
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (await options.isProcessAlive(pid)) return true
      const elapsed = (options.now?.() ?? Date.now()) - startedAt
      if (elapsed >= verifyTimeoutMs) return false
      await wait(VERIFY_INTERVAL_MS)
    }
    return false
  }

  async function open(name: string): Promise<OpenAppResult> {
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH) {
      return { ok: false, reason: 'unknown', error: 'Nome de aplicativo inválido.' }
    }
    const app = await findByName(name)
    if (!app) {
      const names = (await listNames()).slice(0, MAX_LISTED_NAMES).join(', ')
      return {
        ok: false,
        reason: 'unknown',
        error: names
          ? `Aplicativo fora do catálogo. Disponíveis: ${names}.`
          : 'Aplicativo fora do catálogo.'
      }
    }

    const file = app.kind === 'aumid' ? 'explorer.exe' : (app.target ?? '')
    const args = app.kind === 'aumid' ? [`shell:AppsFolder\\${app.aumid ?? ''}`] : []
    let child: SpawnedProcessLike
    try {
      child = options.spawn(file, args, { detached: true, stdio: 'ignore', shell: false })
      child.unref()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: 'spawn', error: `Falha ao abrir ${app.name}: ${message}` }
    }
    const pid = typeof child.pid === 'number' && child.pid > 0 ? child.pid : 0
    if (pid === 0) {
      return { ok: false, reason: 'spawn', error: `Falha ao abrir ${app.name}: sem PID.` }
    }
    if (app.kind === 'aumid') {
      // O explorer.exe sai logo após encaminhar o AUMID; não há PID do app
      // para verificar. O spawn sem erro é o melhor sinal disponível.
      return { ok: true, app, pid, verified: false }
    }
    if (!(await verifyPid(pid))) {
      return {
        ok: false,
        reason: 'verify',
        error: `O processo de ${app.name} não apareceu em ${verifyTimeoutMs} ms.`
      }
    }
    return { ok: true, app, pid, verified: true }
  }

  async function registerAumid(
    name: string,
    aumid: string
  ): Promise<{ ok: boolean; error?: string }> {
    const trimmedName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : ''
    if (!trimmedName) return { ok: false, error: 'Nome do aplicativo inválido.' }
    if (typeof aumid !== 'string' || !isSafeAumid(aumid.trim())) {
      return { ok: false, error: 'AUMID inválido.' }
    }
    const signature = await dirSignature()
    const current = await load()
    const apps = current.apps.filter(
      (app) => normalizeLookupName(app.name) !== normalizeLookupName(trimmedName)
    )
    apps.push({ name: trimmedName, kind: 'aumid', aumid: aumid.trim() })
    memory = { signature, apps }
    await writeCache(signature, apps)
    return { ok: true }
  }

  return { load, listNames, open, registerAumid }
}
