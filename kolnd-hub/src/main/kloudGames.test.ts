// Suíte do kloudGames (05-5.5): escrita de estado só quando o estado muda,
// tasklist assíncrono com cache TTL (~2 s) e tolerância a falhas. Nada aqui
// toca Program Files nem spawna processos de verdade: o cwd é redirecionado
// para uma pasta temporária e o tasklist fica no mock.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'

const mockPaths = vi.hoisted(() => ({ baseDir: 'C:\\fake-kg-base' }))

const { execFileAsyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  execFileAsyncMock: vi.fn(),
  writeFileSyncMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getPath: () => join(mockPaths.baseDir, 'userData')
  }
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  // `promisify(execFile)` devolve o implementation `util.promisify.custom`;
  // sem o símbolo custom, promisify exigiria callback e os testes travariam.
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock
  })
  return { ...actual, execFile, execFileSync: vi.fn(), spawn: vi.fn() }
})

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  writeFileSyncMock.mockImplementation(actual.writeFileSync)
  return { ...actual, writeFileSync: writeFileSyncMock }
})

const actualFs = await vi.importActual<typeof import('fs')>('fs')

const spawnMock = vi.mocked(spawn)

import {
  getKloudGamesStatePath,
  getKloudGamesStatus,
  invalidateKloudGamesRunningCache,
  isKloudGamesRunning,
  launchKloudGamesElevated,
  psStringLiteral,
  readKloudGamesState,
  refreshKloudGamesPaths,
  stopKloudGamesElevated
} from './kloudGames'
import { spawn } from 'child_process'

const TASKLIST_NO_TASKS = 'INFO: No tasks are running with the specified criteria.'
const TASKLIST_WITH_TASK = '"KLOUD_GAMES.exe","1234","Console","1","50.000 K"'

function stateDir(): string {
  return join(mockPaths.baseDir, 'resources', 'programs', 'kloud-games')
}

const savedEnv = { ...process.env }

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'kg-test-'))
  mockPaths.baseDir = dir
  vi.spyOn(process, 'cwd').mockReturnValue(dir)
  // Sandbox das pastas de Program Files (evita depender do que está instalado de verdade).
  process.env.ProgramFiles = join(dir, 'pf')
  process.env['ProgramFiles(x86)'] = join(dir, 'pf86')
  process.env.ProgramW6432 = join(dir, 'pf64')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T12:00:00.000Z'))
  execFileAsyncMock.mockReset()
  writeFileSyncMock.mockClear()
  writeFileSyncMock.mockImplementation(actualFs.writeFileSync)
  invalidateKloudGamesRunningCache()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  process.env = { ...savedEnv }
  rmSync(mockPaths.baseDir, { recursive: true, force: true })
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('refreshKloudGamesPaths — escrita só quando o estado muda', () => {
  it('estado idêntico: segunda chamada não escreve no disco', async () => {
    refreshKloudGamesPaths()
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1) // primeira gravação (criação)

    writeFileSyncMock.mockClear()
    refreshKloudGamesPaths()
    refreshKloudGamesPaths()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('estado idêntico via status: chamadas seguidas não reescrevem', async () => {
    await getKloudGamesStatus()
    writeFileSyncMock.mockClear()
    await getKloudGamesStatus()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('estado alterado (exe detectado): escreve de novo', () => {
    refreshKloudGamesPaths()
    writeFileSyncMock.mockClear()

    mkdirSync(stateDir(), { recursive: true })
    actualFs.writeFileSync(join(stateDir(), 'KLOUD_GAMES.exe'), 'fake-exe')

    const { exePath } = refreshKloudGamesPaths()
    expect(exePath).toBe(join(stateDir(), 'KLOUD_GAMES.exe'))
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('isKloudGamesRunning — cache TTL + tasklist assíncrono', () => {
  it('5 chamadas em < 2 s → tasklist spawnado exatamente 1 vez', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_WITH_TASK, stderr: '' })

    for (let i = 0; i < 5; i += 1) {
      expect(await isKloudGamesRunning()).toBe(true)
    }
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('TTL expira (~2 s) → spawna de novo', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_NO_TASKS, stderr: '' })

    expect(await isKloudGamesRunning()).toBe(false)
    vi.setSystemTime(new Date('2026-11-13T12:00:01.500Z')) // +1,5 s — ainda no TTL
    expect(await isKloudGamesRunning()).toBe(false)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-13T12:00:02.100Z')) // +2,1 s — TTL expirou
    expect(await isKloudGamesRunning()).toBe(false)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('falha do tasklist → running: false e a falha também fica cacheada', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('tasklist indisponível'))

    for (let i = 0; i < 5; i += 1) {
      expect(await isKloudGamesRunning()).toBe(false)
    }
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('invalidateKloudGamesRunningCache força novo spawn dentro do TTL', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_WITH_TASK, stderr: '' })

    expect(await isKloudGamesRunning()).toBe(true)
    invalidateKloudGamesRunningCache()
    expect(await isKloudGamesRunning()).toBe(true)
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })
})

describe('getKloudGamesStatus — contrato IPC preservado', () => {
  it('devolve installed/exePath/msiPath/dir/running', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_NO_TASKS, stderr: '' })

    const status = await getKloudGamesStatus()
    expect(status).toEqual({
      installed: false,
      exePath: null,
      msiPath: null,
      dir: stateDir(),
      running: false
    })
  })

  it('getKloudGamesStatePath aponta para userData (01-1.2), não para a pasta do Hub', () => {
    expect(getKloudGamesStatePath()).toBe(
      join(mockPaths.baseDir, 'userData', 'kloud-games.paths.json')
    )
  })
})

