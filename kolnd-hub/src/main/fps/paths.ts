import { isAbsolute, join } from 'path'

/**
 * Caminhos puros da medição de FPS — sem Electron, para serem usados pelo
 * agente elevado de sensores sem criar ciclo de importação com `helper.ts`
 * (que carrega `app`) nem com `agent.ts` (que carrega IPC).
 */

/** Nome do diretório de FPS em userData e em `%ProgramData%`. */
export const FPS_DIR_NAME = 'fps'
/** Executável compilado do coletor ETW. */
export const FPS_HELPER_EXE = 'KolndFpsEtw.exe'

export interface FpsStagingPaths {
  dir: string
  sourcePath: string
  stagingExePath: string
}

export function resolveFpsStagingPaths(userDataDir: string): FpsStagingPaths {
  const dir = join(userDataDir, FPS_DIR_NAME)
  return {
    dir,
    sourcePath: join(dir, 'KolndFpsEtw.cs'),
    stagingExePath: join(dir, FPS_HELPER_EXE)
  }
}

/** `true` quando há aspas/quebra de linha/caractere de controle (injeção). */
function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

/**
 * Diretório do sink de FPS: `KOLDND_HUB_FPS_DIR` quando válido (E2E), senão
 * `%ProgramData%\Kolnd Hub\fps`. Caminho inválido no env é ignorado em vez de
 * derrubar o app.
 */
export function resolveFpsSinkDir(programDataDir: string, override?: string | null): string {
  const candidate = typeof override === 'string' ? override.trim() : ''
  if (
    candidate &&
    candidate.length <= 1024 &&
    isAbsolute(candidate) &&
    !hasUnsafeChars(candidate)
  ) {
    return candidate
  }
  return join(programDataDir, 'Kolnd Hub', FPS_DIR_NAME)
}
