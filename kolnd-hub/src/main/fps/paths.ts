import { isAbsolute, join } from 'path'

/**
 * Caminhos e constantes do agente de captura de FPS.
 *
 * Módulo PURO (sem Electron): o main e os testes usam os mesmos caminhos.
 *
 * `%ProgramData%\Kolnd Hub\capture` é um diretório NOVO de propósito: a limpeza
 * legada do agente de sensores apaga `%ProgramData%\Kolnd Hub\fps` inteiro no
 * re-stage. Usar o mesmo caminho faria um update de sensores remover o motor.
 */

export const FPS_CAPTURE_TASK_NAME = 'KolndHubFpsCapture'
export const FPS_CAPTURE_DIR_NAME = 'capture'
export const FPS_CAPTURE_BIN_DIR = 'bin'
export const FPS_CAPTURE_AGENT_DIR = 'agent'
export const FPS_AGENT_SCRIPT_FILE = 'fps-agent.ps1'
export const FPS_SINK_FILE = 'latest.json'
export const FPS_STOP_FILE = 'stop.flag'
export const FPS_MANIFEST_FILE = 'manifest.json'
export const FPS_ERROR_FILE = 'agent-error.txt'
export const FPS_HEARTBEAT_FILE = 'heartbeat'

/**
 * Constantes de tempo/limites canônicas vivem em `src/shared/fps.ts` (o
 * renderer também valida) e são reexportadas aqui para o main não duplicar
 * números. O main reescreve o heartbeat a cada 2 s; sem ele a captura para em
 * ~5 s. O tap publica uma janela por segundo; > 3 s é `unavailable`.
 */
export {
  FPS_HEARTBEAT_INTERVAL_MS,
  FPS_HEARTBEAT_STALE_MS,
  FPS_MAX_FPS,
  FPS_MAX_FRAMETIME_MS,
  FPS_MAX_PIDS,
  FPS_MAX_PROCESS_NAME_LENGTH,
  FPS_MAX_SINK_BYTES,
  FPS_READ_CACHE_MS,
  FPS_SINK_STALE_MS,
  FPS_WINDOW_MS
} from '../../shared/fps'
/** Nome da subpasta de sink usada pelos testes E2E dentro do userData temporário. */
export const FPS_TEST_SINK_DIR = 'fps-sink'

function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

/** Caminho absoluto, curto e sem aspas/caractere de controle. */
export function isSafeFpsPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && isAbsolute(value) && !hasUnsafeChars(value)
}

/** Raiz `%ProgramData%\Kolnd Hub\capture`. */
export function resolveCaptureDir(programDataDir: string): string {
  return join(programDataDir, 'Kolnd Hub', FPS_CAPTURE_DIR_NAME)
}

/**
 * Override de teste APENAS quando `KOLDND_HUB_TEST_USERDATA` é um caminho
 * absoluto válido (mesmo contrato do harness Playwright). O sink fica em
 * `<userData>/fps-sink/latest.json` e o e2e semeia o arquivo sem elevação.
 */
export function resolveFpsSinkDir(programDataDir: string, testUserData?: string | null): string {
  const candidate = typeof testUserData === 'string' ? testUserData.trim() : ''
  if (candidate && isSafeFpsPath(candidate)) {
    return join(candidate, FPS_TEST_SINK_DIR)
  }
  return resolveCaptureDir(programDataDir)
}

export function captureLatestPath(captureDir: string): string {
  return join(captureDir, FPS_SINK_FILE)
}

export function captureStopPath(captureDir: string): string {
  return join(captureDir, FPS_STOP_FILE)
}

export function captureManifestPath(captureDir: string): string {
  return join(captureDir, FPS_MANIFEST_FILE)
}

export function captureErrorPath(captureDir: string): string {
  return join(captureDir, FPS_ERROR_FILE)
}

export function captureBinDir(captureDir: string): string {
  return join(captureDir, FPS_CAPTURE_BIN_DIR)
}

export function captureAgentDir(captureDir: string): string {
  return join(captureDir, FPS_CAPTURE_AGENT_DIR)
}

export function captureStagedScriptPath(captureDir: string): string {
  return join(captureAgentDir(captureDir), FPS_AGENT_SCRIPT_FILE)
}

/** Heartbeat do Hub: `<userData>/fps/heartbeat` (userData já é %APPDATA%\kolnd-hub). */
export function resolveHeartbeatPath(userDataDir: string): string {
  return join(userDataDir, 'fps', FPS_HEARTBEAT_FILE)
}