describe('readKloudGamesState — migração do caminho legado (01-1.2)', () => {
  const legacyState = (): Record<string, string | null> => ({
    exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
    msiPath: 'C:\\hub\\resources\\programs\\kloud-games\\KLOUD_GAMES.msi',
    installedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  })

  function writeLegacy(content: string): string {
    mkdirSync(stateDir(), { recursive: true })
    const legacyPath = join(stateDir(), 'kloud-games.paths.json')
    actualFs.writeFileSync(legacyPath, content, 'utf8')
    return legacyPath
  }

  function newStatePath(): string {
    return join(mockPaths.baseDir, 'userData', 'kloud-games.paths.json')
  }

  it('só o arquivo antigo existe → migra, lê e preserva exePath/installedAt', () => {
    const legacyPath = writeLegacy(JSON.stringify(legacyState()))

    const state = readKloudGamesState()
    expect(state.exePath).toBe('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')
    expect(state.msiPath).toBe('C:\\hub\\resources\\programs\\kloud-games\\KLOUD_GAMES.msi')
    expect(state.installedAt).toBe('2026-01-01T00:00:00.000Z')

    // Novo arquivo criado com o conteúdo migrado; legado renomeado para .migrated.
    expect(existsSync(newStatePath())).toBe(true)
    const migrated = JSON.parse(readFileSync(newStatePath(), 'utf8')) as Record<string, unknown>
    expect(migrated.exePath).toBe(state.exePath)
    expect(existsSync(legacyPath)).toBe(false)
    expect(existsSync(`${legacyPath}.migrated`)).toBe(true)
  })

  it('arquivo novo corrompido → tolerante (estado vazio, sem lançar, sem migrar o legado)', () => {
    actualFs.mkdirSync(join(mockPaths.baseDir, 'userData'), { recursive: true })
    actualFs.writeFileSync(newStatePath(), 'lixo{ corrompido', 'utf8')
    const legacyPath = writeLegacy(JSON.stringify(legacyState()))

    const state = readKloudGamesState()
    expect(state).toEqual({ exePath: null, msiPath: null, installedAt: null, updatedAt: null })
    // Novo (corrompido) existia → migração não dispara; legado preservado.
    expect(existsSync(legacyPath)).toBe(true)
  })

  it('legado corrompido e novo ausente → não migra, não lança, legado preservado', () => {
    const legacyPath = writeLegacy('{{{ não é json')

    const state = readKloudGamesState()
    expect(state).toEqual({ exePath: null, msiPath: null, installedAt: null, updatedAt: null })
    expect(existsSync(newStatePath())).toBe(false)
    expect(existsSync(legacyPath)).toBe(true)
  })

  it('nenhum arquivo → estado vazio', () => {
    expect(readKloudGamesState()).toEqual({
      exePath: null,
      msiPath: null,
      installedAt: null,
      updatedAt: null
    })
  })

  it('legado existe e novo já existe → novo é a fonte de verdade (sem migração)', () => {
    writeLegacy(JSON.stringify(legacyState()))
    actualFs.mkdirSync(join(mockPaths.baseDir, 'userData'), { recursive: true })
    actualFs.writeFileSync(
      newStatePath(),
      JSON.stringify({
        exePath: 'C:\\novo\\KLOUD_GAMES.exe',
        msiPath: null,
        installedAt: '2026-06-01T00:00:00.000Z',
        updatedAt: null
      }),
      'utf8'
    )

    const state = readKloudGamesState()
    expect(state.exePath).toBe('C:\\novo\\KLOUD_GAMES.exe')
    expect(state.installedAt).toBe('2026-06-01T00:00:00.000Z')
    expect(existsSync(join(stateDir(), 'kloud-games.paths.json.migrated'))).toBe(false)
  })
})

