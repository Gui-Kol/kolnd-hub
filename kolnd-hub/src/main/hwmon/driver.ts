import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import * as os from 'os'
import { join } from 'path'
import { logger } from '../logger'
import {
  installSensorsAgent,
  missingAgentRegisters,
  readSensorsLatestFile,
  sensorsAgentLatestPath
} from './agent'
import { runPowerShellCommand } from './powershell'
import { currentPawnIoAssets, describePawnIoError, detectPawnIoInstallation } from './pawnio'
import type { DriverStatus, DriverStatusInfo, InstallDriverResult } from '../../shared/hwmon'

export type { DriverStatus, DriverStatusInfo, InstallDriverResult } from '../../shared/hwmon'

/**
 * Instalação/status dos sensores avançados (PawnIO).
 *
 * O driver anterior (OpenLibSys) saiu do projeto: a Memória Integrity (HVCI) do
 * Windows 11 recusa o driver e o Defender o lista como vulnerável. O PawnIO é
 * assinado e instala um driver + módulos assinados; o instalador oficial vem embutido em
 * `resources/pawnio/` e nunca é baixado em runtime.
 *
 * Regra inviolável: nada é instalado sem ação explícita do usuário. O hash do
 * instalador é conferido ANTES de pedir UAC e de novo DENTRO do processo
 * elevado (o arquivo pode ter sido trocado entre os dois passos). O instalador
 * oficial aceita `-install -silent`, descoberto no binário 2.2.0.0; sem modo
 * silencioso confiável a instalação seria interativa.
 */

export const PAWNIO_SETUP_SHA256 =
  '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'
export const PAWNIO_SETUP_SIZE = 3410960

const INSTALL_TIMEOUT_MS = 180_000

/** Instalador embutido em `resources/pawnio` (empacotado ou em dev). */
export function resolveBundledInstaller(resourcesDir: string): string {
  return join(resourcesDir, 'pawnio', 'PawnIO_setup.exe')
}

/** DLL que o PawnIO instala em `%ProgramFiles%\PawnIO`. */
export function resolveInstalledLibrary(installDir: string): string {
  return join(installDir, 'PawnIOLib.dll')
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
}

/** Instalador embutido no pacote atual (deve existir antes de pedir UAC). */
export function bundledInstallerPath(): string {
  return resolveBundledInstaller(resourcesDir())
}

/**
 * Estado exibido na UI. `deviceAccessible` passou a significar "o sink fresco
 * do agente elevado abriu o device": o main roda sem elevação e o
 * `pawnio_open_win32` nega acesso, então sondar o device diretamente daqui
 * sempre daria `false` (erro 5) mesmo com tudo instalado.
 */
export function classifyDriverState(input: {
  filePresent: boolean
  serviceInstalled: boolean
  deviceAccessible: boolean
}): DriverStatus {
  if (input.deviceAccessible) return 'ready'
  if (input.serviceInstalled || input.filePresent) return 'present'
  return 'absent'
}

export async function verifyDriverHash(
  path: string,
  expected: string = PAWNIO_SETUP_SHA256
): Promise<boolean> {
  try {
    const buffer = await fs.readFile(path)
    const hash = createHash('sha256').update(buffer).digest('hex')
    return hash.toLowerCase() === expected.toLowerCase()
  } catch {
    return false
  }
}

/** Hash + tamanho: um byte a mais já invalida o instalador embutido. */
export async function verifyPawnIoInstaller(
  path: string,
  expected: string = PAWNIO_SETUP_SHA256,
  expectedSize: number = PAWNIO_SETUP_SIZE
): Promise<boolean> {
  try {
    const stats = await fs.stat(path)
    if (stats.size !== expectedSize) return false
  } catch {
    return false
  }
  return verifyDriverHash(path, expected)
}

/**
 * Status completo. `filePresent` = `PawnIOLib.dll` presente na instalação;
 * `serviceInstalled` = instalador registrado no Windows; `deviceAccessible` =
 * o **sink do agente elevado** está fresco (< 3 s) e o device abriu.
 *
 * Não chamamos mais `probePawnIo()` aqui: num processo não elevado o PawnIO
 * nega acesso (erro 5) e a sonda sempre falharia. O único sinal honesto de
 * "pronto" é a leitura elevada publicando valores novos. Nunca lança.
 *
 * `outdated` cobre o agente cujo script estagiado é de uma versão anterior do
 * Hub: o sink está fresco, mas não traz todos os registradores que esta versão
 * espera (ex.: os SMN do SVI2). Sem esse sinal, a UI consideraria a leitura
 * "ativa" e não ofereceria como atualizá-la.
 */
