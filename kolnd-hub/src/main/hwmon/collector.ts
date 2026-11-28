import { spawn } from 'child_process'
import { logger } from '../logger'
import { buildCimDynamicScript, buildCimStaticScript } from './cimScripts'
import { resolvePowershellPath } from './systemPaths'

/**
 * Coletor persistente do monitor de hardware.
 *
 * Problema: cada tick criava 2–3 processos (PowerShell do CIM dinâmico, o do
 * NVML e o `nvidia-smi`). Em 0,5 s isso consome um núcleo e enche o sistema de
 * PIDs novos. A solução replica o helper de processos do `startupManager`: UM
 * `powershell.exe` por sessão, criado na primeira coleta, com 1 request em voo
 * e resposta por linha no stdout.
 *
 * Protocolo (ASCII puro no PowerShell 5.1):
 *   stdin  → `{"id":1,"job":"cim-dynamic","includeGpuEngine":false}` por linha;
 *   stdout → `KOLND-HWM 1 {json}` por linha; ruído/avisos são ignorados.
 *
 * A `CimSession` é aberta uma vez no start e o C#/`nvml.dll` são carregados uma
 * vez (env `KOLND_HWM_NVML_*`). Qualquer falha de transporte mata o processo e
 * a próxima chamada recria; após 2 falhas seguidas o coletor é desativado e o
 * `nativeSensors` volta ao caminho por tick até o fim da sessão.
 */

export type HwCollectJob = 'cim-dynamic' | 'static' | 'nvml'

export interface HwCollectRequest {
  id: number
  job: HwCollectJob
  /** Só para `cim-dynamic`: consulta o contador GPUEngine (AMD/Intel). */
  includeGpuEngine?: boolean
}

/** Resposta já parseada de uma linha `KOLND-HWM <id> <json>`. */
export interface HwCollectResponse {
  id: number
  payload: unknown
}

/** Superfície mínima usada pelo `nativeSensors`/`nvml` (injetável em testes). */
export interface HwCollectorClient {
  request(job: HwCollectJob, options?: { includeGpuEngine?: boolean }): Promise<unknown>
  isDisabled(): boolean
}

export interface HwCollectorNvmlAssets {
  dllPath: string
  assemblyPath: string
}

export interface HwCollectorOutput {
  setEncoding?(encoding: BufferEncoding): void
  on(event: 'data', listener: (chunk: string | Buffer) => void): void
}

export interface HwCollectorInput {
  write(data: string): void
  end(): void
  on(event: 'error', listener: () => void): void
}

export interface HwCollectorChild {
  stdout: HwCollectorOutput | null
  stderr: HwCollectorOutput | null
  stdin: HwCollectorInput | null
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: () => void): void
  kill(): void
}

export interface HwCollectorSpawnOptions {
  windowsHide: boolean
  stdio: ['pipe', 'pipe', 'pipe']
  env: NodeJS.ProcessEnv
}

export type HwCollectorSpawn = (
  file: string,
  args: string[],
  options: HwCollectorSpawnOptions
) => HwCollectorChild

