import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Prova de comportamento do `--stop` no modo sink, sem UAC/ETW: o helper
 * compilado roda `--self-test-stop`, que usa o MESMO `WaitLoop` do coletor e
 * sai quando o arquivo aparece. O `Stop-Process` do script do agente fica como
 * fallback; este teste cobre a saída limpa pelo arquivo.
 */

const state = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({ app: { getPath: () => state.userData } }))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import { ensureStagedHelper } from './helper'

const isWindows = process.platform === 'win32'
const tempRoots: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

function exitOf(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      resolve(code)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // processo já saiu
      }
      finish(null)
    }, timeoutMs)
    child.once('exit', (code) => {
      clearTimeout(timer)
      finish(code)
    })
  })
}

beforeAll(async () => {
  state.userData = await tempDir('kolnd-fps-stop-userData-')
})

afterAll(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe.skipIf(!isWindows)('FPS --sink respeita --stop', () => {
  it('sai com reason=stop-file quando o arquivo de stop aparece', async () => {
    const paths = await ensureStagedHelper()
    const sink = await tempDir('kolnd-fps-stop-sink-')
    const stopPath = join(sink, 'collector.stop')

    const child = spawn(
      paths.stagingExePath,
      ['--self-test-stop', '--sink', sink, '--stop', stopPath, '--minutes', '0'],
      { windowsHide: true }
    )
    // O listener de saída é registrado antes do stop para não perder o evento.
    const exited = exitOf(child, 15_000)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    try {
      await expect
        .poll(() => stdout.includes('"type":"ready"'), { timeout: 30_000, interval: 50 })
        .toBe(true)

      // Sem o arquivo o coletor continua vivo; ele só aparece agora.
      expect(child.exitCode).toBeNull()
      await fs.writeFile(stopPath, 'stop', 'utf8')

      await expect(exited).resolves.toBe(0)
      expect(stdout).toContain('"type":"stopped"')
      expect(stdout).toContain('"reason":"stop-file"')
      expect(stderr).toBe('')
    } finally {
      if (child.exitCode === null) {
        try {
          child.kill()
        } catch {
          // já saiu
        }
      }
    }
  }, 60_000)
})
