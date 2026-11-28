/**
 * Catálogo de programas instalados e abertura (task 08, T2).
 *
 * - varre os dois menus Iniciar por `.lnk`, resolve os destinos em LOTE via
 *   PowerShell (`WScript.Shell.CreateShortcut`) e cacheia o resultado em
 *   `userData/app-catalog.json` com a assinatura de `mtime` dos diretórios;
 * - aceita AUMID de app UWP, aberto por `explorer.exe shell:AppsFolder\<AUMID>`;
 * - abre com `spawn(exe, [], { detached, stdio:'ignore', shell:false })` e
 *   confirma em até 10 s que o processo com o nome da imagem do alvo existe
 *   antes de reportar sucesso; se a imagem já estava rodando, não abre de novo;
 * - nome fora do catálogo nunca abre.
 *
 * Nada aqui interpola texto do modelo em comando: o PowerShell recebe a lista
 * de caminhos embutida no script (`-EncodedCommand`), o `tasklist` recebe apenas
 * o basename `.exe` do alvo e o destino do `.lnk` é apenas `file` do `spawn`.
 */

export interface CatalogApp {
  name: string
  kind: 'shortcut' | 'aumid' | 'known'
  /** Executável resolvido do `.lnk` (kind `shortcut`) ou fixo (kind `known`). */
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
  /**
   * Apps conhecidos (task 29): entram no catálogo mesmo sem atalho no Menu
   * Iniciar (ex.: Bloco de Notas) e abrem por `spawn` sem verificação de PID.
   */
  knownApps?: CatalogApp[]
  spawn: (
    file: string,
    args: string[],
    options: { detached: true; stdio: 'ignore'; shell: false }
  ) => SpawnedProcessLike
  /** `tasklist /FI "PID eq <pid>"`; nunca lança. */
  isProcessAlive: (pid: number) => Promise<boolean>
  /**
   * `tasklist /FI "IMAGENAME eq <exe>"`: existe processo com essa imagem?
   * Recebe só o basename `.exe` do alvo; nunca lança.
   */
  findRunning?: (imageName: string) => Promise<boolean>
  wait?: (ms: number) => Promise<void>
  verifyTimeoutMs?: number
  now?: () => number
}

export type OpenAppFailure = 'unknown' | 'spawn' | 'verify' | 'blocked'

export type OpenAppResult =
  | {
      ok: true
      app: CatalogApp
      pid: number
      verified: boolean
      /** Frase pronta em pt-BR para o modelo confirmar ao usuário. */
      message: string
      /** O app já estava aberto antes do pedido: nenhum spawn aconteceu. */
      alreadyRunning?: true
    }
  | { ok: false; reason: OpenAppFailure; error: string }

export interface AppCatalog {
  load: () => Promise<{ apps: CatalogApp[]; cached: boolean }>
  listNames: () => Promise<string[]>
  open: (name: string) => Promise<OpenAppResult>
  registerAumid: (name: string, aumid: string) => Promise<{ ok: boolean; error?: string }>
}

const CACHE_VERSION = 2
const MAX_SCAN_DEPTH = 6
const MAX_NAME_LENGTH = 100
const MAX_AUMID_LENGTH = 200
const MAX_IMAGE_NAME_LENGTH = 120
/** Espera máxima do `open_app` pelo processo do app aberto. */
export const OPEN_APP_VERIFY_TIMEOUT_MS = 10_000
const DEFAULT_VERIFY_TIMEOUT_MS = OPEN_APP_VERIFY_TIMEOUT_MS
const VERIFY_INTERVAL_MS = 250
const MAX_LISTED_NAMES = 20
/** Só o basename `.exe` do alvo vai para o `tasklist`; nada de texto livre. */
const SAFE_IMAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/i

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

/**
 * Nome da imagem (basename `.exe`) usado no filtro do `tasklist`. Alvos que
 * delegam a outro processo (`.cmd`, `.bat`, sem `.exe`) devolvem `null` e caem
 * na verificação por PID.
 */