export interface HwCollectorClock {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface HwCollectorDeps {
  spawn?: HwCollectorSpawn
  clock?: HwCollectorClock
  powershellPath?: () => string
  loadNvmlAssets?: () => Promise<HwCollectorNvmlAssets | null>
}

export const COLLECTOR_PREFIX = 'KOLND-HWM '
/** Orçamento por request em regime. */
export const COLLECT_TIMEOUT_MS = 2000
/**
 * Orçamento das primeiras respostas: o start inclui `CimSession`, `Add-Type` do
 * NVML e a consulta CIM estática. Só vale até a primeira resposta chegar.
 */
export const COLLECT_FIRST_TIMEOUT_MS = 8000
const MAX_CONSECUTIVE_FAILURES = 2
/** Kill de segurança depois de fechar o stdin no quit. */
export const COLLECT_KILL_GRACE_MS = 1000

/**
 * Parser puro de uma linha (ou chunk) do helper. Aceita apenas
 * `KOLND-HWM <id> <json>`; BOM, linhas vazias, avisos do PowerShell e JSON
 * inválido são ignorados. Com `expectedId`, só a resposta daquele request vale
 * (uma resposta atrasada de outro id é descartada).
 */
export function parseCollectorLine(
  raw: string | null | undefined,
  expectedId?: number
): HwCollectResponse | null {
  if (!raw) return null

  for (const chunk of raw.split(/\r?\n/)) {
    const line = chunk.replace(/^\uFEFF/, '').trim()
    if (!line.startsWith(COLLECTOR_PREFIX)) continue

    const rest = line.slice(COLLECTOR_PREFIX.length)
    const separator = rest.indexOf(' ')
    if (separator <= 0) continue

    const idText = rest.slice(0, separator)
    if (!/^\d+$/.test(idText)) continue
    const id = Number(idText)
    if (expectedId !== undefined && id !== expectedId) continue

    const jsonText = rest.slice(separator + 1).trim()
    if (!jsonText) continue

    let payload: unknown
    try {
      payload = JSON.parse(jsonText)
    } catch {
      continue
    }
    return { id, payload }
  }

  return null
}

/**
 * Script do helper (ASCII puro — PowerShell 5.1 lê como ANSI).
 *
 * Os corpos CIM vêm de `cimScripts.ts` com `Get-KolndCim` no lugar de
 * `Get-CimInstance`: a função decide entre a `CimSession` aberta uma vez e a
 * consulta local. O NVML é carregado uma única vez no start (quando os env de
 * asset existem) e o job `nvml` só lê as ventoinhas.
 */
export function buildCollectorScript(): string {
  const staticBody = buildCimStaticScript('Get-KolndCim')
  const dynamicWithEngine = buildCimDynamicScript(true, 'Get-KolndCim')
  const dynamicNoEngine = buildCimDynamicScript(false, 'Get-KolndCim')

  return [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$ProgressPreference="SilentlyContinue"',
    '$script:session=$null',
    'try { $script:session=New-CimSession -SessionOption (New-CimSessionOption -Protocol Dcom) -ErrorAction Stop } catch { try { $script:session=New-CimSession -ErrorAction Stop } catch { $script:session=$null } }',
    'function Get-KolndCim { param([string]$ClassName,[string]$Namespace="root/cimv2"); if ($script:session) { return Get-CimInstance -ClassName $ClassName -Namespace $Namespace -CimSession $script:session } return Get-CimInstance -ClassName $ClassName -Namespace $Namespace }',
    `function Get-KolndStatic { ${staticBody} }`,
    `function Get-KolndDynamic { ${dynamicWithEngine} }`,
    `function Get-KolndDynamicNoEngine { ${dynamicNoEngine} }`,
    '$script:nvmlReady=$false',
    'if ($env:KOLND_HWM_NVML_ASSEMBLY -and $env:KOLND_HWM_NVML_DLL) { try { Add-Type -Path $env:KOLND_HWM_NVML_ASSEMBLY -ErrorAction Stop; $init=[KolndNvml]::Init($env:KOLND_HWM_NVML_DLL) | ConvertFrom-Json; $script:nvmlReady=($init.ok -eq $true) } catch { $script:nvmlReady=$false } }',
    'function Get-KolndNvml { if (-not $script:nvmlReady) { return \'{"available":false,"rpm":null,"fanCount":0}\' } try { $parsed=[KolndNvml]::ReadFans() | ConvertFrom-Json; if ($parsed.ok -ne $true) { return \'{"available":false,"rpm":null,"fanCount":0}\' }; $fans=@(); if ($parsed.fans) { $fans=@($parsed.fans) }; $rpm=$null; $percent=$null; foreach ($fan in $fans) { if ($null -ne $fan.rpm) { $rpm=[int]$fan.rpm; $percent=$fan.percent; break } }; if ($null -eq $rpm) { foreach ($fan in $fans) { if ($null -ne $fan.percent) { $percent=$fan.percent; break } } }; return (@{available=$true;rpm=$rpm;percent=$percent;fanCount=$fans.Count} | ConvertTo-Json -Compress) } catch { return \'{"available":false,"rpm":null,"fanCount":0}\' } }',
    'while ($true) {',
    '  $line=[Console]::In.ReadLine()',
    '  if ($null -eq $line) { break }',
    '  $line=$line.Trim()',
    '  if ($line -eq "") { continue }',
    '  if ($line -eq "quit") { break }',
    '  $json="null"',
    '  $id=0',
    '  try {',
    '    $req=$line | ConvertFrom-Json',
    '    $id=[int]$req.id',
    '    switch ([string]$req.job) {',
    '      "static" { $json=Get-KolndStatic }',
    '      "cim-dynamic" { if ($req.includeGpuEngine -eq $true) { $json=Get-KolndDynamic } else { $json=Get-KolndDynamicNoEngine } }',
    '      "nvml" { $json=Get-KolndNvml }',
    '      default { $json="null" }',
    '    }',
    '  } catch { $json="null" }',
    '  if ($null -eq $json) { $json="null" }',
    '  [Console]::Out.WriteLine("KOLND-HWM " + $id + " " + $json)',
    '  [Console]::Out.Flush()',
    '}',
    'if ($script:nvmlReady) { try { [KolndNvml]::Shutdown() | Out-Null } catch { } }',
    'if ($script:session) { try { Remove-CimSession -CimSession $script:session -ErrorAction SilentlyContinue } catch { } }'
  ].join('\n')
}

const defaultSpawn: HwCollectorSpawn = (file, args, options) =>
  spawn(file, args, options) as unknown as HwCollectorChild

const defaultClock: HwCollectorClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

type NvmlAssetLoader = () => Promise<HwCollectorNvmlAssets | null>

interface PendingRequest {
  id: number
  timer: unknown
  resolve(payload: unknown): void
  reject(error: Error): void
}

export class HwCollector implements HwCollectorClient {
  private readonly spawnProcess: HwCollectorSpawn
  private readonly clock: HwCollectorClock
  private readonly powershellPath: () => string
  private readonly loadAssets: NvmlAssetLoader

