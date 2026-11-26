import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Fixture do sink de FPS para o E2E.
 *
 * O main só troca o diretório do sink quando `KOLDND_HUB_TEST_USERDATA` é um
 * caminho absoluto válido (mesmo contrato do `global-setup`), então o teste
 * semeia `<userData>/fps-sink/latest.json` SEM elevação. Nada aqui toca a
 * captura real, a tarefa agendada ou o UAC.
 */

export const FPS_LONG_PROCESS = 'UmProcessoComNomeMuitoLongoQuePrecisaQuebrarLinha.exe'
export const FPS_LONG_PROCESS_DISPLAY = 'UmProcessoComNomeMuitoLongoQuePrecisaQuebrarLinha'

export interface FpsSinkOverrides {
  timestamp?: string
  foregroundPid?: number | null
  foregroundName?: string | null
  pids?: Array<{ pid: number; name: string; presents: number; frametimeMs: number }>
}

export function fpsSinkPayload(overrides: FpsSinkOverrides = {}): Record<string, unknown> {
  return {
    schema: 2,
    engine: { name: 'PresentMon', version: '2.6.0' },
    timestamp: new Date().toISOString(),
    foregroundPid: 424242,
    foregroundName: FPS_LONG_PROCESS,
    windowMs: 1000,
    pids: [
      {
        pid: 424242,
        name: FPS_LONG_PROCESS,
        presents: 144,
        frametimeMs: 6.94
      }
    ],
    ...overrides
  }
}

export function fpsSinkPath(userDataDir: string): string {
  return join(userDataDir, 'fps-sink', 'latest.json')
}

export function seedFpsSink(userDataDir: string, overrides: FpsSinkOverrides = {}): void {
  const path = fpsSinkPath(userDataDir)
  mkdirSync(join(userDataDir, 'fps-sink'), { recursive: true })
  writeFileSync(path, JSON.stringify(fpsSinkPayload(overrides)), 'utf8')
}

export function removeFpsSink(userDataDir: string): void {
  try {
    rmSync(fpsSinkPath(userDataDir), { force: true })
  } catch {
    // arquivo travado não impede o teste
  }
}

/**
 * Mantém o timestamp fresco (o main considera > 3 s como parado) durante o
 * teste. Devolve a função de parada.
 */
export function startFpsSinkLoop(
  userDataDir: string,
  overrides: FpsSinkOverrides = {}
): () => void {
  seedFpsSink(userDataDir, overrides)
  const timer = setInterval(() => seedFpsSink(userDataDir, overrides), 1_000)
  return () => clearInterval(timer)
}
