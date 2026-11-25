import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import * as os from 'os'
import { isAbsolute, join } from 'path'
import { logger } from '../logger'
import { ensureStagedHelper, sha256File } from '../fps/helper'
import { resolveFpsSinkDir } from '../fps/paths'
import { FPS_ETW_SESSION_NAME, FPS_LEGACY_AGENT_TASK_NAME } from '../../shared/fps'
import {
  currentPawnIoAssets,
  detectCpuVendor,
  detectPawnIoInstallation,
  ensurePawnIoHelperAssets,
  moduleForVendor,
  type CpuVendor
} from './pawnio'
import { runPowerShellCommand, runProcess, type ProcessResult } from './powershell'
import { resolvePowershellPath } from './systemPaths'
import type { HwRegisterBatchResult, HwRegisterReader } from './cpuPower'
import {
  MSR_AMD_PACKAGE_ENERGY_STATUS,
  MSR_AMD_RAPL_POWER_UNIT,
  MSR_INTEL_PACKAGE_ENERGY_STATUS,
  MSR_INTEL_PACKAGE_THERM_STATUS,
  MSR_INTEL_PERF_STATUS,
  MSR_INTEL_RAPL_POWER_UNIT,
  MSR_INTEL_TEMPERATURE_TARGET,
  MSR_INTEL_THERM_STATUS,
  SMN_AMD_SVI0_PLANE0_0C,
  SMN_AMD_SVI0_PLANE0_10,
  SMN_AMD_SVI0_TFN,
  SMN_THM_TCON_CUR_TMP
} from './registers'

/**
 * Agente elevado dos sensores avançados.
 *
 * Fato verificado nesta máquina: `pawnio_open_win32` devolve `FALSE` com
 * `GetLastWin32Error() = 5` (acesso negado) num processo comum. O device do
 * PawnIO só abre elevado, então o helper por leitura que o main executava
 * nunca conseguia ler. A solução é a mesma do agente de FPS: UMA tarefa no
 * logon (`KolndHubSensorsAgent`, `schtasks /sc onlogon /rl highest`) roda um
 * PowerShell persistente que abre o device UMA vez e publica
 * `%ProgramData%\Kolnd Hub\sensors\latest.json` a 1 Hz. O Hub apenas LÊ o
 * arquivo, sem privilégio e sem UAC a cada segundo.
 *
 * O JSON carrega os registradores CRUS (MSR/SMN) para o `decodeSmnTemp`/
 * `computePackageWatts` continuarem sendo a única fonte da decodificação. O
 * campo `board` já existe (sempre `null` nesta versão) como ponto de extensão
 * para os sensores da placa na próxima tarefa.
 *
 * Regras: nada é elevado sem clique; instalar/remover abre um UAC explícito.
 * O processo não fica órfão: a remoção grava um arquivo de stop, dá tempo para
 * o loop sair e ainda encerra a tarefa (`schtasks /End`) como rede de segurança.
 */

export const SENSORS_AGENT_TASK_NAME = 'KolndHubSensorsAgent'
export const SENSORS_AGENT_FILE = 'latest.json'
export const SENSORS_AGENT_STOP_FILE = 'stop.flag'
export const SENSORS_AGENT_STALE_MS = 3_000
export const SENSORS_AGENT_INTERVAL_MS = 1_000
/** Subpasta protegida (somente leitura para Usuários) com script + helper. */
export const SENSORS_AGENT_STAGED_DIR = 'agent'
export const SENSORS_AGENT_HELPER_FILE = 'KolndPawnIo.dll'
export const SENSORS_AGENT_SCRIPT_FILE = 'sensors-agent.ps1'
/** Cópia protegida do coletor de FPS dentro da pasta estagiada do agente. */
export const SENSORS_AGENT_FPS_FILE = 'KolndFpsEtw.exe'
/** Arquivo de parada do coletor (o helper aceita `--stop` também no modo sink). */
export const SENSORS_AGENT_FPS_STOP_FILE = 'collector.stop'
const SENSORS_AGENT_MAX_SAMPLE_BYTES = 64 * 1024
const SENSORS_AGENT_UAC_TIMEOUT_MS = 120_000
const SENSORS_AGENT_QUERY_TIMEOUT_MS = 8_000
const SENSORS_AGENT_READY_TIMEOUT_MS = 5_000

// ── Caminhos e comandos (puros, exportados para teste) ─────────

/** `true` quando há aspas/quebra de linha/caractere de controle (injeção). */
function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

function isSafeCommandPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && isAbsolute(value) && !hasUnsafeChars(value)
}

/**
 * Diretório do sink: `KOLDND_HUB_SENSORS_DIR` quando válido (E2E), senão
 * `%ProgramData%\Kolnd Hub\sensors`. Caminho inválido no env é ignorado em vez
 * de derrubar o app.
 */
export function resolveSensorsSinkDir(programDataDir: string, override?: string | null): string {
  const candidate = typeof override === 'string' ? override.trim() : ''
  if (
    candidate &&
    candidate.length <= 1024 &&
    isAbsolute(candidate) &&
    !hasUnsafeChars(candidate)
  ) {
    return candidate
  }
  return join(programDataDir, 'Kolnd Hub', 'sensors')
}

function currentSinkDir(): string {
  return resolveSensorsSinkDir(
    process.env.ProgramData ?? 'C:\\ProgramData',
    process.env.KOLDND_HUB_SENSORS_DIR
  )
}

