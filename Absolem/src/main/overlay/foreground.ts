import { app } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { OverlayBounds } from './geometry'

/**
 * Janela em primeiro plano, com bounds em DIPs.
 *
 * A sonda vive em um único lugar: aqui. A task 07 reutiliza `getForegroundWindow`
 * para saber qual janela capturar e a auditoria usa os mesmos campos.
 *
 * `title` e `processName` são informativos; `bounds` e `pid` alimentam o
 * auto-hide de tela cheia e a exclusão da própria janela do Absolem.
 *
 * `zoomed` diz se a janela está maximizada (`IsZoomed`). Janela maximizada
 * encosta nas bordas do monitor, mas não é tela cheia: com a barra de tarefas
 * visível ela cobre a workArea sem cobrir o monitor inteiro. Opcional para
 * manter compatível quem já monta o objeto em testes.
 */
export interface ForegroundWindow {
  title: string
  processName: string
  pid: number
  bounds: OverlayBounds
  zoomed?: boolean
}

/** Sonda injetável: em teste não há PowerShell nem Windows real. */
export type ForegroundProbe = () => Promise<ForegroundWindow | null>

/** Timeout curto: uma sonda travada nunca pode segurar o auto-hide. */
export const FOREGROUND_TIMEOUT_MS = 1500

/** Tolerância em DIPs ao comparar os bounds com os limites do monitor. */
export const FULLSCREEN_TOLERANCE = 2

/**
 * Script PowerShell gravado uma única vez em `userData/scripts/foreground.ps1`.
 *
 * O processo do PowerShell fica DPI-unaware de propósito: o Windows virtualiza
 * `GetWindowRect` para a escala de 96 DPI, que é o mesmo espaço em DIPs usado
 * por `screen.workArea` e `BrowserWindow.setBounds`. Nada de multiplicar por
 * `scaleFactor` no main.
 */
