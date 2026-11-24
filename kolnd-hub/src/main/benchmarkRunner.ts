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
 *   {"type":"ready"}                                     → aquecimento concluído; espera `go` no stdin
 *   {"type":"load","id":"integers"}                      → carga concluída
 *   {"type":"result","v":1,"loads":[...]}                → resultado final (última linha)
 *   {"type":"error","message":"..."}                     → falha da carga
 *   {"type":"stress","checksumOk":true,"elapsedMs":123}  → amostra do modo `stress`
 *
 * A barreira `ready`/`go` existe para que todos os filhos comecem a medir no
 * mesmo instante: sem ela, o multi terminava em cauda (filhos iniciados em
 * sequência terminam em momentos diferentes e a fase inteira perde núcleos no
 * final). O `go` é enviado pelo orquestrador quando **todos** estão prontos.
 */

/** Saída de uma carga: operações e tempo de cada repetição. */
export interface RunnerLoadResult {
  id: string
  ops: number[]
  ms: number[]
  guard: string
}

export type RunnerEvent =
  | { type: 'ready' }
  | { type: 'load'; id: string }
  | { type: 'result'; loads: RunnerLoadResult[] }
  | { type: 'error'; message: string }
  | { type: 'stress'; elapsedMs: number; checksumOk: boolean }

/** `bench` mede as cargas; `stress` é carga contínua até o processo ser morto. */
export type RunnerMode = 'bench' | 'stress'

export interface RunnerConfig {
  mode?: RunnerMode
  loads?: string[]
  repeats?: number
}

export interface RunRunnerOptions {
  /** Caminho do script CJS gerado em `<userData>/benchmark`. */
  scriptPath: string
  config: RunnerConfig
  /** Timeout da medição inteira (spawn + aquecimento + `go` + cargas). */
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

/** Opções comuns aos dois modos do runner. */
export interface SpawnRunnerOptions {
  /** Caminho do script CJS gerado em `<userData>/benchmark`. */
  scriptPath: string
  config: RunnerConfig
  /** Só os testes trocam; em produção é `process.execPath`. */
  execPath?: string
  /** Só os testes trocam; em produção o ambiente do processo é herdado. */
  env?: NodeJS.ProcessEnv
  /** Chamado logo após o spawn (o orquestrador registra o filho para matar). */
  onChild?: (child: ChildProcess) => void
  /** Eventos do runner (progresso, ready, checksum do estresse). */
  onEvent?: (event: RunnerEvent) => void
}

export interface StartRunnerOptions extends SpawnRunnerOptions {
  /**
   * Timeout de spawn + aquecimento (antes do `go`). Precisa ser generoso: com
   * todos os núcleos já saturados pelo próprio multi, criar 16 processos pode
   * levar segundos — mas medir não começou, então não é falha da medição.
   */
  readyTimeoutMs: number
  /** Timeout da medição, contado **a partir do `go`**. */
  timeoutMs: number
}

/** Filho do benchmark já spawnado, esperando a barreira para medir. */
export interface RunnerSession {
  child: ChildProcess
  /** Resolve quando o filho aqueceu todas as cargas e está pronto para o `go`. */
  ready: Promise<void>
  /** Resolve com as cargas medidas depois do `go`. */
  result: Promise<RunnerLoadResult[]>
  /** Libera a medição. O orquestrador chama em todos os filhos juntos. */
  sendGo(): void
  /** Mata o processo (fim, cancelamento, timeout). */
  kill(): void
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

  if (raw.type === 'ready') return { type: 'ready' }

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