/** Sink de FPS compartilhado com o Hub (`KOLDND_HUB_FPS_DIR` para o E2E). */
function currentFpsSinkDir(): string {
  return resolveFpsSinkDir(
    process.env.ProgramData ?? 'C:\\ProgramData',
    process.env.KOLDND_HUB_FPS_DIR
  )
}

export function sensorsAgentLatestPath(sinkDir: string = currentSinkDir()): string {
  return join(sinkDir, SENSORS_AGENT_FILE)
}

export function sensorsAgentStopPath(sinkDir: string = currentSinkDir()): string {
  return join(sinkDir, SENSORS_AGENT_STOP_FILE)
}

/** Cópia protegida do coletor de FPS no diretório estagiado do agente. */
export function sensorsAgentFpsHelperPath(sinkDir: string = currentSinkDir()): string {
  return join(sinkDir, SENSORS_AGENT_STAGED_DIR, SENSORS_AGENT_FPS_FILE)
}

/** Caminho do sinal de parada do coletor de FPS. */
export function sensorsAgentFpsStopPath(fpsSinkDir: string): string {
  return join(fpsSinkDir, SENSORS_AGENT_FPS_STOP_FILE)
}

/**
 * `true` quando a cópia protegida do coletor existe e, se houver hash esperado,
 * confere com o `.exe` compilado por esta versão. É o sinal de "agente
 * desatualizado": sem essa cópia o script do agente não inicia o FPS, então a
 * UI precisa oferecer a atualização da leitura elevada.
 */
export async function isFpsCollectorStaged(
  expectedSha256?: string | null,
  sinkDir: string = currentSinkDir()
): Promise<boolean> {
  const path = sensorsAgentFpsHelperPath(sinkDir)
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0) return false
  } catch {
    return false
  }

  const expected = typeof expectedSha256 === 'string' ? expectedSha256.trim().toLowerCase() : ''
  // Sem hash de referência (staging nunca compilado) a presença é o único
  // sinal honesto; não inventamos "desatualizado" sem ter o que comparar.
  if (!/^[a-f0-9]{64}$/.test(expected)) return true

  try {
    const hash = createHash('sha256')
      .update(await fs.readFile(path))
      .digest('hex')
    return hash === expected
  } catch {
    return false
  }
}

function currentVendor(): CpuVendor {
  return detectCpuVendor(os.cpus()[0]?.model)
}

/**
 * Registradores que o agente lê a cada segundo. Esta é a extensão natural
 * para os sensores da placa (Super I/O) da próxima tarefa: eles entram como
 * mais uma fonte no JSON (`board`), sem mudar o protocolo do sink.
 *
 * No AMD os DOIS candidatos do plano 0 do SVI2 (`+0xC` e `+0x10`) entram na
 * lista: qual deles vale depende do modelo, e essa decisão é da decodificação
 * (`cpuVoltage`), não do install. Assim o script assado no agente não varia
 * com a CPU.
 */
export function sensorsAgentRegisters(vendor: CpuVendor): { msr: number[]; smn: number[] } {
  if (vendor === 'amd') {
    return {
      msr: [MSR_AMD_RAPL_POWER_UNIT, MSR_AMD_PACKAGE_ENERGY_STATUS],
      smn: [SMN_THM_TCON_CUR_TMP, SMN_AMD_SVI0_TFN, SMN_AMD_SVI0_PLANE0_0C, SMN_AMD_SVI0_PLANE0_10]
    }
  }
  if (vendor === 'intel') {
    return {
      msr: [
        MSR_INTEL_RAPL_POWER_UNIT,
        MSR_INTEL_PACKAGE_ENERGY_STATUS,
        MSR_INTEL_TEMPERATURE_TARGET,
        MSR_INTEL_PACKAGE_THERM_STATUS,
        MSR_INTEL_THERM_STATUS,
        MSR_INTEL_PERF_STATUS
      ],
      smn: []
    }
  }
  return { msr: [], smn: [] }
}

export interface SensorsAgentTaskOptions {
  /** Script persistente que a tarefa executa no logon. */
  scriptPath: string
  sinkDir: string
  taskName?: string
}

function buildSensorsAgentAction(options: SensorsAgentTaskOptions): string {
  if (!isSafeCommandPath(options.scriptPath)) {
    throw new Error('Caminho inválido para a tarefa de sensores.')
  }
  // A tarefa roda o PowerShell sem janela; o script abre o device uma vez e
  // fica no loop de 1 Hz até o arquivo de stop aparecer.
  //
  // `\"` é o escape que o `schtasks /TR` entende para aspas internas. Com
  // aspas cruas ele corta o valor no primeiro espaço de "Kolnd Hub" e trata o
  // resto como opção ("Argumento/opção inválido"). Testado nesta máquina.
  return `\\"${resolvePowershellPath()}\\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${options.scriptPath}\\"`
}

/** Argumentos de `schtasks /Create` para a tarefa no logon (elevada). */
export function buildSensorsAgentCreateArgs(options: SensorsAgentTaskOptions): string[] {
  return [
    '/Create',
    '/TN',
    options.taskName ?? SENSORS_AGENT_TASK_NAME,
    '/TR',
    buildSensorsAgentAction(options),
    '/SC',
    'ONLOGON',
    '/RL',
    'HIGHEST',
    '/F'
  ]
}

