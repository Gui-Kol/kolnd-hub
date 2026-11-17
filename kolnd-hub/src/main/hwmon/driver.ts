import { app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import * as os from 'os'
import { join } from 'path'
import { logger } from '../logger'
import { runPowerShellCommand, runProcess } from './powershell'
import { probeWinRing0 } from './winring0'
import type { DriverStatus, DriverStatusInfo, InstallDriverResult } from '../../shared/hwmon'

export type { DriverStatus, DriverStatusInfo, InstallDriverResult } from '../../shared/hwmon'

/**
 * Instalação/status do driver WinRing0.
 *
 * Regra inviolável: nada é instalado sem uma ação explícita do usuário. Toda
 * instalação passa por `Start-Process -Verb RunAs` (UAC) e, se o usuário
 * cancelar, o app só mostra uma mensagem amigável — o sistema fica intocado.
 */

export const WINRING0_FILE_NAME = 'WinRing0x64.sys'
export const WINRING0_SERVICE_NAME = 'WinRing0_1_2_0'
export const WINRING0_SHA256 = '11BD2C9F9E2397C9A16E0990E4ED2CF0679498FE0FD418A3DFDAC60B5C160EE5'

const INSTALL_TIMEOUT_MS = 180_000
const SERVICE_QUERY_TIMEOUT_MS = 4000

export interface DriverPaths {
  source: string
  installDir: string
  installed: string
}

/** Caminhos puros (recebem as bases para não depender de Electron nos testes). */
export function resolveDriverPaths(resourcesDir: string, programDataDir: string): DriverPaths {
  const installDir = join(programDataDir, 'Kolnd Hub', 'drivers')
  return {
    source: join(resourcesDir, 'drivers', WINRING0_FILE_NAME),
    installDir,
    installed: join(installDir, WINRING0_FILE_NAME)
  }
}

function resourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
}

function programDataDir(): string {
  return (process.env.ProgramData ?? '').trim() || 'C:\\ProgramData'
}

export function currentDriverPaths(): DriverPaths {
  return resolveDriverPaths(resourcesDir(), programDataDir())
}

/** Estado exibido na UI. `ready` = device abriu de fato. */
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
  expected: string = WINRING0_SHA256
): Promise<boolean> {
  try {
    const buffer = await fs.readFile(path)
    const hash = createHash('sha256').update(buffer).digest('hex')
    return hash.toLowerCase() === expected.toLowerCase()
  } catch {
    return false
  }
}

async function isServiceInstalled(): Promise<boolean> {
  const result = await runProcess(
    'sc.exe',
    ['query', WINRING0_SERVICE_NAME],
    null,
    SERVICE_QUERY_TIMEOUT_MS
  )
  return !result.timedOut && result.code === 0
}

/**
 * Status completo. `filePresent` refere-se ao `.sys` disponível para instalar;
 * `deviceAccessible` só é sondado quando o serviço já existe (evita abrir o
 * helper à toa). Nunca lança.
 */
