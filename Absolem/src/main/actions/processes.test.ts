import { describe, expect, it, vi } from 'vitest'
import {
  closeProcess,
  listProcesses,
  parseCsvLine,
  parseTasklistCsv,
  type ProcessDeps,
  type ProcessInfo,
  type RunResult
} from './processes'

/**
 * Processos (T3) sem executar `tasklist`/`taskkill`: o runner é um fake que
 * mantém uma tabela de processos vivos em memória.
 */

function csv(processes: ProcessInfo[]): string {
  return processes
    .map(
      (process) =>
        `"${process.name}","${process.pid}","${process.sessionName}","1","${process.memKB} K"`
    )
    .join('\r\n')
}

function createRunner(initial: ProcessInfo[]) {
  const alive = new Map(initial.map((process) => [process.pid, process]))
  const calls: Array<{ file: string; args: string[] }> = []
  const run = vi.fn(async (file: string, args: string[]): Promise<RunResult> => {
    calls.push({ file, args })
    if (file === 'tasklist.exe') {
      if (args.includes('/FI')) {
        const filter = args[args.indexOf('/FI') + 1] ?? ''
        const match = /PID eq (\d+)/.exec(filter)
        const pid = match ? Number(match[1]) : 0
        const process = alive.get(pid)
        return { code: 0, stdout: process ? csv([process]) : '' }
      }
      return { code: 0, stdout: csv([...alive.values()]) }
    }
    if (file === 'taskkill.exe') {
      const pid = Number(args[args.indexOf('/PID') + 1])
      if (alive.has(pid)) alive.delete(pid)
      return { code: 0, stdout: '' }
    }
    return { code: 1, stdout: '' }
  })
  const deps: ProcessDeps = { run, wait: async () => undefined }
  return { deps, run, calls, alive }
}

describe('processos', () => {
  it('parseia CSV com vírgula e aspas dentro do campo', () => {
    expect(parseCsvLine('"App, com vírgula.exe","1234","Console","1","12.345 K"')).toEqual([
      'App, com vírgula.exe',
      '1234',
      'Console',
      '1',
      '12.345 K'
    ])

    const parsed = parseTasklistCsv(
      [
        '"App, com vírgula.exe","1234","Console","1","12.345 K"',
        '"SemAspas.exe",9,Services,0,800 K',
        '"Inválido","abc","Console","1","1 K"',
        ''
      ].join('\r\n')
    )
    expect(parsed).toEqual([
      { name: 'App, com vírgula.exe', pid: 1234, sessionName: 'Console', memKB: 12345 },
      { name: 'SemAspas.exe', pid: 9, sessionName: 'Services', memKB: 800 }
    ])
  })

  it('lista no máximo 500 processos', async () => {
    const many: ProcessInfo[] = Array.from({ length: 600 }, (_unused, index) => ({
      name: `app-${index}.exe`,
      pid: index + 1,
      sessionName: 'Console',
      memKB: 1
    }))
    const { deps, calls } = createRunner(many)

    const processes = await listProcesses(deps)

    expect(processes).toHaveLength(500)
    expect(calls[0]).toEqual({ file: 'tasklist.exe', args: ['/FO', 'CSV', '/NH'] })
  })

  it('blocklist recusa processo de sistema (nome ou sessão Services)', async () => {
    const explorer = createRunner([
      { name: 'explorer.exe', pid: 100, sessionName: 'Console', memKB: 10 }
    ])
    const result = await closeProcess(explorer.deps, 100)
    expect(result).toMatchObject({ ok: false, reason: 'blocked' })
    expect(explorer.calls.some((call) => call.file === 'taskkill.exe')).toBe(false)

    const service = createRunner([
      { name: 'qualquer.exe', pid: 101, sessionName: 'Services', memKB: 10 }
    ])
    const serviceResult = await closeProcess(service.deps, 101)
    expect(serviceResult).toMatchObject({ ok: false, reason: 'blocked' })
    expect(service.calls.some((call) => call.file === 'taskkill.exe')).toBe(false)
  })

  it('fecha sem /F quando não forçado e usa /T /F só quando forçado', async () => {
    const normal = createRunner([
      { name: 'notepad.exe', pid: 1234, sessionName: 'Console', memKB: 5 }
    ])
    const result = await closeProcess(normal.deps, 1234)

    expect(result).toEqual({ ok: true, pid: 1234, forced: false })
    const kill = normal.calls.find((call) => call.file === 'taskkill.exe')
    expect(kill?.args).toEqual(['/PID', '1234'])
    expect(kill?.args).not.toContain('/F')

    const forced = createRunner([
      { name: 'notepad.exe', pid: 4321, sessionName: 'Console', memKB: 5 }
    ])
    const forcedResult = await closeProcess(forced.deps, 4321, { force: true })
    expect(forcedResult).toEqual({ ok: true, pid: 4321, forced: true })
    expect(forced.calls.find((call) => call.file === 'taskkill.exe')?.args).toEqual([
      '/PID',
      '4321',
      '/T',
      '/F'
    ])
  })
})