/** Argumentos de `schtasks /Delete`. */
export function buildSensorsAgentDeleteArgs(taskName: string = SENSORS_AGENT_TASK_NAME): string[] {
  return ['/Delete', '/TN', taskName, '/F']
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

function psArgList(values: string[]): string {
  return values.map((value) => `'${psQuote(value)}'`).join(' ')
}

/**
 * Cópia protegida do coletor de FPS que o instalador elevado estagia e o
 * script persistente inicia junto com o loop de sensores.
 */
export interface SensorsAgentFpsCollectorOptions {
  /** `%ProgramData%\Kolnd Hub\fps` — onde o coletor grava `latest.json`. */
  sinkDir: string
  /** `.exe` compilado no userData (origem do Copy-Item). */
  sourceExePath: string
  /** Destino dentro da pasta estagiada (ACL de Usuários: RX). */
  stagedExePath: string
  /** SHA-256 do executável compilado, conferido no destino após a cópia. */
  expectedSha256: string
}

/**
 * Script que roda ELEVADO (UAC único): cria o sink, libera leitura para
 * `Usuários` (S-1-5-32-545), remove um stop antigo e registra + inicia a
 * tarefa no logon com `HIGHEST`. Reiniciar a tarefa (`/End` + `/Run`) é o que
 * torna a instalação idempotente sem duplicar processos.
 */
export interface SensorsAgentInstallOptions extends SensorsAgentTaskOptions {
  stopPath?: string
  /**
   * Cópia protegida em `%ProgramData%` que a tarefa realmente executa. Sem ela
   * a tarefa rodaria um script no perfil do usuário (gravável) — escalada de
   * privilégio no próximo logon. O instalador elevado copia a DLL do helper e
   * o script e só então trava a pasta para `Usuários` (RX).
   */
  stagedDir?: string
  stagedScriptPath?: string
  helperSourcePath?: string
  stagedHelperPath?: string
  /** Coletor de FPS embutido no mesmo agente (uma tarefa, um UAC). */
  fpsCollector?: SensorsAgentFpsCollectorOptions
}

/**
 * Linha que encerra apenas coletores em modo agente (`--sink`), nunca uma
 * medição manual (`--out`) — o instalador/removedor não deve derrubar algo que
 * o usuário iniciou de propósito por outro caminho.
 */
function stopStrayFpsCollectorLine(): string {
  return (
    'Get-CimInstance Win32_Process -Filter "Name=\'KolndFpsEtw.exe\'" ' +
    "-ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*--sink*' } | " +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'
  )
}

export function buildSensorsAgentInstallScript(options: SensorsAgentInstallOptions): string {
  if (!isSafeCommandPath(options.sinkDir)) {
    throw new Error('Diretório do agent de sensores inválido.')
  }
  const stopPath = options.stopPath ?? sensorsAgentStopPath(options.sinkDir)
  const taskName = options.taskName ?? SENSORS_AGENT_TASK_NAME
  const staged =
    options.stagedDir &&
    options.stagedScriptPath &&
    options.helperSourcePath &&
    options.stagedHelperPath &&
    isSafeCommandPath(options.stagedDir) &&
    isSafeCommandPath(options.stagedScriptPath) &&
    isSafeCommandPath(options.helperSourcePath) &&
    isSafeCommandPath(options.stagedHelperPath)
      ? {
          dir: options.stagedDir,
          script: options.stagedScriptPath,
          helperSource: options.helperSourcePath,
          helper: options.stagedHelperPath
        }
      : null
  const taskOptions: SensorsAgentTaskOptions = staged
    ? { ...options, scriptPath: staged.script }
    : options

  // O coletor é opcional na assinatura para manter os testes/fixtures antigas,
  // mas quando informado TODOS os caminhos e o hash precisam estar válidos.
  const fps = options.fpsCollector
  if (fps) {
    const hash = typeof fps.expectedSha256 === 'string' ? fps.expectedSha256.trim() : ''
    if (
      !isSafeCommandPath(fps.sinkDir) ||
      !isSafeCommandPath(fps.sourceExePath) ||
      !isSafeCommandPath(fps.stagedExePath) ||
      !/^[a-f0-9]{64}$/i.test(hash)
    ) {
      throw new Error('Coletor de FPS inválido para o agent de sensores.')
    }
  }

  const lines = [
    // `Continue` de propósito: `/End` numa tarefa ainda inexistente escreve no
    // stderr e, com `Stop`, o PowerShell 5.1 abortaria antes do `/Create`.
    // As etapas que importam checam `$LASTEXITCODE`/`Test-Path` explicitamente.
    "$ErrorActionPreference = 'Continue'"
  ]

  if (fps) {
    lines.push(
      // A tarefa legada do FPS (processo separado) deixa de existir: o coletor
      // agora é filho do agente de sensores.
      `& schtasks.exe /End /TN '${psQuote(FPS_LEGACY_AGENT_TASK_NAME)}' 2>$null | Out-Null`,
      `& schtasks.exe ${psArgList(buildSensorsAgentDeleteArgs(FPS_LEGACY_AGENT_TASK_NAME))} 2>$null | Out-Null`,
      // A pasta do sink existe antes do stop/ACL: `New-Item` de arquivo não
      // cria diretório pai e o `collector.stop` falharia numa instalação limpa.
      `New-Item -ItemType Directory -Force -Path '${psQuote(fps.sinkDir)}' | Out-Null`,
      `if (-not (Test-Path -LiteralPath '${psQuote(fps.sinkDir)}')) { exit 1 }`,
      // Derruba o coletor da instalação anterior antes de trocar o `.exe` (ele
      // fica aberto e impediria o Copy-Item). O `--stop` dá a saída limpa; o
      // kill por CommandLine cobre um processo ainda vivo.
      `New-Item -ItemType File -Force -Path '${psQuote(sensorsAgentFpsStopPath(fps.sinkDir))}' | Out-Null`,
      'Start-Sleep -Milliseconds 400',
      stopStrayFpsCollectorLine(),
      `& icacls.exe '${psQuote(fps.sinkDir)}' /grant '*S-1-5-32-545:(OI)(CI)RX' /T /C | Out-Null`,
      `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(
        join(fps.sinkDir, 'latest.json')
      )}'`,
      `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(
        join(fps.sinkDir, 'latest.json.tmp')
      )}'`
    )
  }

  lines.push(
    `New-Item -ItemType Directory -Force -Path '${psQuote(options.sinkDir)}' | Out-Null`,
    `if (-not (Test-Path -LiteralPath '${psQuote(options.sinkDir)}')) { exit 1 }`,
    `& icacls.exe '${psQuote(options.sinkDir)}' /grant '*S-1-5-32-545:(OI)(CI)RX' /T /C | Out-Null`
  )
  if (staged) {
    lines.push(
      `New-Item -ItemType Directory -Force -Path '${psQuote(staged.dir)}' | Out-Null`,
      `if (-not (Test-Path -LiteralPath '${psQuote(staged.dir)}')) { exit 1 }`,
      // Primeiro trava a PASTA (sem /T): escrita só para Administradores/
      // SYSTEM, leitura para Usuários. Aplicar `/T` com ACEs `(OI)(CI)` em
      // arquivos já existentes os deixaria inacessíveis até para o admin.
      `& icacls.exe '${psQuote(staged.dir)}' /inheritance:r ` +
        `'/grant' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /C | Out-Null`,
      // Recria as cópias para herdarem a ACL efetiva da pasta. Um arquivo de
      // uma instalação antiga pode ter ACE `(OI)(CI)` (sem efeito no próprio
      // arquivo) e recusar até o delete elevado; `/reset` devolve a herança.
      `& icacls.exe '${psQuote(staged.helper)}' /reset 2>$null | Out-Null`,
      `& icacls.exe '${psQuote(staged.script)}' /reset 2>$null | Out-Null`,
      `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(staged.helper)}'`,
      `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(staged.script)}'`,
      `Copy-Item -LiteralPath '${psQuote(staged.helperSource)}' -Destination '${psQuote(staged.helper)}' -Force`,
      `if (-not (Test-Path -LiteralPath '${psQuote(staged.helper)}')) { exit 1 }`,
      `Copy-Item -LiteralPath '${psQuote(options.scriptPath)}' -Destination '${psQuote(staged.script)}' -Force`,
      `if (-not (Test-Path -LiteralPath '${psQuote(staged.script)}')) { exit 1 }`
    )
    if (fps) {
      lines.push(
        // Mesmo padrão do helper de FPS: a cópia nasce sob a ACL da pasta e o
        // SHA-256 é conferido no DESTINO — origem trocada não passa.
        `& icacls.exe '${psQuote(fps.stagedExePath)}' /reset 2>$null | Out-Null`,
        `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(fps.stagedExePath)}'`,
        `Copy-Item -LiteralPath '${psQuote(fps.sourceExePath)}' -Destination '${psQuote(
          fps.stagedExePath
        )}' -Force`,
        `if (-not (Test-Path -LiteralPath '${psQuote(fps.stagedExePath)}')) { exit 1 }`,
        `$fpsHash = (Get-FileHash -LiteralPath '${psQuote(
          fps.stagedExePath
        )}' -Algorithm SHA256).Hash.ToLowerInvariant()`,
        `if ($fpsHash -ne '${fps.expectedSha256.toLowerCase()}') {`,
        `  Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(fps.stagedExePath)}'`,
        "  throw 'O coletor de FPS nao confere com o hash esperado.'",
        '}'
      )
    }
  }
  lines.push(
    // Sem o latest antigo, o `waitForSink` só considera a instância nova e a
    // UI nunca exibe por um instante valores da sessão anterior.
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(sensorsAgentLatestPath(options.sinkDir))}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(stopPath)}'`,
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    `& schtasks.exe ${psArgList(buildSensorsAgentCreateArgs(taskOptions))}`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    `& schtasks.exe /Run /TN '${psQuote(taskName)}'`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    'exit 0'
  )
  return lines.join('\r\n')
}