const FOREGROUND_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AbsolemForeground {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$handle = [AbsolemForeground]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { Write-Output 'null'; exit 0 }
$rect = New-Object AbsolemForeground+RECT
if (-not [AbsolemForeground]::GetWindowRect($handle, [ref]$rect)) { Write-Output 'null'; exit 0 }
$foregroundPid = [uint32]0
[void][AbsolemForeground]::GetWindowThreadProcessId($handle, [ref]$foregroundPid)
$title = New-Object System.Text.StringBuilder 512
[void][AbsolemForeground]::GetWindowText($handle, $title, $title.Capacity)
$process = Get-Process -Id $foregroundPid -ErrorAction SilentlyContinue
$processName = if ($process) { $process.ProcessName } else { '' }
$result = [ordered]@{
  title = $title.ToString()
  processName = $processName
  pid = [int]$foregroundPid
  zoomed = [bool][AbsolemForeground]::IsZoomed($handle)
  bounds = [ordered]@{
    x = [int]$rect.Left
    y = [int]$rect.Top
    width = [int]($rect.Right - $rect.Left)
    height = [int]($rect.Bottom - $rect.Top)
  }
}
$result | ConvertTo-Json -Compress
`

let cachedScriptPath: string | null = null

/**
 * Caminho do script cacheado; cria o diretório e mantém o conteúdo em dia.
 *
 * Perfis antigos já têm um `foreground.ps1` sem `IsZoomed`. Por isso o arquivo
 * existente é relido e regravado quando diverge de `FOREGROUND_SCRIPT`; sem
 * isso o script obsoleto ficaria para sempre e o guard de maximizada nunca
 * receberia o campo `zoomed`.
 */
export function ensureForegroundScript(): string {
  if (cachedScriptPath) return cachedScriptPath
  const scriptsDir = join(app.getPath('userData'), 'scripts')
  const scriptPath = join(scriptsDir, 'foreground.ps1')
  mkdirSync(scriptsDir, { recursive: true })

  let current: string | null = null
  if (existsSync(scriptPath)) {
    try {
      current = readFileSync(scriptPath, 'utf8')
    } catch {
      // Ilegível: cai na regravação abaixo.
      current = null
    }
  }
  if (current !== FOREGROUND_SCRIPT) {
    writeFileSync(scriptPath, FOREGROUND_SCRIPT, 'utf8')
  }

  cachedScriptPath = scriptPath
  return scriptPath
}

/** Hook exclusivo de teste: esquece o caminho cacheado. */
export function resetForegroundScriptCacheForTests(): void {
  cachedScriptPath = null
}

function runPowerShell(scriptPath: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Converte a saída JSON do helper. Qualquer coisa diferente do contrato
 * (`null`, texto vazio, JSON quebrado) devolve `null` — quem chama nunca oculta
 * o overlay por causa de uma leitura ruim.
 */
export function parseForegroundOutput(raw: unknown): ForegroundWindow | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text || text === 'null') return null

  try {
    const parsed = asRecord(JSON.parse(text))
    const bounds = asRecord(parsed.bounds)
    if (!('x' in bounds) || !('y' in bounds) || !('width' in bounds) || !('height' in bounds)) {
      return null
    }
    const x = finite(bounds.x, Number.NaN)
    const y = finite(bounds.y, Number.NaN)
    const width = finite(bounds.width, Number.NaN)
    const height = finite(bounds.height, Number.NaN)
    if (![x, y, width, height].every(Number.isFinite)) return null

    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      processName: typeof parsed.processName === 'string' ? parsed.processName : '',
      pid: finite(parsed.pid, -1),
      // Campo ausente ou inválido = não maximizada: nunca inventa fullscreen.
      zoomed: parsed.zoomed === true,
      bounds: { x, y, width, height }
    }
  } catch {
    return null
  }
}

/** Sonda real. Fora do Windows (ou em falha) devolve `null`, nunca lança. */
export async function defaultForegroundProbe(): Promise<ForegroundWindow | null> {
  if (process.platform !== 'win32') return null
  try {
    const output = await runPowerShell(ensureForegroundScript(), FOREGROUND_TIMEOUT_MS)
    return parseForegroundOutput(output)
  } catch {
    return null
  }
}

/** Ponto único de leitura da janela ativa, com sonda injetável para teste. */
export async function getForegroundWindow(
  probe: ForegroundProbe = defaultForegroundProbe
): Promise<ForegroundWindow | null> {
  try {
    return await probe()
  } catch {
    return null
  }
}

/**
 * A janela cobre o monitor inteiro? (tolerância de 2 DIPs por borda)
 *
 * A comparação é com `display.bounds`, não com `workArea`: uma janela
 * maximizada respeita a barra de tarefas e cobre só a workArea, então não é
 * tela cheia. `zoomed` também descarta o caso antes de comparar bounds.
 */
export function isFullscreenForeground(
  foreground: ForegroundWindow | null,
  monitorBounds: OverlayBounds,
  tolerance: number = FULLSCREEN_TOLERANCE
): boolean {
  if (!foreground) return false
  if (foreground.zoomed === true) return false
  const { bounds } = foreground
  return (
    bounds.x <= monitorBounds.x + tolerance &&
    bounds.y <= monitorBounds.y + tolerance &&
    bounds.x + bounds.width >= monitorBounds.x + monitorBounds.width - tolerance &&
    bounds.y + bounds.height >= monitorBounds.y + monitorBounds.height - tolerance
  )
}

/**
 * Decisão de auto-hide. A própria janela do Absolem nunca conta como tela
 * cheia, mesmo que ocupe a workArea (o overlay é sempre-no-topo).
 */
export function shouldHideForFullscreen(
  foreground: ForegroundWindow | null,
  monitorBounds: OverlayBounds,
  ownPid: number,
  tolerance: number = FULLSCREEN_TOLERANCE
): boolean {
  if (!foreground) return false
  if (ownPid > 0 && foreground.pid === ownPid) return false
  return isFullscreenForeground(foreground, monitorBounds, tolerance)
}
