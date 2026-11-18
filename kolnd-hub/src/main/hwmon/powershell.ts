import { spawn } from 'child_process'
import { resolvePowershellPath } from './systemPaths'

/** Resultado de um processo auxiliar — nunca lança, timeout mata o processo. */
export interface ProcessResult {
  stdout: string
  stderr: string
  code: number | null
  timedOut: boolean
}

/**
 * Executa um processo sem shell, com stdin opcional e timeout. Usado pelos
 * helpers do monitor para que uma falha do PowerShell nunca trave o main.
 */
export function runProcess(
  file: string,
  args: string[],
  stdin: string | null,
  timeoutMs: number
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ReturnType<typeof spawn>

    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ stdout, stderr: String(err), code: null, timedOut: false })
      return
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // best-effort: o resultado vira timeout de qualquer forma
      }
      resolve({ stdout, stderr, code: null, timedOut: true })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: stderr ? `${stderr}\n${err.message}` : err.message,
        code: null,
        timedOut: false
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, code, timedOut: false })
    })

    try {
      child.stdin?.end(stdin ?? '')
    } catch {
      // stdin pode já ter sido fechado pelo processo
    }
  })
}

export function runPowerShell(
  args: string[],
  timeoutMs: number,
  stdin: string | null = null
): Promise<ProcessResult> {
  return runProcess(resolvePowershellPath(), args, stdin, timeoutMs)
}

export function runPowerShellCommand(command: string, timeoutMs: number): Promise<ProcessResult> {
  return runPowerShell(
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    timeoutMs
  )
}
