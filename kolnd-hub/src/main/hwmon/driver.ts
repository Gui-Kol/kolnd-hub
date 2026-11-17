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

const REG_TIMEOUT_MS = 4000

/** Proteções do Windows que impedem o WinRing0 de carregar. */
export interface DriverBlockers {
  hvciEnabled: boolean
  /**
   * `VulnerableDriverBlocklistEnable` — a lista só é aplicada de fato com
   * HVCI, Smart App Control ou S mode ligados (documentação da Microsoft).
   */
  blocklistEnabled: boolean
  /** Smart App Control: desligado, só em avaliação (não bloqueia) ou bloqueando. */
  smartAppControl: 'off' | 'evaluation' | 'enforcing'
}

/** Lê um DWORD da saída do `reg query` (rótulos não são traduzidos). */
export function parseRegDword(output: string, valueName: string): number | null {
  const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(
    `^[ \\t]*${escaped}[ \\t]+REG_DWORD[ \\t]+0x([0-9a-fA-F]+)[ \\t]*\\r?$`,
    'm'
  ).exec(output)
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return Number.isInteger(value) ? value : null
}

async function readRegDword(key: string, valueName: string): Promise<number | null> {
  const result = await runProcess('reg.exe', ['query', key, '/v', valueName], null, REG_TIMEOUT_MS)
  if (result.timedOut || result.code !== 0) return null
  return parseRegDword(result.stdout, valueName)
}

/**
 * Lê as proteções do registro (não exige admin). Falha de leitura vira
 * `false`/`off`: a instalação segue e o erro real do `sc.exe` explica o resto.
 */
export async function detectDriverBlockers(): Promise<DriverBlockers> {
  if (process.platform !== 'win32') {
    return { hvciEnabled: false, blocklistEnabled: false, smartAppControl: 'off' }
  }

  const [hvci, blocklist, sac] = await Promise.all([
    readRegDword(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity',
      'Enabled'
    ),
    readRegDword(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Config',
      'VulnerableDriverBlocklistEnable'
    ),
    readRegDword(
      'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy',
      'VerifiedAndReputablePolicyState'
    )
  ])

  return {
    hvciEnabled: hvci === 1,
    blocklistEnabled: blocklist === 1,
    smartAppControl: sac === 1 ? 'enforcing' : sac === 2 ? 'evaluation' : 'off'
  }
}

/**
 * Explicação acionável quando o PC não deixa o WinRing0 carregar — devolvida
 * ANTES do UAC, para não pedir admin só para falhar. `null` = pode tentar.
 */
export function describeDriverBlockers(blockers: DriverBlockers): string | null {
  // HVCI sem a lista de drivers vulneráveis pode deixar o WinRing0 carregar;
  // nesse caso o erro real do `sc.exe` decide. Com a lista ligada (padrão do
  // Windows 11) o bloqueio é certo.
  if (blockers.hvciEnabled && blockers.blocklistEnabled) {
    return 'A Memória Integrity (HVCI) está ativada com a lista de drivers vulneráveis da Microsoft, que inclui o WinRing0 — o Windows recusa o driver nesse estado. Para usar os sensores avançados: Segurança do Windows → Segurança do dispositivo → Isolamento do núcleo, desligue a Memória Integrity, reinicie o PC e tente de novo. O resto do monitor continua funcionando sem esses campos.'
  }
  if (blockers.smartAppControl === 'enforcing') {
    return 'O Controle de Aplicativos Inteligente (Smart App Control) está ativo e aplica a lista de drivers vulneráveis da Microsoft, que inclui o WinRing0. Não é possível instalar o driver sem desativá-lo. O resto do monitor continua funcionando sem esses campos.'
  }
  return null
}

/** Falha relatada pelo script elevado, gravada em JSON dentro de `%TEMP%`. */
export interface InstallFailure {
  stage: string
  code: number | null
  detail?: string
}

const DRIVER_BLOCKED_HINT =
  'O Windows bloqueou o carregamento do WinRing0 (lista de drivers vulneráveis da Microsoft e/ou assinatura não aceita). Para usar os sensores avançados, desligue a Memória Integrity em Segurança do Windows → Isolamento do núcleo e reinicie o PC.'

/**
 * Converte a falha do script elevado em mensagem para a UI. Pura, exportada
 * para testes: `sc.exe` devolve código 577 (assinatura) ou 1275 (bloqueado)
 * quando a lista de drivers vulneráveis recusa o WinRing0.
 */