  private child: HwCollectorChild | null = null
  private buffer = ''
  private pending: PendingRequest | null = null
  private tail: Promise<void> = Promise.resolve()
  private nextId = 1
  private failures = 0
  private disabled = false
  private stopped = false
  private firstResponsePending = true

  constructor(deps: HwCollectorDeps = {}) {
    this.spawnProcess = deps.spawn ?? defaultSpawn
    this.clock = deps.clock ?? defaultClock
    this.powershellPath = deps.powershellPath ?? resolvePowershellPath
    this.loadAssets =
      deps.loadNvmlAssets ??
      (() => (moduleAssetLoader ? moduleAssetLoader() : Promise.resolve(null)))
  }

  isDisabled(): boolean {
    return this.disabled
  }

  /**
   * Enfileira um job. O `nativeSensors` dispara estático, dinâmico e NVML em
   * paralelo; o helper aceita 1 request em voo, então as chamadas são
   * serializadas aqui — sem rejeitar a segunda (o tick precisa dos três dados).
   */
  request(job: HwCollectJob, options: { includeGpuEngine?: boolean } = {}): Promise<unknown> {
    if (this.disabled) {
      return Promise.reject(new Error('coletor de hardware desativado nesta sessão'))
    }
    if (this.stopped) {
      return Promise.reject(new Error('coletor de hardware encerrado'))
    }
    return this.enqueue(() => this.send(job, options))
  }

  /** Fecha o stdin (o script sai do loop) e mata à força depois da carência. */
  stop(): void {
    const child = this.child
    const pending = this.pending
    this.stopped = true
    this.child = null
    this.buffer = ''
    this.pending = null

    if (pending) {
      this.clock.clearTimeout(pending.timer)
      pending.reject(new Error('coletor de hardware encerrado'))
    }
    if (!child) return

    let exited = false
    child.on('exit', () => {
      exited = true
      this.clock.clearTimeout(safety)
    })
    const safety = this.clock.setTimeout(() => {
      if (exited) return
      try {
        child.kill()
      } catch {
        // processo já saiu entre o timer e o kill
      }
    }, COLLECT_KILL_GRACE_MS)

    try {
      child.stdin?.write('quit\n')
      child.stdin?.end()
    } catch {
      // pipe já fechado: o kill de segurança cobre o processo
    }
    logger.info('hwmon', 'coletor persistente de hardware encerrado (quit)')
  }

