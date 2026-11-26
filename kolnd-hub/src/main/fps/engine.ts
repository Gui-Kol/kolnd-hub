import { statSync } from 'fs'
import { isAbsolute, join } from 'path'

/**
 * Motor de FPS embarcado (PresentMon 2.6.0, licença MIT).
 *
 * A T0 (26/11/2026) provou o binário x64 avulso sem o MSI/serviço: 980.320
 * bytes, 355,7 linhas/s, 0,894% de um núcleo e latência mediana de 660 ms no
 * stdout. Este módulo é a fronteira do recurso: resolve o exe embutido, confere
 * tamanho/hash e monta o script elevado que estagia a cópia protegida.
 *
 * Regras: o app NUNCA baixa o motor em runtime (só o script de desenvolvimento
 * `scripts/fetch-presentmon.ps1` baixa, antes do empacotamento); cópias
 * elevadas vivem em `%ProgramData%` com ACL aplicada ANTES da cópia e SHA-256
 * do destino conferido.
 */

export const PRESENTMON_VERSION = '2.6.0'
export const PRESENTMON_FILE = `PresentMon-${PRESENTMON_VERSION}-x64.exe`
export const PRESENTMON_SHA256 = 'B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF'
export const PRESENTMON_SIZE = 980_320
export const PRESENTMON_LICENSE = 'MIT'

/**
 * Nome próprio da sessão ETW. `--stop_existing_session` só encerra uma sessão
 * com ESTE nome; nunca use o nome padrão `PresentMon` (mataria uma captura do
 * usuário) nem deixe a sessão antiga `KolndHubFps` viva — a T0 mediu 381 mil
 * eventos perdidos com ela órfã.
 */
export const PRESENTMON_SESSION_NAME = 'KolndHubFpsCapture'
export const PRESENTMON_LEGACY_SESSION_NAME = 'KolndHubFps'

/**
 * Argumentos da captura contínua. `--output_stdout`: a T0 mostrou que
 * `--output_file` trava o arquivo com acesso exclusivo e impede o tail.
 * `--stop_existing_session`: recupera de uma execução anterior morta.
 */
export const PRESENTMON_ARGS = [
  '--v1_metrics',
  '--output_stdout',
  '--no_console_stats',
  '--session_name',
  PRESENTMON_SESSION_NAME,
  '--stop_existing_session'
] as const

/** Versão do script supervisor; entra no `manifest.json` para detectar cópia velha. */
export const FPS_AGENT_SCRIPT_VERSION = 1

/** Caminho do exe embutido: `<resources>/fps/PresentMon-2.6.0-x64.exe`. */
export function resolveBundledPresentMon(resourcesDir: string): string {
  return join(resourcesDir, 'fps', PRESENTMON_FILE)
}

/**
 * `true` somente para um arquivo comum com o tamanho pinado. O hash fica para
 * o staging elevado (ler 980 KB a cada status seria desperdício); o tamanho já
 * barra um download truncado ou um placeholder.
 */
export function isPresentMonBinary(path: string): boolean {
  try {
    const stats = statSync(path)
    return stats.isFile() && stats.size === PRESENTMON_SIZE
  } catch {
    return false
  }
}

function hasUnsafeChars(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
    if (value[index] === '"') return true
  }
  return false
}

/** Caminho absoluto, curto e sem aspas/controle (injeção no script elevado). */
export function isSafePresentMonPath(value: string): boolean {
  return value.length > 0 && value.length <= 1024 && isAbsolute(value) && !hasUnsafeChars(value)
}