/** Script elevado de remoção: stop, tempo para sair, `/End` como garantia e limpeza. */
export function buildSensorsAgentRemoveScript(
  sinkDir: string,
  taskName: string = SENSORS_AGENT_TASK_NAME,
  fpsSinkDir: string = currentFpsSinkDir()
): string {
  if (!isSafeCommandPath(sinkDir) || !isSafeCommandPath(fpsSinkDir)) {
    throw new Error('Diretório do agent de sensores inválido.')
  }
  const latest = sensorsAgentLatestPath(sinkDir)
  const stop = sensorsAgentStopPath(sinkDir)
  const stagedDir = join(sinkDir, SENSORS_AGENT_STAGED_DIR)
  const fpsStop = sensorsAgentFpsStopPath(fpsSinkDir)
  const fpsLatest = join(fpsSinkDir, 'latest.json')
  return [
    "$ErrorActionPreference = 'Continue'",
    `New-Item -ItemType File -Force -Path '${psQuote(stop)}' | Out-Null`,
    // O coletor de FPS sai pelo próprio stop; o kill por CommandLine cobre o
    // caso de `/End` ter matado o agente antes do bloco `finally` rodar. A
    // pasta pode não existir (agente antigo sem coletor), então só cria o stop
    // quando ela está lá.
    `if (Test-Path -LiteralPath '${psQuote(fpsSinkDir)}') { New-Item -ItemType File -Force -Path '${psQuote(fpsStop)}' | Out-Null }`,
    'Start-Sleep -Milliseconds 1500',
    `& schtasks.exe /End /TN '${psQuote(taskName)}' 2>$null | Out-Null`,
    `& schtasks.exe ${psArgList(buildSensorsAgentDeleteArgs(taskName))}`,
    'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }',
    // Tarefa legada do FPS: se ainda existir, também é encerrada e apagada.
    `& schtasks.exe /End /TN '${psQuote(FPS_LEGACY_AGENT_TASK_NAME)}' 2>$null | Out-Null`,
    `& schtasks.exe ${psArgList(
      buildSensorsAgentDeleteArgs(FPS_LEGACY_AGENT_TASK_NAME)
    )} 2>$null | Out-Null`,
    stopStrayFpsCollectorLine(),
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(latest)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(`${latest}.tmp`)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(stop)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(fpsLatest)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(`${fpsLatest}.tmp`)}'`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(fpsStop)}'`,
    `Remove-Item -Recurse -Force -ErrorAction SilentlyContinue '${psQuote(stagedDir)}'`,
    'exit 0'
  ].join('\r\n')
}

/** Comando que PEDE O UAC e espera o processo elevado terminar. */
export function buildSensorsAgentElevationCommand(scriptPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$p = Start-Process -FilePath 'powershell.exe' ` +
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${psQuote(
        scriptPath
      )}') -Verb RunAs -Wait -PassThru`,
    'exit $p.ExitCode'
  ].join('; ')
}