  if (raw.type === 'stress') {
    const elapsedMs = typeof raw.elapsedMs === 'number' ? raw.elapsedMs : NaN
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null
    return { type: 'stress', elapsedMs, checksumOk: raw.checksumOk === true }
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

/** Spawn cru do script (modo bench com stdin para o `go`; estresse sem stdin). */
function spawnScript(options: SpawnRunnerOptions, stdin: 'pipe' | 'ignore'): ChildProcess {
  const child = spawn(
    options.execPath ?? process.execPath,
    [options.scriptPath, JSON.stringify(options.config)],
    {
      env: { ...(options.env ?? process.env), ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: [stdin, 'pipe', 'pipe']
    }
  )
  options.onChild?.(child)
  return child
}

/** Acumula stderr até um teto (só para o log do main). */
function collectStderr(child: ChildProcess): () => string {
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8')
  })
  return () => stderr
}

/** Cria o erro com a mensagem amigável + stderr preservado para o log. */
function runnerError(message: string, stderr: () => string): RunnerError {
  const error = new RunnerError(message)
  const tail = stderr().trim()
  if (tail) error.detail = tail.slice(0, MAX_STDERR_BYTES)
  return error
}

/**
 * Spawna o runner do benchmark e devolve o controle da barreira `ready`/`go`.
 *
 * O timeout tem duas fases: `readyTimeoutMs` cobre spawn + aquecimento (antes
 * do `go`) e `timeoutMs` só começa a contar quando o `go` é enviado. Assim a
 * criação dos 16 processos sob carga não é confundida com uma medição travada.
 */
export function startRunner(options: StartRunnerOptions): RunnerSession {
  let child: ChildProcess
  try {
    child = spawnScript(options, 'pipe')
  } catch {
    throw new RunnerError('Não foi possível iniciar o processo do benchmark.')
  }

  // O `go` é escrito num pipe: se o filho morrer antes (EPIPE assíncrono no
  // stream), sem listener isso viraria um `error` não tratado e derrubaria o main.
  child.stdin?.on('error', () => undefined)

  const stderr = collectStderr(child)

  let buffer = ''
  let result: RunnerLoadResult[] | null = null
  let reportedError: string | null = null
  let readySettled = false
  let resultSettled = false
  let resultTimer: NodeJS.Timeout | null = null

  let resolveReady!: () => void
  let rejectReady!: (error: RunnerError) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  let resolveResult!: (loads: RunnerLoadResult[]) => void
  let rejectResult!: (error: RunnerError) => void
  const resultPromise = new Promise<RunnerLoadResult[]>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  // O orquestrador observa as duas promessas (ready na barreira, result na
  // medição). Quando o filho falha antes do ready, a de resultado também
  // rejeita; sem o catch abaixo isso viraria uma rejeição não tratada.
  void ready.catch(() => undefined)
  void resultPromise.catch(() => undefined)

  const kill = (): void => {
    try {
      child.kill()
    } catch {
      // já encerrado
    }
  }

  /** Falha nas duas fases que ainda não terminaram e garante que o filho morra. */
  const fail = (message: string): void => {
    const error = runnerError(message, stderr)
    if (!readySettled) {
      readySettled = true
      clearTimeout(readyTimer)
      rejectReady(error)
    }
    if (!resultSettled) {
      resultSettled = true
      if (resultTimer) clearTimeout(resultTimer)
      kill()
      rejectResult(error)
    }
  }

  const readyTimer = setTimeout(() => {
    fail(
      'O processo do benchmark não ficou pronto a tempo e foi interrompido. Feche programas pesados e tente novamente.'
    )
  }, options.readyTimeoutMs)

  const handleLine = (line: string): void => {
    const event = parseRunnerLine(line)
    if (!event) return
    if (event.type === 'ready' && !readySettled) {
      readySettled = true
      clearTimeout(readyTimer)
      resolveReady()
    }
    if (event.type === 'error') reportedError = event.message
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

  child.on('error', () => {
    fail('Não foi possível iniciar o processo do benchmark.')
  })

  child.on('close', () => {
    if (resultSettled) return
    // Última linha sem `\n` (stdout fechado abruptamente) ainda pode ser o resultado.
    if (buffer.trim()) handleLine(buffer)
    buffer = ''
    if (!readySettled) {
      fail('O processo do benchmark encerrou antes de começar a medição.')
      return
    }
    if (reportedError) {
      fail('Não foi possível executar uma das cargas de CPU.')
      return
    }
    if (result && result.length > 0) {
      resultSettled = true
      if (resultTimer) clearTimeout(resultTimer)
      resolveResult(result)
      return
    }
    fail('O processo do benchmark não retornou um resultado válido.')
  })

  return {
    child,
    ready,
    result: resultPromise,
    sendGo(): void {
      // Só libera um filho pronto e ainda não medido (chamada dupla é inofensiva).
      if (!readySettled || resultSettled || resultTimer) return
      try {
        child.stdin?.write('go\n')
      } catch {
        // stdin fechado: o `close` do filho vai decidir o resultado.
      }
      resultTimer = setTimeout(() => {
        fail(
          'O benchmark demorou mais que o esperado e foi interrompido. Feche programas pesados e tente novamente.'
        )
      }, options.timeoutMs)
    },
    kill
  }
}

/**
 * Executa o runner inteiro (uma fase de um filho) e resolve com as cargas.
 *
 * Aqui o `go` é enviado assim que o próprio filho fica pronto: é o caminho dos
 * testes e de qualquer uso isolado. O benchmark do app usa `startRunner`
 * direto para mandar o `go` em todos os filhos ao mesmo tempo.
 */
export function runRunner(options: RunRunnerOptions): Promise<RunnerLoadResult[]> {
  let session: RunnerSession
  try {
    session = startRunner({
      scriptPath: options.scriptPath,
      config: options.config,
      readyTimeoutMs: options.timeoutMs,
      timeoutMs: options.timeoutMs,
      execPath: options.execPath,
      env: options.env,
      onChild: options.onChild,
      onEvent: options.onEvent
    })
  } catch (error) {
    return Promise.reject(error)
  }
  void session.ready.then(() => session.sendGo()).catch(() => undefined)
  return session.result
}

/**
 * Spawna um filho do teste de estresse (carga contínua até ser morto).
 *
 * O modo `stress` é um loop sem sleep: quem segura a máquina utilizável é a
 * prioridade BELOW_NORMAL definida pelo próprio script, não um duty cycle.
 * Não há timeout de propósito — o teste roda até `stopStress`/cancelar/sair.
 */
export function startStressRunner(options: SpawnRunnerOptions): ChildProcess {
  const child = spawnScript(options, 'ignore')
  collectStderr(child)

  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    if (buffer.length > MAX_LINE_BYTES) {
      // Stdout fora do protocolo: descarta o excesso e segue (o estresse não
      // tem resultado a perder; o checksum fica a cargo dos eventos válidos).
      buffer = ''
      return
    }
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      const event = parseRunnerLine(line)
      if (event) {
        try {
          options.onEvent?.(event)
        } catch {
          // A interface pode ter desaparecido — o estresse continua até parar.
        }
      }
      newline = buffer.indexOf('\n')
    }
  })

  return child
}
