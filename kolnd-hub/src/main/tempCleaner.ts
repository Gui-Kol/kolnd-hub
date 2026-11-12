import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'

export interface CleanResult {
  ok: boolean
  /** Quantos arquivos foram removidos (pastas vazias antigas não entram na conta). */
  filesRemoved: number
  /** Soma dos tamanhos, em bytes, dos arquivos removidos (stat antes do unlink). */
  bytesFreed: number
  /** Itens ignorados por estarem em uso ou sem permissão (EPERM/EACCES/EBUSY). */
  skippedLocked: number
  /** Falhas inesperadas — nunca abortam a varredura. */
  errors: number
  /** Pastas efetivamente varridas (para exibição opcional na interface). */
  paths?: string[]
  /** Mensagem amigável em caso de falha global (nunca um stack trace). */
  error?: string
}

/** Conservadorismo: só remove o que tem mais de 24 h sem alteração. */
const MIN_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Pastas-alvo — NENHUMA outra é tocada. `os.tmpdir()` é deduplicado contra
 * `%LOCALAPPDATA%\Temp` (na prática, quase sempre o mesmo caminho).
 * C:\Windows\SoftwareDistribution, Prefetch, registro e downloads ficam de fora.
 */
function resolveTempRoots(): string[] {
  const windowsRoot = (process.env.SystemRoot ?? '').trim() || 'C:\\Windows'
  const localAppData = (process.env.LOCALAPPDATA ?? '').trim()
  const candidates = [
    os.tmpdir(),
    localAppData ? path.join(localAppData, 'Temp') : null,
    path.join(windowsRoot, 'Temp')
  ]
  const seen = new Set<string>()
  const roots: string[] = []
  for (const candidate of candidates) {
    if (!candidate) continue
    const resolved = path.resolve(candidate)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (seen.has(key)) continue
    seen.add(key)
    roots.push(resolved)
  }
  return roots
}

const isLockedCode = (code?: string): boolean =>
  code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'

/** Recência de um item: o mais novo entre mtime e ctime — na dúvida, preserva. */
function recentMs(st: { mtimeMs: number; ctimeMs: number }): number {
  return Math.max(st.mtimeMs || 0, st.ctimeMs || 0)
}

function isOldEnough(st: { mtimeMs: number; ctimeMs: number }, now: number): boolean {
  return now - recentMs(st) > MIN_AGE_MS
}

interface ScanCounters {
  filesRemoved: number
  bytesFreed: number
  skippedLocked: number
  errors: number
}

/**
 * Varre o conteúdo de `dir`. `root` é a pasta-alvo original (defesa em
 * profundidade: nunca opera fora dela). Arquivos/pastas em uso são ignorados
 * individualmente — a varredura nunca aborta por causa de um item.
 * A pasta raiz em si nunca é removida; subpastas vazias antigas são removidas
 * ao final, de baixo para cima.
 */
async function cleanDirectory(
  dir: string,
  root: string,
  counters: ScanCounters,
  now: number
): Promise<void> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (err) {
    // Pasta sem permissão/em uso: conta como ignorada e segue para as demais.
    const code = (err as NodeJS.ErrnoException).code
    if (isLockedCode(code)) counters.skippedLocked += 1
    else counters.errors += 1
    return
  }

  const rootKey = process.platform === 'win32' ? root.toLowerCase() : root
  const rootWithSep = rootKey.endsWith(path.sep) ? rootKey : rootKey + path.sep

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    // Nunca seguir para fora da raiz-alvo (nomes estranhos, `..`, etc.).
    const resolved = path.resolve(fullPath)
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    if (key !== rootKey && !key.startsWith(rootWithSep)) continue

    // Symlinks/reparse points podem apontar para fora da raiz — ignora sempre.
    if (entry.isSymbolicLink()) continue

    try {
      if (entry.isDirectory()) {
        await cleanDirectory(fullPath, root, counters, now)
        const st = await fs.stat(fullPath).catch(() => null)
        if (st && isOldEnough(st, now)) {
          try {
            await fs.rmdir(fullPath) // só remove se estiver vazia
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            // ENOTEMPTY/EEXIST = sobrou algo dentro (ex.: arquivo novo) — normal, ignora.
            if (code === 'ENOTEMPTY' || code === 'EEXIST') continue
            if (isLockedCode(code)) counters.skippedLocked += 1
            else counters.errors += 1
          }
        }
        continue
      }

      if (!entry.isFile()) continue // sockets, pipes, etc. — fora do escopo

      const st = await fs.stat(fullPath)
      if (!isOldEnough(st, now)) continue // < 24 h: preserva

      const size = st.size
      await fs.unlink(fullPath)
      counters.filesRemoved += 1
      counters.bytesFreed += size
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (isLockedCode(code)) counters.skippedLocked += 1
      else counters.errors += 1
    }
  }
}

/**
 * Remove o conteúdo seguro das pastas temporárias e devolve o relatório.
 * Nunca toca em nada fora das três raízes; nunca lança — falhas viram contadores.
 */
export async function cleanTempFiles(): Promise<CleanResult> {
  const counters: ScanCounters = { filesRemoved: 0, bytesFreed: 0, skippedLocked: 0, errors: 0 }
  const now = Date.now()
  const swept: string[] = []

  try {
    for (const root of resolveTempRoots()) {
      let st: import('fs').Stats | null = null
      try {
        st = await fs.stat(root)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        // ENOENT = pasta não existe nesta máquina — simplesmente ignora.
        if (code !== 'ENOENT') {
          if (isLockedCode(code)) counters.skippedLocked += 1
          else counters.errors += 1
        }
        continue
      }
      if (!st.isDirectory()) continue
      swept.push(root)
      await cleanDirectory(root, root, counters, now)
    }

    if (swept.length === 0) {
      return {
        ok: false,
        filesRemoved: 0,
        bytesFreed: 0,
        skippedLocked: counters.skippedLocked,
        errors: counters.errors,
        error:
          'Não foi possível acessar as pastas temporárias. Verifique as permissões ou tente novamente em alguns instantes.'
      }
    }

    return { ok: true, ...counters, paths: swept }
  } catch {
    // Defesa final: nada fora das pastas temporárias foi alterado.
    return {
      ok: false,
      filesRemoved: 0,
      bytesFreed: 0,
      skippedLocked: counters.skippedLocked,
      errors: counters.errors + 1,
      error:
        'Não foi possível concluir a limpeza. Os arquivos em uso foram mantidos e nada fora das pastas temporárias foi alterado.'
    }
  }
}

/** Registra os canais IPC relacionados à limpeza do sistema. */
export function registerTempCleanerIpc(): void {
  ipcMain.handle('system:clean-temp', (): Promise<CleanResult> => cleanTempFiles())
}