/**
 * Interpreta `schtasks /Query`. `true` = tarefa existe, `false` = não existe,
 * `null` = não deu para saber (timeout/erro inesperado).
 */
export function interpretSensorsAgentQuery(
  result: ProcessResult,
  taskName: string = SENSORS_AGENT_TASK_NAME
): boolean | null {
  if (result.timedOut) return null
  const output = `${result.stdout}\n${result.stderr}`
  if (result.code === 0) {
    const escaped = taskName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`TaskName:\\s*\\\\?${escaped}`, 'i').test(output) ? true : null
  }
  if (
    /cannot find|does not exist|n[ãa]o (?:é|e|foi )?poss[íi]vel encontrar|n[ãa]o pode (?:ser )?encontrar|n[ãa]o existe/i.test(
      output
    )
  ) {
    return false
  }
  return null
}

/** Script persistente (ASCII não é exigido: caminhos do usuário podem ter acento). */
export function buildSensorsAgentScript(input: {
  /** Assembly do helper (Add-Type); NÃO é a PawnIOLib. */
  helperDllPath: string
  /** `PawnIOLib.dll` instalada que o helper abre via LoadLibrary. */
  pawnIoDllPath: string
  modulePath: string
  vendor: CpuVendor
  sinkPath: string
  stopPath: string
  msr: number[]
  smn: number[]
  intervalMs?: number
  /**
   * Coletor de FPS que vive como filho do agente. Opcional para manter
   * fixtures antigas, mas o instalador real sempre informa a cópia protegida.
   */
  fpsCollector?: { exePath: string; sinkDir: string; stopPath?: string }
}): string {
  if (
    !isSafeCommandPath(input.helperDllPath) ||
    !isSafeCommandPath(input.pawnIoDllPath) ||
    !isSafeCommandPath(input.modulePath)
  ) {
    throw new Error('Caminho inválido para o agente de sensores.')
  }
  if (!isSafeCommandPath(input.sinkPath) || !isSafeCommandPath(input.stopPath)) {
    throw new Error('Caminho do sink de sensores inválido.')
  }
  const fps = input.fpsCollector
  if (
    fps &&
    (!isSafeCommandPath(fps.exePath) ||
      !isSafeCommandPath(fps.sinkDir) ||
      (fps.stopPath !== undefined && !isSafeCommandPath(fps.stopPath)))
  ) {
    throw new Error('Caminho do coletor de FPS inválido.')
  }
  const fpsStop = fps ? (fps.stopPath ?? sensorsAgentFpsStopPath(fps.sinkDir)) : null
  const interval =
    Number.isInteger(input.intervalMs) && (input.intervalMs ?? 0) > 0
      ? (input.intervalMs as number)
      : SENSORS_AGENT_INTERVAL_MS

  const lines = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    `$helper = '${psQuote(input.helperDllPath)}'`,
    `$dll = '${psQuote(input.pawnIoDllPath)}'`,
    `$module = '${psQuote(input.modulePath)}'`,
    `$sink = '${psQuote(input.sinkPath)}'`,
    `$stop = '${psQuote(input.stopPath)}'`,
    `$msr = '${input.msr.join(',')}'`,
    `$smn = '${input.smn.join(',')}'`
  ]

  if (fps && fpsStop) {
    lines.push(
      `$fpsExe = '${psQuote(fps.exePath)}'`,
      `$fpsSink = '${psQuote(fps.sinkDir)}'`,
      `$fpsStop = '${psQuote(fpsStop)}'`,
      '$fps = $null',
      'try {',
      '  if (Test-Path -LiteralPath $fpsExe) {',
      '    Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $fpsStop',
      // As aspas internas são necessárias: o Start-Process junta o
      // ArgumentList sem citar sozinho e o sink tem espaço no caminho.
      `    $fpsArgs = '--sink "' + $fpsSink + '" --stop "' + $fpsStop + '" --minutes 0 --session ${FPS_ETW_SESSION_NAME}'`,
      '    $fps = Start-Process -FilePath $fpsExe -ArgumentList $fpsArgs -WindowStyle Hidden -PassThru',
      '  }',
      '} catch {',
      '  $fps = $null',
      '}'
    )
  }

  lines.push(
    'try {',
    '  Add-Type -Path $helper',
    `  [KolndPawnIo]::RunAgent($dll, $module, '${input.vendor}', $msr, $smn, $sink, $stop, ${interval})`,
    '} catch {',
    '  # Falha antes do loop (Add-Type/DLL): deixa um heartbeat explicável.',
    "  $stamp = (Get-Date).ToUniversalTime().ToString('o')",
    `  $json = '{"timestamp":"' + $stamp + '","vendor":"${input.vendor}","deviceOpen":false,"msr":[],"smn":[],"board":null,"error":"agent|0|helper nao iniciou"}'`,
    '  try { [IO.File]::WriteAllText($sink, $json) } catch { }'
  )

  if (fps) {
    lines.push(
      '} finally {',
      '  # O coletor é filho do agente: parar/remover o agente não deixa órfão.',
      '  if ($null -ne $fps) {',
      "    try { [IO.File]::WriteAllText($fpsStop, 'agent-stop') } catch { }",
      '    try {',
      '      if (-not $fps.HasExited) { $null = $fps.WaitForExit(3000) }',
      '      if (-not $fps.HasExited) { Stop-Process -Id $fps.Id -Force -ErrorAction SilentlyContinue }',
      '    } catch { }',
      '  }'
    )
  }
  lines.push('}', 'exit 0')
  return lines.join('\r\n')
}