export async function getDriverStatus(): Promise<DriverStatusInfo> {
  const assets = currentPawnIoAssets()
  let filePresent = false
  let serviceInstalled = false
  let deviceAccessible = false
  let outdated = false
  let agentError: string | undefined
  let installedPath = join(process.env.ProgramFiles?.trim() || 'C:\\Program Files', 'PawnIO')

  try {
    const installation = await detectPawnIoInstallation()
    filePresent = installation.dllPresent
    serviceInstalled = installation.registered
    installedPath = installation.dllPath

    if (process.platform === 'win32' && installation.dllPresent) {
      const sample = await readSensorsLatestFile(sensorsAgentLatestPath(), Date.now())
      deviceAccessible = sample.fresh && sample.deviceOpen
      if (!deviceAccessible) {
        const detail = describePawnIoError(sample.error)
        agentError =
          detail ??
          'Sensores instalados, mas a leitura elevada não está ativa. Clique em "Instalar sensores avançados" para ativar.'
      } else if (sample.sample) {
        // O vendor vem do PRÓPRIO sink (não do `os.cpus()`): o script assado é
        // que define o que ele lê, e o sink é a prova do que está ativo.
        const missing = missingAgentRegisters(sample.sample, sample.sample.vendor)
        outdated = missing.msr.length > 0 || missing.smn.length > 0
      }
    }
  } catch (err) {
    logger.warn('hwmon', `status do PawnIO falhou: ${err instanceof Error ? err.message : err}`)
  }

  const info: DriverStatusInfo = {
    state: classifyDriverState({ filePresent, serviceInstalled, deviceAccessible }),
    filePresent,
    serviceInstalled,
    deviceAccessible,
    outdated,
    sourcePath: assets.installer,
    installedPath
  }
  if (agentError) info.error = agentError
  return info
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/** Falha relatada pelo script elevado, gravada em JSON dentro de `%TEMP%`. */
export interface InstallFailure {
  stage: string
  code: number | null
  detail?: string
}

/**
 * Converte a falha do script elevado em mensagem para a UI. Pura, exportada
 * para testes. Nada aqui fala de HVCI/blocklist — o PawnIO é assinado; os
 * erros reais são hash, recusa do instalador e registro ausente.
 */
export function explainInstallFailure(failure?: InstallFailure | null): string {
  const stage = failure?.stage ?? ''
  const code = failure?.code ?? null
  const detail = (failure?.detail ?? '').replace(/\s+/g, ' ').trim()
  const clipped = detail.length > 200 ? `${detail.slice(0, 200)}…` : detail
  const suffix = clipped ? ` Detalhe do instalador: ${clipped}` : ''
  const codeText = code === null ? '' : ` (código ${code})`

  if (stage === 'hash') {
    return 'O instalador do PawnIO não confere com o hash esperado. Rode o build de novo (scripts/fetch-pawnio.ps1) e reinstale o Hub.'
  }

  if (stage === 'run') {
    if (code === 1223) {
      return 'A instalação foi cancelada. Nenhuma alteração foi feita no sistema.'
    }
    if (code === 5 || /access is denied|acesso negado/i.test(detail)) {
      return `O Windows negou permissão para instalar o PawnIO${codeText}. Aceite a solicitação de administrador e tente de novo.${suffix}`
    }
    if (/newer installation/i.test(detail)) {
      return `Já existe uma instalação mais nova do PawnIO neste PC. Desinstale-a (Configurações → Aplicativos) e tente de novo.${suffix}`
    }
    return `O instalador do PawnIO terminou com erro${codeText}.${suffix}`
  }

  if (stage === 'verify') {
    return 'O instalador terminou, mas o PawnIO não aparece como instalado. Reinicie o PC e tente de novo.'
  }

  if (stage === 'unexpected') {
    return `A instalação falhou antes de executar o instalador do PawnIO.${suffix}`
  }

  return `Não foi possível instalar o PawnIO. Tente de novo.${suffix}`
}

/**
 * Script que roda ELEVADO. ASCII puro para o PowerShell 5.1 ler sem ambiguidade.
 *
 * O instalador oficial (2.2.0.0) aceita `-install -silent`; sem ele abriria uma
 * janela própria, o que quebraria o fluxo por clique do Hub. O hash é conferido
 * de novo aqui porque o arquivo pode ter sido trocado depois do UAC.
 */
export function buildInstallScript(input: {
  setupPath: string
  /** Onde o script grava a etapa e o código de erro reais (JSON). */
  resultPath: string
  expectedSha256?: string
}): string {
  const expected = (input.expectedSha256 ?? PAWNIO_SETUP_SHA256).toUpperCase()
  return [
    "$ErrorActionPreference = 'Stop'",
    `$setup = '${psQuote(input.setupPath)}'`,
    `$resultPath = '${psQuote(input.resultPath)}'`,
    // O processo elevado não herda o console do Hub: sem esse arquivo, a UI só
    // veria "código 1" e chutaria a causa.
    'function Save-Result([string]$stage, [int]$code, [string]$detail) {',
    '  try {',
    '    $payload = [pscustomobject]@{ stage = $stage; code = $code; detail = $detail }',
    '    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8 -Force',
    '  } catch { }',
    '}',
    'try {',
    '  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash',
    `  if ($hash -ne '${expected}') { Save-Result 'hash' 1 ''; exit 1 }`,
    '  $output = (& $setup -install -silent 2>&1 | Out-String).Trim()',
    '  $code = $LASTEXITCODE',
    "  if ($code -ne 0) { Save-Result 'run' $code $output; exit 1 }",
    "  $key = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO'",
    '  $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue',
    "  if ($null -eq $entry) { Save-Result 'verify' 1 $output; exit 1 }",
    "  Save-Result 'ok' 0 ''",
    '  exit 0',
    '} catch {',
    '  if (-not (Test-Path -LiteralPath $resultPath)) {',
    "    Save-Result 'unexpected' 1 $_.Exception.Message",
    '  }',
    '  exit 1',
    '}'
  ].join('\r\n')
}

export function buildUninstallScript(input: { setupPath: string; resultPath: string }): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$setup = '${psQuote(input.setupPath)}'`,
    `$resultPath = '${psQuote(input.resultPath)}'`,
    'function Save-Result([string]$stage, [int]$code, [string]$detail) {',
    '  try {',
    '    $payload = [pscustomobject]@{ stage = $stage; code = $code; detail = $detail }',
    '    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8 -Force',
    '  } catch { }',
    '}',
    'try {',
    '  $output = (& $setup -uninstall -silent 2>&1 | Out-String).Trim()',
    '  $code = $LASTEXITCODE',
    "  if ($code -ne 0) { Save-Result 'run' $code $output; exit 1 }",
    "  Save-Result 'ok' 0 ''",
    '  exit 0',
    '} catch {',
    "  Save-Result 'unexpected' 1 $_.Exception.Message",
    '  exit 1',
    '}'
  ].join('\r\n')
}

interface ElevatedResult {
  ok: boolean
  cancelled: boolean
  error?: string
}

/** Lê o JSON que o script elevado gravou — nunca lança. */
export async function readInstallFailure(path: string): Promise<InstallFailure | null> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, '').trim())
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    return {
      stage: typeof record.stage === 'string' ? record.stage : 'unknown',
      code: typeof record.code === 'number' && Number.isInteger(record.code) ? record.code : null,
      detail: typeof record.detail === 'string' ? record.detail : undefined
    }
  } catch {
    return null
  }
}

/** Exportado para o helper de FPS reusar a mesma detecção de UAC recusado. */
export function isUacCancelled(text: string): boolean {
  return /0x800704c7|1223|cancel(?:ed|led)?\s+by\s+the\s+user|cancelad[oa]\s+pelo\s+usu[aá]rio/i.test(
    text
  )
}

/** Grava o script em `%TEMP%\kolnd-hub` (UTF-8 com BOM) e roda elevado com -Wait. */
async function runElevated(
  script: string,
  timeoutMs: number,
  resultPath?: string
): Promise<ElevatedResult> {
  const tempDir = join(os.tmpdir(), 'kolnd-hub')
  await fs.mkdir(tempDir, { recursive: true })
  const scriptPath = join(tempDir, `pawnio-${randomUUID()}.ps1`)

  try {
    // BOM garante que o PowerShell 5.1 leia caminhos não-ASCII corretamente.
    await fs.writeFile(scriptPath, '\uFEFF' + script, 'utf8')

    const wrapper = [
      `$p = Start-Process -FilePath 'powershell.exe'`,
      `-ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','${psQuote(scriptPath)}')`,
      '-Verb RunAs -Wait -PassThru',
      'exit $p.ExitCode'
    ].join(' ')

    const result = await runPowerShellCommand(wrapper, timeoutMs)
    const combined = `${result.stdout}\n${result.stderr}`

    if (isUacCancelled(combined)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A instalação foi cancelada. Nenhuma alteração foi feita no sistema.'
      }
    }
    if (result.timedOut) {
      return {
        ok: false,
        cancelled: false,
        error: 'A instalação demorou demais e foi interrompida. Tente novamente.'
      }
    }
    if (result.code !== 0) {
      const failure = resultPath ? await readInstallFailure(resultPath) : null
      logger.warn(
        'hwmon',
        `instalação do PawnIO falhou: etapa=${failure?.stage ?? '?'} código=${
          failure?.code ?? result.code
        } detalhe=${failure?.detail ?? '(sem detalhe)'}`
      )
      return {
        ok: false,
        cancelled: false,
        error: explainInstallFailure(failure)
      }
    }
    return { ok: true, cancelled: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isUacCancelled(message)) {
      return {
        ok: false,
        cancelled: true,
        error: 'A instalação foi cancelada. Nenhuma alteração foi feita no sistema.'
      }
    }
    logger.warn('hwmon', `falha ao elevar para instalar o PawnIO: ${message}`)
    return {
      ok: false,
      cancelled: false,
      error: 'Não foi possível solicitar permissão de administrador. Tente novamente.'
    }
  } finally {
    await fs.unlink(scriptPath).catch(() => undefined)
    if (resultPath) await fs.unlink(resultPath).catch(() => undefined)
  }
}

