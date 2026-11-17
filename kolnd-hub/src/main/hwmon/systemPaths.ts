import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Caminhos de binários do Windows usados pelo monitor (devem existir em
 * qualquer instalação pt-BR/en-US — o caminho é do sistema, não localizado).
 */

export function windowsRoot(): string {
  return (process.env.SystemRoot ?? '').trim() || 'C:\\Windows'
}

/** `C:\Windows\System32\nvidia-smi.exe` quando existir; senão confia no PATH. */
export function resolveNvidiaSmiPath(): string {
  const candidate = join(windowsRoot(), 'System32', 'nvidia-smi.exe')
  return existsSync(candidate) ? candidate : 'nvidia-smi'
}

export function resolvePowershellPath(): string {
  const candidate = join(windowsRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : 'powershell'
}