function psQuote(value: string): string {
  return value.replace(/'/g, "''")
}

export interface PresentMonStageOptions {
  /** Exe embutido no app (fonte; nunca é executado daqui). */
  sourceExe: string
  /** Raiz `%ProgramData%\Kolnd Hub\capture`. */
  captureDir: string
  /** `...\capture\bin` (cópia protegida do motor). */
  binDir: string
  /** `...\capture\agent` (script supervisor protegido). */
  agentDir: string
  /** `...\capture\bin\PresentMon-2.6.0-x64.exe`. */
  stagedExe: string
  /** `...\capture\manifest.json`. */
  manifestPath: string
  /** ISO da geração do manifest (injetado no teste; o install passa `new Date()`). */
  generatedAt: string
  scriptVersion?: number
  engineVersion?: string
  sha256?: string
  size?: number
}

/**
 * Linhas PowerShell do estágio protegido do motor. A ordem importa e é testada:
 * diretórios → ACL (Administradores/SYSTEM escrevem, Usuários só leem) →
 * remoção da cópia antiga → cópia → hash/tamanho do DESTINO → manifesto.
 *
 * O script roda elevado (UAC único do install). Qualquer divergência apaga a
 * cópia e sai com código 1: nunca fica um binário meio validado em ProgramData.
 */
export function buildStageScript(options: PresentMonStageOptions): string {
  const dirs = [options.captureDir, options.binDir, options.agentDir]
  const paths = [options.sourceExe, options.stagedExe, options.manifestPath]
  if (!dirs.every(isSafePresentMonPath) || !paths.every(isSafePresentMonPath)) {
    throw new Error('Caminho inválido para o estágio do motor de FPS.')
  }
  const engineVersion = options.engineVersion ?? PRESENTMON_VERSION
  const sha256 = (options.sha256 ?? PRESENTMON_SHA256).toUpperCase()
  const size = options.size ?? PRESENTMON_SIZE
  const scriptVersion = options.scriptVersion ?? FPS_AGENT_SCRIPT_VERSION
  if (!Number.isInteger(scriptVersion) || scriptVersion <= 0) {
    throw new Error('Versão do script inválida.')
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(options.generatedAt)) {
    throw new Error('Data de geração inválida.')
  }

  const manifest = JSON.stringify({
    schema: 1,
    engine: { name: 'PresentMon', version: engineVersion, sha256, size },
    scriptVersion,
    generatedAt: options.generatedAt
  })

  const lines: string[] = [
    // `Continue` de propósito: etapas que importam checam Test-Path/$LASTEXITCODE.
    "$ErrorActionPreference = 'Continue'"
  ]

  for (const dir of dirs) {
    lines.push(
      `New-Item -ItemType Directory -Force -Path '${psQuote(dir)}' | Out-Null`,
      `if (-not (Test-Path -LiteralPath '${psQuote(dir)}')) { exit 1 }`,
      // ACL ANTES da cópia: o que entra depois herda as permissões da pasta.
      `& icacls.exe '${psQuote(dir)}' /inheritance:r ` +
        `'/grant' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' /C | Out-Null`
    )
  }

  lines.push(
    // Um arquivo de instalação anterior pode ter ACE `(OI)(CI)` (sem efeito no
    // próprio arquivo) e recusar até o delete elevado; `/reset` devolve a herança.
    `& icacls.exe '${psQuote(options.stagedExe)}' /reset 2>$null | Out-Null`,
    `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(options.stagedExe)}'`,
    `Copy-Item -LiteralPath '${psQuote(options.sourceExe)}' -Destination '${psQuote(
      options.stagedExe
    )}' -Force`,
    `if (-not (Test-Path -LiteralPath '${psQuote(options.stagedExe)}')) { exit 1 }`,
    `if ((Get-Item -LiteralPath '${psQuote(options.stagedExe)}').Length -ne ${size}) { ` +
      `Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(options.stagedExe)}'; exit 1 }`,
    `$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath '${psQuote(
      options.stagedExe
    )}').Hash.ToUpperInvariant()`,
    `if ($hash -ne '${sha256}') { Remove-Item -Force -ErrorAction SilentlyContinue '${psQuote(
      options.stagedExe
    )}'; exit 1 }`,
    // Manifesto UTF-8 sem BOM: o main lê com JSON.parse e compara a versão.
    `[IO.File]::WriteAllText('${psQuote(options.manifestPath)}', '${psQuote(
      manifest
    )}', (New-Object Text.UTF8Encoding($false)))`,
    `if (-not (Test-Path -LiteralPath '${psQuote(options.manifestPath)}')) { exit 1 }`
  )

  return lines.join('\r\n')
}