export async function getDriverStatus(): Promise<DriverStatusInfo> {
  const paths = currentDriverPaths()
  let filePresent = false
  let error: string | undefined

  if (existsSync(paths.source)) {
    filePresent = await verifyDriverHash(paths.source)
    if (!filePresent) {
      error = 'O arquivo do driver não confere com o hash esperado. Baixe-o novamente.'
    }
  }
  // Se só a cópia instalada existe (ex.: build empacotada), ela também vale.
  if (!filePresent && existsSync(paths.installed)) {
    filePresent = await verifyDriverHash(paths.installed)
    if (!filePresent) {
      error = 'O arquivo do driver não confere com o hash esperado. Baixe-o novamente.'
    }
  }

  let serviceInstalled = false
  let deviceAccessible = false

  try {
    if (process.platform === 'win32') {
      serviceInstalled = await isServiceInstalled()
      if (serviceInstalled) deviceAccessible = await probeWinRing0()
    }
  } catch (err) {
    logger.warn('hwmon', `status do driver falhou: ${err instanceof Error ? err.message : err}`)
  }

  return {
    state: classifyDriverState({ filePresent, serviceInstalled, deviceAccessible }),
    filePresent,
    serviceInstalled,
    deviceAccessible,
    sourcePath: paths.source,
    installedPath: paths.installed,
    error
  }
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

/** Script que roda ELEVADO. ASCII puro para o PowerShell 5.1 ler sem ambiguidade. */
export function buildInstallScript(input: {
  sourcePath: string
  targetPath: string
  installDir: string
  serviceName?: string
  expectedSha256?: string
}): string {
  const serviceName = input.serviceName ?? WINRING0_SERVICE_NAME
  const expected = (input.expectedSha256 ?? WINRING0_SHA256).toUpperCase()
  return [
    "$ErrorActionPreference = 'Stop'",
    `$source = '${psQuote(input.sourcePath)}'`,
    `$targetDir = '${psQuote(input.installDir)}'`,
    `$target = '${psQuote(input.targetPath)}'`,
    `$service = '${psQuote(serviceName)}'`,
    'New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    'Copy-Item -LiteralPath $source -Destination $target -Force',
    '$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash',
    `if ($hash -ne '${expected}') { throw 'Hash do driver instalado nao confere.' }`,
    '$existing = Get-Service -Name $service -ErrorAction SilentlyContinue',
    'if ($existing) {',
    '  & sc.exe stop $service | Out-Null',
    '  Start-Sleep -Milliseconds 300',
    '  & sc.exe delete $service | Out-Null',
    '}',
    '& sc.exe create $service type= kernel binPath= $target start= demand | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "sc create falhou ($LASTEXITCODE)" }',
    '& sc.exe start $service | Out-Null',
    'if ($LASTEXITCODE -ne 0) { throw "sc start falhou ($LASTEXITCODE)" }',
    'exit 0'
  ].join('\r\n')
}

export function buildUninstallScript(input: { targetPath: string; serviceName?: string }): string {
  const serviceName = input.serviceName ?? WINRING0_SERVICE_NAME
  return [
    "$ErrorActionPreference = 'Stop'",
    `$target = '${psQuote(input.targetPath)}'`,
    `$service = '${psQuote(serviceName)}'`,
    '$existing = Get-Service -Name $service -ErrorAction SilentlyContinue',
    'if ($existing) {',
    '  & sc.exe stop $service | Out-Null',
    '  Start-Sleep -Milliseconds 300',
    '  & sc.exe delete $service | Out-Null',
    '}',
    'Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue',
    'exit 0'
  ].join('\r\n')
}

interface ElevatedResult {
  ok: boolean
  cancelled: boolean
  error?: string
}

/** Exportado para o helper de FPS reusar a mesma detecção de UAC recusado. */
export function isUacCancelled(text: string): boolean {
  return /0x800704c7|1223|cancel(?:ed|led)?\s+by\s+the\s+user|cancelad[oa]\s+pelo\s+usu[aá]rio/i.test(
    text
  )
}

/** Grava o script em `%TEMP%\kolnd-hub` (UTF-8 com BOM) e roda elevado com -Wait. */
async function runElevated(script: string, timeoutMs: number): Promise<ElevatedResult> {
  const tempDir = join(os.tmpdir(), 'kolnd-hub')
  await fs.mkdir(tempDir, { recursive: true })
  const scriptPath = join(tempDir, `winring0-${randomUUID()}.ps1`)

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
      logger.warn('hwmon', `instalação do driver saiu com código ${result.code}`)
      return {
        ok: false,
        cancelled: false,
        error:
          'Não foi possível instalar o driver. Verifique se a Memória Integrity (HVCI) está desativada e tente novamente.'
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
    logger.warn('hwmon', `falha ao elevar para instalar o driver: ${message}`)
    return {
      ok: false,
      cancelled: false,
      error: 'Não foi possível solicitar permissão de administrador. Tente novamente.'
    }
  } finally {
    await fs.unlink(scriptPath).catch(() => undefined)
  }
}

/**
 * Instala o driver — SEMPRE por clique e SEMPRE com UAC. Recusa instalar se o
 * `.sys` não existir ou não conferir com o hash pinado.
 */
export async function installDriver(): Promise<InstallDriverResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A instalação do driver só é suportada no Windows.' }
  }

  const paths = currentDriverPaths()
  if (!existsSync(paths.source)) {
    return {
      ok: false,
      error:
        'O arquivo do driver não foi encontrado. Em desenvolvimento, rode scripts/fetch-winring0.ps1; em uma instalação, reinstale o Hub.'
    }
  }
  if (!(await verifyDriverHash(paths.source))) {
    return {
      ok: false,
      error: 'O arquivo do driver não confere com o hash esperado. Baixe-o novamente.'
    }
  }

  const before = await getDriverStatus()
  if (before.state === 'ready') {
    return { ok: true, state: 'ready' }
  }

  const script = buildInstallScript({
    sourcePath: paths.source,
    targetPath: paths.installed,
    installDir: paths.installDir
  })
  const elevated = await runElevated(script, INSTALL_TIMEOUT_MS)
  if (!elevated.ok) {
    return { ok: false, cancelled: elevated.cancelled, error: elevated.error }
  }

  const after = await getDriverStatus()
  if (!after.serviceInstalled) {
    return {
      ok: false,
      state: after.state,
      error:
        'O driver foi copiado, mas o serviço não pôde ser criado. Verifique a Memória Integrity (HVCI) e tente novamente.'
    }
  }

  return {
    ok: true,
    state: after.state,
    error:
      after.state === 'ready'
        ? undefined
        : 'O serviço do driver foi instalado, mas o device ainda não abriu. Reinicie o PC e tente novamente.'
  }
}

/** Remoção opcional: para o serviço, apaga o registro e o arquivo instalado. */
export async function uninstallDriver(): Promise<InstallDriverResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'A remoção do driver só é suportada no Windows.' }
  }

  const paths = currentDriverPaths()
  if (!existsSync(paths.installed)) {
    return { ok: true, state: 'absent' }
  }

  const script = buildUninstallScript({ targetPath: paths.installed })
  const elevated = await runElevated(script, INSTALL_TIMEOUT_MS)
  if (!elevated.ok) {
    return { ok: false, cancelled: elevated.cancelled, error: elevated.error }
  }

  return { ok: true, state: (await getDriverStatus()).state }
}