// ── Sink `latest.json` (puro, exportado para teste) ─────────────

export interface SensorsAgentRegisterEntry {
  index: number
  value: bigint | null
}

export interface SensorsAgentSample {
  timestamp: string
  capturedAtMs: number
  vendor: CpuVendor | null
  deviceOpen: boolean
  msr: SensorsAgentRegisterEntry[]
  smn: SensorsAgentRegisterEntry[]
  /** Extensão para os sensores da placa; `null` nesta versão. */
  board: null
}

export interface ParsedSensorsLatest {
  /** Arquivo existe, parseou e o timestamp está dentro de 3 s. */
  fresh: boolean
  deviceOpen: boolean
  sample: SensorsAgentSample | null
  capturedAtMs: number | null
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toUnsigned(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    try {
      return BigInt(value.trim())
    } catch {
      return null
    }
  }
  return null
}

function toVendor(value: unknown): CpuVendor | null {
  return value === 'amd' || value === 'intel' || value === 'other' ? value : null
}

function parseEntries(raw: unknown): SensorsAgentRegisterEntry[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const entries: SensorsAgentRegisterEntry[] = []
  for (const entry of list) {
    if (!isRecord(entry)) continue
    const index = toUnsigned(entry.index)
    if (index === null) continue
    entries.push({ index, value: toBigInt(entry.value) })
  }
  return entries
}

/**
 * Valida o sink do agente. O main não confia no arquivo: timestamp inválido ou
 * velho (> 3 s) invalida a amostra; campos desconhecidos são ignorados.
 */
export function parseSensorsLatest(input: unknown, nowMs: number): ParsedSensorsLatest {
  const empty: ParsedSensorsLatest = {
    fresh: false,
    deviceOpen: false,
    sample: null,
    capturedAtMs: null
  }
  if (!isRecord(input) || typeof input.timestamp !== 'string') return empty
  const capturedAtMs = Date.parse(input.timestamp)
  if (!Number.isFinite(capturedAtMs)) return empty
  // Toleramos até 5 s no futuro (clock/arredondamento); velho/ausente é stale.
  const age = nowMs - capturedAtMs
  if (age > SENSORS_AGENT_STALE_MS || age < -5_000) return empty

  const deviceOpen = input.deviceOpen === true
  const vendor = toVendor(input.vendor)
  const error =
    typeof input.error === 'string' && input.error.trim() ? input.error.trim() : undefined
  const sample: SensorsAgentSample = {
    timestamp: input.timestamp,
    capturedAtMs,
    vendor,
    deviceOpen,
    msr: parseEntries(input.msr),
    smn: parseEntries(input.smn),
    board: null
  }
  return { fresh: true, deviceOpen, sample, capturedAtMs, error }
}

/**
 * Registradores que o sink deveria trazer mas não traz — base da detecção de
 * agente desatualizado. A presença é conferida PELO ÍNDICE: uma entrada com
 * `value: null` conta como presente (a leitura falhou, mas o script já pede o
 * registrador). Amostra ou vendor ausente = `{ msr: [], smn: [] }` (não dá para
 * classificar como desatualizado sem saber o que esperar).
 */
export function missingAgentRegisters(
  sample: SensorsAgentSample | null,
  vendor: CpuVendor | null
): { msr: number[]; smn: number[] } {
  if (!sample || !vendor) return { msr: [], smn: [] }
  const expected = sensorsAgentRegisters(vendor)
  const msrPresent = new Set(sample.msr.map((entry) => entry.index))
  const smnPresent = new Set(sample.smn.map((entry) => entry.index))
  return {
    msr: expected.msr.filter((index) => !msrPresent.has(index)),
    smn: expected.smn.filter((index) => !smnPresent.has(index))
  }
}