  /** Apenas para testes: esquece filhos/timeout e permite uma nova sessão. */
  reset(): void {
    this.stop()
    this.disabled = false
    this.failures = 0
    this.firstResponsePending = true
    this.nextId = 1
    this.tail = Promise.resolve()
    this.stopped = false
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async send(job: HwCollectJob, options: { includeGpuEngine?: boolean }): Promise<unknown> {
    let child: HwCollectorChild
    try {
      child = await this.ensureStarted()
    } catch (err) {
      this.recordFailure()
      throw err instanceof Error ? err : new Error(String(err))
    }

    const request: HwCollectRequest = { id: this.nextId, job }
    if (options.includeGpuEngine !== undefined) {
      request.includeGpuEngine = options.includeGpuEngine
    }
    this.nextId += 1

    return new Promise<unknown>((resolve, reject) => {
      const timeoutMs = this.firstResponsePending ? COLLECT_FIRST_TIMEOUT_MS : COLLECT_TIMEOUT_MS
      const timer = this.clock.setTimeout(() => {
        this.fail(new Error(`timeout de ${timeoutMs} ms no coletor de hardware`))
      }, timeoutMs)
      this.pending = { id: request.id, timer, resolve, reject }

      if (!child.stdin) {
        this.fail(new Error('stdin do coletor indisponível'))
        return
      }
      try {
        child.stdin.write(`${JSON.stringify(request)}\n`)
      } catch (err) {
        this.fail(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private async ensureStarted(): Promise<HwCollectorChild> {
    if (this.disabled) throw new Error('coletor de hardware desativado nesta sessão')
    if (this.stopped) throw new Error('coletor de hardware encerrado')
    if (this.child) return this.child

    // A compilação do C#/descoberta da DLL acontece fora do timeout do request:
    // o processo só nasce quando os assets (ou a ausência deles) estão prontos.
    const assets = await this.loadAssets().catch(() => null)
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (assets) {
      env.KOLND_HWM_NVML_DLL = assets.dllPath
      env.KOLND_HWM_NVML_ASSEMBLY = assets.assemblyPath
    } else {
      delete env.KOLND_HWM_NVML_DLL
      delete env.KOLND_HWM_NVML_ASSEMBLY
    }

    const child = this.spawnProcess(
      this.powershellPath(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        buildCollectorScript()
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env }
    )

    this.child = child
    this.buffer = ''
    this.firstResponsePending = true

    child.stdout?.setEncoding?.('utf8')
    child.stdout?.on('data', (chunk) => {
      this.appendOutput(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
    })
    // stderr precisa ser drenado para o pipe não encher; a resposta vem pelo
    // prefixo no stdout.
    child.stderr?.on('data', () => undefined)
    child.stdin?.on('error', () => undefined)
    child.on('error', (error) => this.handleChildDown(child, error))
    child.on('exit', () => this.handleChildDown(child))

    logger.info('hwmon', 'coletor persistente de hardware iniciado')
    return child
  }

  private appendOutput(chunk: string): void {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '')
      this.buffer = this.buffer.slice(index + 1)
      this.handleLine(line)
      index = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    const pending = this.pending
    if (!pending) return

    const response = parseCollectorLine(line, pending.id)
    if (!response) return

    this.pending = null
    this.clock.clearTimeout(pending.timer)
    this.failures = 0
    this.firstResponsePending = false
    pending.resolve(response.payload)
  }

  private handleChildDown(child: HwCollectorChild, error?: Error): void {
    if (this.child !== child) return
    this.child = null
    this.buffer = ''

    if (this.stopped) return
    if (this.pending) {
      this.fail(error ?? new Error('coletor de hardware encerrou'))
      return
    }
    this.recordFailure()
  }

  private fail(error: Error): void {
    const pending = this.pending
    this.pending = null
    if (pending) {
      this.clock.clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.recordFailure()
    this.killChild()
  }

  private recordFailure(): void {
    this.failures += 1
    if (this.failures < MAX_CONSECUTIVE_FAILURES || this.disabled) return
    this.disabled = true
    logger.warn(
      'hwmon',
      'coletor persistente falhou 2x seguidas; voltando ao caminho por tick nesta sessão'
    )
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    this.buffer = ''
    if (!child) return
    try {
      child.stdin?.end()
    } catch {
      // pipe já fechado
    }
    try {
      child.kill()
    } catch {
      // processo já saiu
    }
  }
}

let singleton: HwCollector | null = null
let moduleAssetLoader: NvmlAssetLoader | null = null

/**
 * Registra de onde vêm `nvml.dll` e o assembly C#. Fica em `nvml.ts` (dono do
 * C#) para o coletor não importar `electron`/FS nem duplicar o helper.
 */
export function setHwCollectorAssetLoader(loader: NvmlAssetLoader | null): void {
  moduleAssetLoader = loader
}

export function getHwCollector(): HwCollector {
  if (!singleton) singleton = new HwCollector()
  return singleton
}

/** Chamado no `will-quit`: o stdin fecha, o helper sai e um kill cobre o resto. */
export function stopHwCollector(): void {
  singleton?.stop()
}

/** Apenas para testes. */
export function resetHwCollectorForTests(): void {
  singleton?.reset()
  singleton = null
  moduleAssetLoader = null
}