export function explainInstallFailure(failure?: InstallFailure | null): string {
  const stage = failure?.stage ?? ''
  const code = failure?.code ?? null
  const detail = (failure?.detail ?? '').replace(/\s+/g, ' ').trim()
  const clipped = detail.length > 200 ? `${detail.slice(0, 200)}…` : detail
  const suffix = clipped ? ` Detalhe do Windows: ${clipped}` : ''
  const codeText = code === null ? '' : ` (código ${code})`

  if (stage === 'hash') {
    return 'O arquivo copiado não confere com o hash esperado. Baixe o driver novamente e tente de novo.'
  }

  if (stage === 'start') {
    if (code === 577 || code === 1275 || /signature|assinatura|blocked|bloqueado/i.test(detail)) {
      return `${DRIVER_BLOCKED_HINT}${suffix}`
    }
    if (code === 5) {
      return `O Windows negou permissão para iniciar o serviço do driver${codeText}. Aceite a solicitação de administrador e tente de novo.${suffix}`
    }
    return `O serviço do driver foi criado, mas o Windows não deixou iniciá-lo${codeText}.${suffix}`
  }

  if (stage === 'create' || stage === 'delete') {
    if (code === 1073) {
      return 'Já existe um serviço com o nome do driver. Reinicie o PC e tente de novo.'
    }
    if (code === 1072) {
      return 'O serviço do driver está marcado para remoção pelo Windows. Reinicie o PC e tente de novo.'
    }
    if (code === 5) {
      return `O Windows negou permissão para preparar o serviço do driver${codeText}. Aceite a solicitação de administrador e tente de novo.${suffix}`
    }
    return `O Windows não deixou preparar o serviço do driver${codeText}.${suffix}`
  }

  if (stage === 'unexpected') {
    return `A instalação falhou antes de chegar ao serviço do driver.${suffix}`
  }

  return `Não foi possível instalar o driver. Verifique a Memória Integrity (HVCI) e a lista de drivers vulneráveis do Windows e tente de novo.${suffix}`
}

/** Script que roda ELEVADO. ASCII puro para o PowerShell 5.1 ler sem ambiguidade. */
export function buildInstallScript(input: {
  sourcePath: string
  targetPath: string
  installDir: string
  /** Onde o script grava a etapa e o código de erro reais (JSON). */
  resultPath: string
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
    `$resultPath = '${psQuote(input.resultPath)}'`,
    `$service = '${psQuote(serviceName)}'`,
    // O processo elevado não herda o console do Hub: sem esse arquivo, a UI só
    // veria "código 1" e chutaria a causa (era o que acontecia com HVCI).
    'function Save-Result([string]$stage, [int]$code, [string]$detail) {',
    '  try {',
    '    $payload = [pscustomobject]@{ stage = $stage; code = $code; detail = $detail }',
    '    $payload | ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8 -Force',
    '  } catch { }',
    '}',
    'try {',
    '  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null',
    '  Copy-Item -LiteralPath $source -Destination $target -Force',
    '  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash',
    `  if ($hash -ne '${expected}') { Save-Result 'hash' 1 ''; exit 1 }`,
    '  $existing = Get-Service -Name $service -ErrorAction SilentlyContinue',
    '  if ($existing) {',
    '    & sc.exe stop $service | Out-Null',
    '    Start-Sleep -Milliseconds 300',
    '    $detail = (& sc.exe delete $service 2>&1 | Out-String).Trim()',
    "    if ($LASTEXITCODE -ne 0) { Save-Result 'delete' $LASTEXITCODE $detail; exit 1 }",
    '  }',
    '  $detail = (& sc.exe create $service type= kernel binPath= $target start= demand 2>&1 | Out-String).Trim()',
    "  if ($LASTEXITCODE -ne 0) { Save-Result 'create' $LASTEXITCODE $detail; exit 1 }",
    '  $detail = (& sc.exe start $service 2>&1 | Out-String).Trim()',
    "  if ($LASTEXITCODE -ne 0) { Save-Result 'start' $LASTEXITCODE $detail; exit 1 }",
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
      const failure = resultPath ? await readInstallFailure(resultPath) : null
      logger.warn(
        'hwmon',
        `instalação do driver falhou: etapa=${failure?.stage ?? '?'} código=${
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
    logger.warn('hwmon', `falha ao elevar para instalar o driver: ${message}`)
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

  // Bloqueio conhecido (HVCI/Smart App Control): não faz sentido pedir UAC para
  // um driver que o Windows vai recusar de qualquer forma.
  const blocked = describeDriverBlockers(await detectDriverBlockers())
  if (blocked) {
    logger.info('hwmon', 'instalação do driver recusada: proteções do Windows ativas')
    return { ok: false, error: blocked }
  }

  const resultPath = join(os.tmpdir(), 'kolnd-hub', `winring0-install-${randomUUID()}.json`)
  const script = buildInstallScript({
    sourcePath: paths.source,
    targetPath: paths.installed,
    installDir: paths.installDir,
    resultPath
  })
  const elevated = await runElevated(script, INSTALL_TIMEOUT_MS, resultPath)
  if (!elevated.ok) {
    return { ok: false, cancelled: elevated.cancelled, error: elevated.error }
  }

  const after = await getDriverStatus()
  if (!after.serviceInstalled) {
    return {
      ok: false,
      state: after.state,
      error:
        'O Windows informou que o driver foi instalado, mas o serviço não aparece. Reinicie o PC e tente de novo.'
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