/** Lê e valida o `latest.json`; arquivo ausente/ilegível = stale. */
export async function readSensorsLatestFile(
  path: string,
  nowMs: number
): Promise<ParsedSensorsLatest> {
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile() || stat.size <= 0 || stat.size > SENSORS_AGENT_MAX_SAMPLE_BYTES) {
      return { fresh: false, deviceOpen: false, sample: null, capturedAtMs: null }
    }
    const text = (await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, '')
    return parseSensorsLatest(JSON.parse(text) as unknown, nowMs)
  } catch {
    return { fresh: false, deviceOpen: false, sample: null, capturedAtMs: null }
  }
}

/**
 * Leitor padrão do `cpuPower`: traduz o sink em um `HwRegisterBatchResult`
 * alinhado com o pedido. Sink stale/vazio = device indisponível, com motivo em
 * pt-BR — nunca um número inventado.
 */
export function createSensorsAgentReader(): HwRegisterReader {
  return {
    async readBatch({ msr, smn }) {
      const msrIndices = msr ?? []
      const smnIndices = smn ?? []
      const parsed = await readSensorsLatestFile(sensorsAgentLatestPath(), Date.now())
      const pick = (
        indices: ReadonlyArray<number>,
        entries: ReadonlyArray<SensorsAgentRegisterEntry>
      ): Array<bigint | null> =>
        indices.map((index) => entries.find((entry) => entry.index === index)?.value ?? null)

      if (!parsed.fresh || !parsed.sample) {
        const result: HwRegisterBatchResult = {
          available: false,
          msr: msrIndices.map(() => null),
          smn: smnIndices.map(() => null),
          error: 'A leitura elevada dos sensores não está ativa.'
        }
        return result
      }
      if (!parsed.deviceOpen) {
        return {
          available: false,
          msr: msrIndices.map(() => null),
          smn: smnIndices.map(() => null),
          error: parsed.error ?? 'A leitura elevada não conseguiu abrir o PawnIO.'
        }
      }
      return {
        available: true,
        msr: pick(msrIndices, parsed.sample.msr),
        smn: pick(smnIndices, parsed.sample.smn),
        error: parsed.error
      }
    }
  }
}

// ── Instalação/remoção (clique + UAC explícito) ────────────────

export interface SensorsAgentActionResult {
  ok: boolean
  cancelled?: boolean
  error?: string
}

let installing = false
let removing = false

/** `true` quando o sink está fresco e o device abriu (leitura elevada ativa). */
export async function isSensorsAgentActive(nowMs: number = Date.now()): Promise<boolean> {
  const parsed = await readSensorsLatestFile(sensorsAgentLatestPath(), nowMs)
  return parsed.fresh && parsed.deviceOpen
}

/** Consulta a tarefa no Windows sem elevação. `null` = não deu para saber. */
export async function isSensorsAgentInstalled(): Promise<boolean | null> {
  if (process.platform !== 'win32') return false
  const result = await runProcess(
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'schtasks.exe'),
    ['/Query', '/TN', SENSORS_AGENT_TASK_NAME, '/FO', 'LIST'],
    null,
    SENSORS_AGENT_QUERY_TIMEOUT_MS
  )
  return interpretSensorsAgentQuery(result)
}

async function runElevated(script: string, scriptPath: string): Promise<ProcessResult> {
  await fs.writeFile(scriptPath, `\uFEFF${script}`, 'utf8')
  return runPowerShellCommand(
    buildSensorsAgentElevationCommand(scriptPath),
    SENSORS_AGENT_UAC_TIMEOUT_MS
  )
}