// ── Abertura/encerramento elevados (UAC) ─────────────────────────

/**
 * Stub do `spawn` que dispara os handlers na ordem em que são registrados —
 * a implementação assina stdout/stderr antes de `close`, então os dados
 * chegam ao acumulador sem depender de timers (os fake timers do arquivo
 * continuam ativos).
 */
function spawnStub(exitCode: number, stdoutText = '', stderrText = ''): void {
  const stdoutHandlers: Array<(chunk: Buffer) => void> = []
  const stderrHandlers: Array<(chunk: Buffer) => void> = []

  const child = {
    stdout: {
      on: (_event: string, handler: (chunk: Buffer) => void) => {
        stdoutHandlers.push(handler)
      }
    },
    stderr: {
      on: (_event: string, handler: (chunk: Buffer) => void) => {
        stderrHandlers.push(handler)
      }
    },
    on: (event: string, handler: (code: number) => void) => {
      if (event !== 'close') return
      if (stdoutText) for (const fn of stdoutHandlers) fn(Buffer.from(stdoutText))
      if (stderrText) for (const fn of stderrHandlers) fn(Buffer.from(stderrText))
      handler(exitCode)
    }
  }

  spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>)
}

function lastSpawnArgs(): { file: string; args: string[] } {
  const call = spawnMock.mock.calls.at(-1)
  expect(call).toBeDefined()
  return { file: String(call?.[0]), args: (call?.[1] ?? []) as string[] }
}

describe('launchKloudGamesElevated — abre sempre elevado (UAC)', () => {
  it('usa Start-Process -Verb RunAs com exe e diretório de trabalho', async () => {
    spawnStub(0)

    const result = await launchKloudGamesElevated('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')

    expect(result).toEqual({ success: true })
    const { file, args } = lastSpawnArgs()
    expect(file).toBe('powershell.exe')
    const command = args.join(' ')
    expect(command).toContain('-Verb RunAs')
    expect(command).toContain("'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe'")
    expect(command).toContain("-WorkingDirectory 'C:\\Program Files\\KLOUD_GAMES'")
  })

  it('caminho vazio → erro sem chamar o PowerShell', async () => {
    const result = await launchKloudGamesElevated('   ')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/vazio/i)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('UAC cancelado (1223) → erro explicativo', async () => {
    spawnStub(1223, '', 'A operação foi cancelada pelo usuário')

    const result = await launchKloudGamesElevated('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/UAC/)
  })

  it('outra falha → erro com o código e os detalhes', async () => {
    spawnStub(1, '', 'erro inesperado')

    const result = await launchKloudGamesElevated('C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe')

    expect(result.success).toBe(false)
    expect(result.error).toContain('código 1')
    expect(result.error).toContain('erro inesperado')
  })

  it('psStringLiteral dobra aspas simples (não interpola o caminho)', () => {
    expect(psStringLiteral("C:\\Jogos\\D'Ávila\\app.exe")).toBe("'C:\\Jogos\\D''Ávila\\app.exe'")
  })
})

describe('stopKloudGamesElevated — taskkill via UAC', () => {
  it('processo parado → erro sem chamar o PowerShell', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_NO_TASKS, stderr: '' })

    const result = await stopKloudGamesElevated()

    expect(result).toEqual({ success: false, error: 'Processo não está em execução' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('processo em execução → taskkill elevado e cache invalidado', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: TASKLIST_WITH_TASK, stderr: '' })
    spawnStub(0)

    expect(await isKloudGamesRunning()).toBe(true)
    const result = await stopKloudGamesElevated()

    expect(result).toEqual({ success: true })
    const { file, args } = lastSpawnArgs()
    expect(file).toBe('powershell.exe')
    const command = args.join(' ')
    expect(command).toContain('taskkill.exe')
    expect(command).toContain("'/IM','KLOUD_GAMES.exe'")
    expect(command).toContain('-Verb RunAs')

    // Cache invalidado: a próxima consulta spawna o tasklist de novo.
    execFileAsyncMock.mockClear()
    await isKloudGamesRunning()
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })
})