export function imageNameFromTarget(target: string): string | null {
  if (typeof target !== 'string') return null
  const base = target.replace(/\\/g, '/').split('/').pop() ?? ''
  const trimmed = base.trim()
  if (!trimmed || trimmed.length > MAX_IMAGE_NAME_LENGTH) return null
  if (!SAFE_IMAGE_NAME.test(trimmed)) return null
  return trimmed
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
  if (raw.kind === 'shortcut' || raw.kind === 'known') {
    return typeof raw.target === 'string' && raw.target.length > 0
  }
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

  /** Apps conhecidos válidos, sem duplicatas de nome (a ordem do primeiro vale). */
  function knownCatalogApps(): CatalogApp[] {
    const seen = new Set<string>()
    const apps: CatalogApp[] = []
    for (const candidate of options.knownApps ?? []) {
      if (!isCatalogApp(candidate) || candidate.kind !== 'known') continue
      const key = normalizeLookupName(candidate.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      apps.push({
        name: candidate.name.trim().slice(0, MAX_NAME_LENGTH),
        kind: 'known',
        target: candidate.target
      })
    }
    return apps
  }

  /**
   * Mescla os apps conhecidos com os varridos. O conhecido tem precedência no
   * nome normalizado: garante "Bloco de Notas"/"Notepad" mesmo sem `.lnk`.
   */
  function mergeApps(scanned: CatalogApp[]): CatalogApp[] {
    const merged = knownCatalogApps()
    const seen = new Set(merged.map((app) => normalizeLookupName(app.name)))
    for (const app of scanned) {
      const key = normalizeLookupName(app.name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      merged.push(app)
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  async function load(): Promise<{ apps: CatalogApp[]; cached: boolean }> {
    const signature = await dirSignature()
    if (memory && memory.signature === signature) {
      return { apps: [...memory.apps], cached: true }
    }
    const cached = await readCache(signature)
    if (cached.cached) {
      const apps = mergeApps(cached.apps)
      memory = { signature, apps }
      return { apps: [...apps], cached: true }
    }
    const scanned = await scan()
    const apps = mergeApps(scanned)
    memory = { signature, apps }
    // O cache guarda só o que veio do disco; conhecidos são mesclados na leitura.
    await writeCache(signature, scanned)
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

  /**
   * Espera o app abrir. Sinal principal: processo com a imagem do alvo
   * (`findRunning`). Sinal secundário: o PID spawnado ficou vivo em algum
   * momento — cobre `.lnk` cujo alvo é um launcher que delega e sai.
   */
  async function waitForOpen(pid: number, image: string): Promise<'image' | 'pid' | 'none'> {
    const startedAt = options.now?.() ?? Date.now()
    const maxAttempts = Math.ceil(verifyTimeoutMs / VERIFY_INTERVAL_MS) + 1
    let pidAlive = false
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.findRunning) {
        try {
          if (await options.findRunning(image)) return 'image'
        } catch {
          // `tasklist` falhou: segue com o sinal secundário do PID.
        }
      }
      if (!pidAlive) {
        try {
          pidAlive = await options.isProcessAlive(pid)
        } catch {
          pidAlive = false
        }
      }
      const elapsed = (options.now?.() ?? Date.now()) - startedAt
      if (elapsed >= verifyTimeoutMs) break
      await wait(VERIFY_INTERVAL_MS)
    }
    return pidAlive ? 'pid' : 'none'
  }

  async function open(name: string): Promise<OpenAppResult> {
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH) {
      return {
        ok: false,
        reason: 'unknown',
        error: 'Não consegui abrir o aplicativo: nome inválido.'
      }
    }
    const app = await findByName(name)
    if (!app) {
      const names = (await listNames()).slice(0, MAX_LISTED_NAMES).join(', ')
      return {
        ok: false,
        reason: 'unknown',
        error: names
          ? `Não consegui abrir o aplicativo ${name.trim()}: fora do catálogo. Disponíveis: ${names}.`
          : `Não consegui abrir o aplicativo ${name.trim()}: fora do catálogo.`
      }
    }

    const image = app.target ? imageNameFromTarget(app.target) : null
    if (image && options.findRunning) {
      const running = await options.findRunning(image).catch(() => false)
      if (running) {
        // Já existe processo com a imagem: abrir de novo duplicaria a janela.
        return {
          ok: true,
          app,
          pid: 0,
          verified: true,
          alreadyRunning: true,
          message: `O aplicativo ${app.name} já estava aberto.`
        }
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
      return {
        ok: false,
        reason: 'spawn',
        error: `Não consegui abrir o aplicativo ${app.name}: ${message}`
      }
    }
    const pid = typeof child.pid === 'number' && child.pid > 0 ? child.pid : 0
    if (pid === 0) {
      return {
        ok: false,
        reason: 'spawn',
        error: `Não consegui abrir o aplicativo ${app.name}: o processo não iniciou.`
      }
    }
    const successMessage = `Abri o aplicativo ${app.name}.`
    if (app.kind === 'aumid') {
      // O explorer.exe sai logo após encaminhar o AUMID; não há PID do app
      // para verificar. O spawn sem erro é o melhor sinal disponível.
      return { ok: true, app, pid, verified: false, message: successMessage }
    }
    if (image && options.findRunning) {
      const outcome = await waitForOpen(pid, image)
      if (outcome === 'image') {
        return { ok: true, app, pid, verified: true, message: successMessage }
      }
      if (outcome === 'pid') {
        // Launcher: o PID spawnado viveu, mas a imagem final é outra.
        return { ok: true, app, pid, verified: false, message: successMessage }
      }
      return {
        ok: false,
        reason: 'verify',
        error: `Não consegui abrir o aplicativo ${app.name}: ele não apareceu em ${Math.round(verifyTimeoutMs / 1000)} s.`
      }
    }
    if (app.kind === 'known') {
      // Apps conhecidos (ex.: notepad.exe) podem delegar a outra instância e
      // sair: verificar o PID daria falso negativo. O spawn sem erro basta.
      return { ok: true, app, pid, verified: false, message: successMessage }
    }
    if (!(await verifyPid(pid))) {
      return {
        ok: false,
        reason: 'verify',
        error: `Não consegui abrir o aplicativo ${app.name}: ele não apareceu em ${Math.round(verifyTimeoutMs / 1000)} s.`
      }
    }
    return { ok: true, app, pid, verified: true, message: successMessage }
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
      // Conhecidos não vão para o cache; são mesclados na leitura.
      (app) =>
        app.kind !== 'known' && normalizeLookupName(app.name) !== normalizeLookupName(trimmedName)
    )
    apps.push({ name: trimmedName, kind: 'aumid', aumid: aumid.trim() })
    memory = { signature, apps: mergeApps(apps) }
    await writeCache(signature, apps)
    return { ok: true }
  }

  return { load, listNames, open, registerAumid }
}
