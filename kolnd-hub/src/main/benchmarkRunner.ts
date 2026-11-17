import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/**
 * Ponte com o runner de benchmark em processo filho.
 *
 * Separado de `benchmark.ts` para ser testável sem Electron: o parser e o
 * controle de timeout/kill só dependem de `node:child_process`. Em produção o
 * executável é o próprio `electron.exe` com `ELECTRON_RUN_AS_NODE=1`; nos testes
 * é o `node` do Vitest — o protocolo é o mesmo.
 *
 * Protocolo (uma linha JSON por evento no stdout):
 *   {"type":"load","id":"integers"}
 *   {"type":"result","v":1,"loads":[...]}
 *   {"type":"error","message":"..."}
 */

/** Saída de uma carga: operações e tempo de cada repetição. */
export interface RunnerLoadResult {
  id: string
  ops: number[]
  ms: number[]
  guard: string
}

export type RunnerEvent =
  | { type: 'load'; id: string }
  | { type: 'result'; loads: RunnerLoadResult[] }
  | { type: 'error'; message: string }

export interface RunnerConfig {
  loads: string[]
  repeats: number
}

export interface RunRunnerOptions {
  /** Caminho do script CJS gerado em `<userData>/benchmark`. */
  scriptPath: string
  config: RunnerConfig
  timeoutMs: number
  /** Só os testes trocam; em produção é `process.execPath`. */
  execPath?: string
  /** Só os testes trocam; em produção o ambiente do processo é herdado. */
  env?: NodeJS.ProcessEnv
  /** Chamado logo após o spawn (o orquestrador registra o filho para matar). */
  onChild?: (child: ChildProcess) => void
  /** Eventos do runner, inclusive `load` para o progresso da interface. */
  onEvent?: (event: RunnerEvent) => void
}

/** Erro com mensagem pronta para a interface. */
export class RunnerError extends Error {
  /** Cauda do stderr (só para o log do main; nunca exibida crua ao usuário). */
  detail?: string
}

const MAX_LINE_BYTES = 64 * 1024
const MAX_STDERR_BYTES = 4096
const MAX_LOADS = 8
const MAX_REPS = 5
const MAX_ID = 32
const MAX_GUARD = 64
const MAX_MESSAGE = 200

function isPositiveSeries(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_REPS &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item) && item > 0)
  )
}

/**
 * Valida uma linha do runner. Entrada desconhecida, JSON parcial (stdout
 * truncado) ou números inválidos → null: o chamador ignora a linha em vez de
 * derrubar a execução inteira por causa de uma linha estranha no stdout.
 */
export function parseRunnerLine(line: string): RunnerEvent | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length > MAX_LINE_BYTES || !trimmed.startsWith('{')) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const raw = parsed as Record<string, unknown>

  if (raw.type === 'load') {
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (!id || id.length > MAX_ID) return null
    return { type: 'load', id }
  }

  if (raw.type === 'error') {
    const message =
      typeof raw.message === 'string' && raw.message.trim()
        ? raw.message.trim().slice(0, MAX_MESSAGE)
        : 'Falha ao executar uma das cargas de CPU.'
    return { type: 'error', message }
  }

  if (raw.type === 'result') {
    if (!Array.isArray(raw.loads) || raw.loads.length === 0 || raw.loads.length > MAX_LOADS) {
      return null
    }
    const loads: RunnerLoadResult[] = []
    for (const item of raw.loads) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const load = item as Record<string, unknown>
      const id = typeof load.id === 'string' ? load.id.trim() : ''
      if (!id || id.length > MAX_ID) return null
      if (!isPositiveSeries(load.ops) || !isPositiveSeries(load.ms)) return null
      if (load.ops.length !== load.ms.length) return null
      const guard = typeof load.guard === 'string' ? load.guard.slice(0, MAX_GUARD) : ''
      loads.push({ id, ops: load.ops, ms: load.ms, guard })
    }
    return { type: 'result', loads }
  }

  return null
}

/**
 * Executa o runner e resolve com as cargas medidas.
 *
 * O timeout é de segurança (não de medição): o trabalho é fixo, então estourar
 * significa processo travado. Nesse caso o filho é morto antes de rejeitar —
 * um filho esquecido continuaria consumindo CPU depois do erro.
 */
export function runRunner(options: RunRunnerOptions): Promise<RunnerLoadResult[]> {
  return new Promise<RunnerLoadResult[]>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(
        options.execPath ?? process.execPath,
        [options.scriptPath, JSON.stringify(options.config)],
        {
          env: { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      )
    } catch {
      reject(new RunnerError('Não foi possível iniciar o processo do benchmark.'))
      return
    }

    options.onChild?.(child)

    let settled = false
    let buffer = ''
    let stderr = ''
    let result: RunnerLoadResult[] | null = null
    let reportedError: string | null = null

    const finish = (error: RunnerError | null, value?: RunnerLoadResult[]): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        // Rejeita já, mas garante que o processo não fique girando.
        try {
          child.kill()
        } catch {
          // já encerrado
        }
        reject(error)
        return
      }
      resolve(value ?? [])
    }

    /** Falha com a mensagem amigável + stderr preservado para o log do main. */
    const fail = (message: string): void => {
      const error = new RunnerError(message)
      const tail = stderr.trim()
      if (tail) error.detail = tail.slice(0, MAX_STDERR_BYTES)
      finish(error)
    }

    const timer = setTimeout(() => {
      fail(
        'O benchmark demorou mais que o esperado e foi interrompido. Feche programas pesados e tente novamente.'
      )
    }, options.timeoutMs)

    const handleLine = (line: string): void => {
      const event = parseRunnerLine(line)
      if (!event) return
      if (event.type === 'error') {
        reportedError = event.message
        return
      }
      if (event.type === 'result') result = event.loads
      try {
        options.onEvent?.(event)
      } catch {
        // A interface pode ter desaparecido no meio do run — a medição continua.
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.length > MAX_LINE_BYTES) {
        // stdout fora do protocolo (ex.: script errado no caminho): não cresce sem limite.
        fail('O processo do benchmark retornou dados inválidos.')
        return
      }
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        handleLine(line)
        newline = buffer.indexOf('\n')
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8')
    })

    child.on('error', () => {
      fail('Não foi possível iniciar o processo do benchmark.')
    })

    child.on('close', () => {
      if (settled) return
      // Última linha sem `\n` (stdout fechado abruptamente) ainda pode ser o resultado.
      if (buffer.trim()) handleLine(buffer)
      buffer = ''
      if (reportedError) {
        fail('Não foi possível executar uma das cargas de CPU.')
        return
      }
      if (result && result.length > 0) {
        finish(null, result)
        return
      }
      fail('O processo do benchmark não retornou um resultado válido.')
    })
  })
}