/**
 * Instala os sensores avançados — SEMPRE por clique e SEMPRE com UAC.
 *
 * Garante as duas metades na mesma ação, de forma idempotente:
 * 1. PawnIO instalado (só roda o instalador se a DLL/registro faltarem);
 * 2. agente elevado ativo (só re-instala se o sink não estiver fresco).
 *
 * Numa máquina nova o PawnIO pede UAC uma vez e o agente pede outra (o PawnIO
 * não assina a tarefa do agente); numa máquina que já tem o PawnIO — o caso
 * desta máquina — é um único UAC. Recusa instalar se o instalador embutido não
 * existir ou não conferir com hash + tamanho pinados.
 */
export async function installDriver(): Promise<InstallDriverResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A instalação do PawnIO só é suportada no Windows.' }
  }

  let status = await getDriverStatus()

  if (!status.serviceInstalled || !status.filePresent) {
    const installer = bundledInstallerPath()
    if (!existsSync(installer)) {
      return {
        ok: false,
        error:
          'O instalador do PawnIO não foi encontrado. Em desenvolvimento, rode scripts/fetch-pawnio.ps1; em uma instalação, reinstale o Hub.'
      }
    }
    if (!(await verifyPawnIoInstaller(installer))) {
      return {
        ok: false,
        error:
          'O instalador do PawnIO não confere com o hash esperado. Rode o build de novo e reinstale o Hub.'
      }
    }

    const resultPath = join(os.tmpdir(), 'kolnd-hub', `pawnio-install-${randomUUID()}.json`)
    const script = buildInstallScript({ setupPath: installer, resultPath })
    const elevated = await runElevated(script, INSTALL_TIMEOUT_MS, resultPath)
    if (!elevated.ok) {
      return { ok: false, cancelled: elevated.cancelled, error: elevated.error }
    }

    status = await getDriverStatus()
    if (!status.serviceInstalled) {
      return {
        ok: false,
        state: status.state,
        error:
          'O instalador do PawnIO terminou, mas o PawnIO não aparece como instalado. Reinicie o PC e tente de novo.'
      }
    }
  }

  // Sink fresco e com todos os registradores = agente já ativo e atualizado;
  // não pede UAC de novo. Desatualizado segue para o re-estágio (1 UAC).
  if (status.deviceAccessible && !status.outdated) {
    return { ok: true, state: status.state }
  }

  const agent = await installSensorsAgent()
  if (!agent.ok) {
    return {
      ok: false,
      cancelled: agent.cancelled,
      state: status.state,
      error: agent.error
    }
  }

  status = await getDriverStatus()
  return {
    ok: true,
    state: status.state,
    error:
      status.state === 'ready'
        ? undefined
        : (status.error ??
          'Sensores instalados, mas a leitura elevada ainda não iniciou. Aguarde alguns segundos e abra a aba de novo.')
  }
}

/** Remoção opcional: usa o desinstalador oficial do PawnIO, também elevado. */
export async function uninstallDriver(): Promise<InstallDriverResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A remoção do PawnIO só é suportada no Windows.' }
  }

  const status = await getDriverStatus()
  if (!status.serviceInstalled && !status.filePresent) {
    return { ok: true, state: 'absent' }
  }

  const installer = bundledInstallerPath()
  if (!existsSync(installer) || !(await verifyPawnIoInstaller(installer))) {
    return {
      ok: false,
      error:
        'O instalador do PawnIO não confere com o hash esperado. Reinstale o Hub e tente de novo.'
    }
  }

  const resultPath = join(os.tmpdir(), 'kolnd-hub', `pawnio-uninstall-${randomUUID()}.json`)
  const script = buildUninstallScript({ setupPath: installer, resultPath })
  const elevated = await runElevated(script, INSTALL_TIMEOUT_MS, resultPath)
  if (!elevated.ok) {
    return { ok: false, cancelled: elevated.cancelled, error: elevated.error }
  }

  return { ok: true, state: (await getDriverStatus()).state }
}
