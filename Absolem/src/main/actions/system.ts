import type { PermissionDecision } from '../../shared/permissions'

/**
 * Ações de sistema (task 08, T7).
 *
 * Energia exige `system.power = allow` (default `deny`) e SEMPRE avisa pelo
 * balão da bandeja antes de executar; desligar/reiniciar usam `/t 60` e podem
 * ser cancelados com `/a`. Volume/brilho são best-effort COM verificação do
 * efeito: quando não é possível confirmar, a resposta é "não suportado neste
 * equipamento", nunca sucesso inventado.
 *
 * Todos os comandos usam `execFile` com array de argumentos; nada de
 * `shell:true` nem interpolação de texto do modelo.
 */

export interface SystemRunResult {
  code: number
  stdout: string
  stderr?: string
}

export interface SystemDeps {
  run: (file: string, args: string[]) => Promise<SystemRunResult>
  getPermission: () => PermissionDecision
  notify: (message: string) => void
}

export type SystemFailureCode = 'denied' | 'failed' | 'unsupported' | 'invalid'

export type SystemActionResult =
  | { ok: true; seconds?: number; cancelable?: boolean; level?: number }
  | { ok: false; code: SystemFailureCode; error: string }

export interface SystemActions {
  lock: () => Promise<SystemActionResult>
  sleep: () => Promise<SystemActionResult>
  shutdown: () => Promise<SystemActionResult>
  restart: () => Promise<SystemActionResult>
  cancelShutdown: () => Promise<SystemActionResult>
  setVolume: (level: number) => Promise<SystemActionResult>
  setBrightness: (level: number) => Promise<SystemActionResult>
}

const VOLUME_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'try {',
  '  if (-not (Get-Command Get-AudioDevice -ErrorAction SilentlyContinue)) {',
  '    Write-Output \'{"supported":false}\'',
  '    exit 0',
  '  }',
  '  $level=[int]$args[0]',
  '  Set-AudioDevice -PlaybackVolume $level | Out-Null',
  '  $current=[int](Get-AudioDevice -PlaybackVolume)',
  '  Write-Output ("{""supported"":true,""value"":" + $current + "}")',
  '} catch { Write-Output \'{"supported":false}\' }'
].join('\n')

const BRIGHTNESS_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'try {',
  '  $level=[int]$args[0]',
  '  $methods=Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop',
  '  if (-not $methods) { Write-Output \'{"supported":false}\'; exit 0 }',
  '  $methods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=$level} | Out-Null',
  '  $after=(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop).CurrentBrightness',
  '  Write-Output ("{""supported"":true,""value"":" + [int]$after + "}")',
  '} catch { Write-Output \'{"supported":false}\' }'
].join('\n')

const UNSUPPORTED_MESSAGE = 'não suportado neste equipamento'

function parseVerification(stdout: string): { supported: boolean; value?: number } {
  const match = /\{[^{}]*\}/.exec(stdout)
  if (!match) return { supported: false }
  try {
    const parsed = JSON.parse(match[0]) as { supported?: unknown; value?: unknown }
    if (parsed.supported !== true) return { supported: false }
    return {
      supported: true,
      ...(typeof parsed.value === 'number' ? { value: parsed.value } : {})
    }
  } catch {
    return { supported: false }
  }
}

export function createSystemActions(deps: SystemDeps): SystemActions {
  const canUsePower = (): boolean => deps.getPermission() === 'allow'

  const denied = (): SystemActionResult => ({
    ok: false,
    code: 'denied',
    error: 'A permissão system.power não está em allow.'
  })

  async function runCommand(
    file: string,
    args: string[],
    actionLabel: string
  ): Promise<SystemActionResult> {
    try {
      const result = await deps.run(file, args)
      if (result.code !== 0) {
        return {
          ok: false,
          code: 'failed',
          error: `O Windows recusou ${actionLabel} (código ${result.code}).`
        }
      }
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, code: 'failed', error: `Falha ao ${actionLabel}: ${message}` }
    }
  }

  async function setLevel(
    script: string,
    level: number,
    label: string
  ): Promise<SystemActionResult> {
    if (!canUsePower()) return denied()
    if (!Number.isInteger(level) || level < 0 || level > 100) {
      return { ok: false, code: 'invalid', error: `${label} precisa ser inteiro de 0 a 100.` }
    }
    let result: SystemRunResult
    try {
      result = await deps.run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        script,
        String(level)
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        code: 'unsupported',
        error: `${label}: ${UNSUPPORTED_MESSAGE} (${message}).`
      }
    }
    if (result.code !== 0) {
      return { ok: false, code: 'unsupported', error: `${label}: ${UNSUPPORTED_MESSAGE}.` }
    }
    const verified = parseVerification(result.stdout)
    if (!verified.supported || typeof verified.value !== 'number') {
      return { ok: false, code: 'unsupported', error: `${label}: ${UNSUPPORTED_MESSAGE}.` }
    }
    if (Math.abs(verified.value - level) > 2) {
      return {
        ok: false,
        code: 'unsupported',
        error: `${label}: ${UNSUPPORTED_MESSAGE} (efeito não confirmado).`
      }
    }
    return { ok: true, level: verified.value }
  }

  return {
    lock: async () => {
      if (!canUsePower()) return denied()
      return runCommand('rundll32.exe', ['user32.dll,LockWorkStation'], 'bloquear a estação')
    },

    sleep: async () => {
      if (!canUsePower()) return denied()
      deps.notify('Dormindo. Pressione uma tecla para acordar.')
      return runCommand(
        'rundll32.exe',
        ['powrprof.dll,SetSuspendState', '0,1,0'],
        'suspender o computador'
      )
    },

    shutdown: async () => {
      if (!canUsePower()) return denied()
      deps.notify('Desligamento agendado para 60 s. Use "cancelar desligamento" para abortar.')
      const result = await runCommand(
        'shutdown.exe',
        ['/s', '/t', '60', '/c', 'Absolem'],
        'agendar o desligamento'
      )
      return result.ok ? { ok: true, seconds: 60, cancelable: true } : result
    },

    restart: async () => {
      if (!canUsePower()) return denied()
      deps.notify('Reinício agendado para 60 s. Use "cancelar desligamento" para abortar.')
      const result = await runCommand(
        'shutdown.exe',
        ['/r', '/t', '60', '/c', 'Absolem'],
        'agendar o reinício'
      )
      return result.ok ? { ok: true, seconds: 60, cancelable: true } : result
    },

    cancelShutdown: async () => {
      if (!canUsePower()) return denied()
      const result = await runCommand('shutdown.exe', ['/a'], 'cancelar o desligamento')
      if (result.ok) deps.notify('Desligamento/reinício cancelado.')
      return result
    },

    setVolume: (level) => setLevel(VOLUME_SCRIPT, level, 'Volume'),
    setBrightness: (level) => setLevel(BRIGHTNESS_SCRIPT, level, 'Brilho')
  }
}