/** Espera o sink ficar fresco depois de iniciar a tarefa (até ~5 s). */
async function waitForSink(): Promise<boolean> {
  const deadline = Date.now() + SENSORS_AGENT_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isSensorsAgentActive()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

/**
 * Instala o agente (UAC único explícito). Idempotente: reescreve o script,
 * reinicia a tarefa e espera o sink ficar fresco. Nunca lança.
 */
export async function installSensorsAgent(): Promise<SensorsAgentActionResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'O agente de sensores só é suportado no Windows.' }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.' }
  }

  installing = true
  try {
    const vendor = currentVendor()
    const module = moduleForVendor(vendor)
    if (!module) {
      return {
        ok: false,
        error: 'A CPU deste PC não foi reconhecida como AMD ou Intel; não há sensores para ativar.'
      }
    }
    const installation = await detectPawnIoInstallation()
    if (!installation.dllPresent) {
      return {
        ok: false,
        error: 'O PawnIO não está instalado. Instale os sensores avançados e tente de novo.'
      }
    }

    const assets = await ensurePawnIoHelperAssets()
    const manifest = currentPawnIoAssets()
    const modulePath = module === 'IntelMSR' ? manifest.intelModule : manifest.amdModule
    const registers = sensorsAgentRegisters(vendor)
    const sinkDir = currentSinkDir()
    const sinkPath = sensorsAgentLatestPath(sinkDir)
    const stopPath = sensorsAgentStopPath(sinkDir)
    // A tarefa elevada executa a cópia em ProgramData (ACL de leitura para
    // Usuários); o script intermediário no perfil serve só de fonte para o
    // instalador copiar.
    const stagedDir = join(sinkDir, SENSORS_AGENT_STAGED_DIR)
    const stagedHelperPath = join(stagedDir, SENSORS_AGENT_HELPER_FILE)
    const stagedScriptPath = join(stagedDir, SENSORS_AGENT_SCRIPT_FILE)

    // O coletor de FPS é filho do mesmo agente: uma tarefa no logon, um UAC.
    // A compilação acontece no userData e o instalador elevado copia a versão
    // conferida por SHA-256 para a pasta protegida.
    //
    // BEST-EFFORT: uma falha do FPS não pode impedir a instalação dos sensores
    // (antes da tarefa os dois caminhos eram independentes). Sem a cópia, o
    // script/instalador seguem sem `fpsCollector` e o resultado é `ok:true` com
    // um aviso não fatal em `error`, igual ao aviso de sink não fresco.
    const fpsSinkDir = currentFpsSinkDir()
    const stagedFpsPath = sensorsAgentFpsHelperPath(sinkDir)
    let fpsCollector: SensorsAgentFpsCollectorOptions | undefined
    let fpsWarning: string | undefined
    try {
      const staged = await ensureStagedHelper()
      fpsCollector = {
        sinkDir: fpsSinkDir,
        sourceExePath: staged.stagingExePath,
        stagedExePath: stagedFpsPath,
        expectedSha256: await sha256File(staged.stagingExePath)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('hwmon', `agente seguirá sem o coletor de FPS: ${message}`)
      fpsCollector = undefined
      fpsWarning =
        'A leitura elevada foi instalada, mas o coletor de FPS não pôde ser preparado. O FPS continuará indisponível; clique em "Atualizar leitura elevada" para tentar de novo.'
    }

    const agentScript = buildSensorsAgentScript({
      helperDllPath: stagedHelperPath,
      pawnIoDllPath: installation.dllPath,
      modulePath,
      vendor,
      sinkPath,
      stopPath,
      msr: registers.msr,
      smn: registers.smn,
      ...(fpsCollector
        ? {
            fpsCollector: {
              exePath: stagedFpsPath,
              sinkDir: fpsSinkDir,
              stopPath: sensorsAgentFpsStopPath(fpsSinkDir)
            }
          }
        : {})
    })
    const agentScriptPath = join(assets.dir, SENSORS_AGENT_SCRIPT_FILE)
    await fs.writeFile(agentScriptPath, `\uFEFF${agentScript}`, 'utf8')

    const installScript = buildSensorsAgentInstallScript({
      scriptPath: agentScriptPath,
      sinkDir,
      stopPath,
      stagedDir,
      stagedScriptPath,
      helperSourcePath: assets.dllPath,
      stagedHelperPath,
      fpsCollector
    })
    const installScriptPath = join(assets.dir, 'sensors-agent-install.ps1')
    const result = await runElevated(installScript, installScriptPath)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelledText(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
      }
    }
    if (result.timedOut) {
      return { ok: false, error: 'A ativação demorou demais para responder. Tente novamente.' }
    }
    if (result.code !== 0) {
      const detail = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      logger.warn(
        'hwmon',
        `instalação do agent de sensores falhou (código ${result.code})${detail ? `: ${detail}` : ''}`
      )
      return { ok: false, error: 'Não foi possível agendar a leitura elevada dos sensores.' }
    }

    const fresh = await waitForSink()
    const warnings: string[] = []
    if (fpsWarning) warnings.push(fpsWarning)
    if (!fresh) {
      warnings.push(
        'A tarefa foi instalada, mas o sink ainda não está fresco. Aguarde alguns segundos e abra a aba de novo.'
      )
    }
    if (warnings.length > 0) return { ok: true, error: warnings.join(' ') }
    logger.info('hwmon', `tarefa ${SENSORS_AGENT_TASK_NAME} ativa (sink ${sinkDir})`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('hwmon', `falha ao instalar o agent de sensores: ${message}`)
    return { ok: false, error: 'Não foi possível ativar a leitura elevada dos sensores.' }
  } finally {
    installing = false
  }
}

/**
 * Remove o agente (UAC explícito). Grava o stop, dá tempo do loop sair e ainda
 * encerra/apaga a tarefa — sem processo órfão.
 */
export async function removeSensorsAgent(): Promise<SensorsAgentActionResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'O agente de sensores só é suportado no Windows.' }
  }
  if (installing || removing) {
    return { ok: false, error: 'Já existe uma operação em andamento.' }
  }

  removing = true
  try {
    const assets = await ensurePawnIoHelperAssets()
    const sinkDir = currentSinkDir()
    const script = buildSensorsAgentRemoveScript(
      sinkDir,
      SENSORS_AGENT_TASK_NAME,
      currentFpsSinkDir()
    )
    const scriptPath = join(assets.dir, 'sensors-agent-remove.ps1')
    const result = await runElevated(script, scriptPath)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelledText(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A permissão de administrador não foi concedida. Nada foi alterado.'
      }
    }
    if (result.timedOut || result.code !== 0) {
      logger.warn(
        'hwmon',
        `remoção do agent de sensores falhou (código ${result.code ?? 'timeout'})`
      )
      return { ok: false, error: 'Não foi possível remover a leitura elevada dos sensores.' }
    }
    logger.info('hwmon', `tarefa ${SENSORS_AGENT_TASK_NAME} removida`)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('hwmon', `falha ao remover o agent de sensores: ${message}`)
    return { ok: false, error: 'Não foi possível remover a leitura elevada dos sensores.' }
  } finally {
    removing = false
  }
}

/**
 * Detecção de UAC recusado sem importar `driver.ts` (evita ciclo
 * driver → agent → driver). Mesmos textos que o helper de FPS reconhece.
 */
function isUacCancelledText(text: string): boolean {
  return /0x800704c7|1223|cancel(?:ed|led)?\s+by\s+the\s+user|cancelad[oa]\s+pelo\s+usu[aá]rio/i.test(
    text
  )
}

/** Apenas para testes: zera os guardas de operação. */
export function resetSensorsAgentForTests(): void {
  installing = false
  removing = false
}
