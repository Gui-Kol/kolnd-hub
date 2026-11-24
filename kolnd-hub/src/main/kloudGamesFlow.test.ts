import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  packaged: false,
  userData: 'C:\\ud',
  spawn: vi.fn(),
  execFileAsync: vi.fn(),
  appendFileSync: vi.fn(),
  createReadStream: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  renameSync: vi.fn(),
  writeFileSync: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.packaged
    },
    getPath: () => mocks.userData
  }
}))
vi.mock('child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mocks.execFileAsync
  })
  return { execFile, spawn: mocks.spawn }
})
vi.mock('fs', () => ({
  appendFileSync: mocks.appendFileSync,
  createReadStream: mocks.createReadStream,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  readdirSync: mocks.readdirSync,
  renameSync: mocks.renameSync,
  writeFileSync: mocks.writeFileSync
}))
vi.mock('./logger', () => ({
  logger: { info: mocks.logInfo, warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }
}))

import {
  appendKloudGamesUninstallLog,
  ensureKloudGamesInstalled,
  findKloudGamesExe,
  findKloudGamesMsi,
  getKloudGamesDir,
  getKloudGamesInstallLogPath,
  getKloudGamesStatePath,
  getKloudGamesUninstallLogPath,
  invalidateKloudGamesRunningCache,
  isKloudGamesRunning,
  launchKloudGamesElevated,
  readKloudGamesState,
  refreshKloudGamesPaths,
  resetKloudGamesState,
  stopKloudGamesElevated,
  writeKloudGamesState
} from './kloudGames'

const HUB = 'C:\\hub'
const HUB_DIR = join(HUB, 'resources', 'programs', 'kloud-games')
const MSI = join(HUB_DIR, 'KLOUD_GAMES.msi')
const STATE = join('C:\\ud', 'kloud-games.paths.json')
const PF_EXE = join('C:\\pf', 'KLOUD_GAMES', 'KLOUD_GAMES.exe')

interface FsOptions {
  files?: string[]
  dirs?: string[]
  content?: Record<string, string | Error>
  listing?: Record<string, Array<{ name: string; kind: 'file' | 'dir' }> | Error>
}

function setupFs(options: FsOptions = {}): void {
  const files = new Set(options.files ?? [])
  const dirs = new Set(options.dirs ?? [])
  mocks.existsSync.mockImplementation((path: string) => files.has(path) || dirs.has(path))
  mocks.readFileSync.mockImplementation((path: string) => {
    const value = options.content?.[path]
    if (value === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    if (value instanceof Error) throw value
    return value
  })
  mocks.readdirSync.mockImplementation((path: string) => {
    const listing = options.listing?.[path]
    if (listing === undefined) throw new Error(`ENOENT: ${path}`)
    if (listing instanceof Error) throw listing
    return listing.map((entry) => ({
      name: entry.name,
      isFile: () => entry.kind === 'file',
      isDirectory: () => entry.kind === 'dir'
    }))
  })
}

function child(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  mocks.spawn.mockReturnValueOnce(proc)
  return proc
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.packaged = false
  mocks.userData = 'C:\\ud'
  process.env.ProgramFiles = 'C:\\pf'
  process.env['ProgramFiles(x86)'] = 'C:\\pf86'
  process.env.ProgramW6432 = 'C:\\pf64'
  vi.spyOn(process, 'cwd').mockReturnValue(HUB)
  setupFs()

  mocks.createReadStream.mockImplementation(() => {
    const created = new EventEmitter()
    queueMicrotask(() => {
      created.emit('data', Buffer.from('msi'))
      created.emit('end')
    })
    return created
  })
  mocks.execFileAsync.mockResolvedValue({ stdout: '' })
  invalidateKloudGamesRunningCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('caminhos e logs', () => {
  it('dir fica em resources/programs/kloud-games (dev e empacotado)', () => {
    expect(getKloudGamesDir()).toBe(HUB_DIR)
    mocks.packaged = true
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\installed\\resources',
      configurable: true
    })
    expect(getKloudGamesDir()).toBe(join('C:\\installed\\resources', 'programs', 'kloud-games'))
    mocks.packaged = false
  })

  it('expõe os caminhos de log e de estado', () => {
    expect(getKloudGamesInstallLogPath()).toBe(join('C:\\ud', 'logs', 'kloud-games-install.log'))
    expect(getKloudGamesUninstallLogPath()).toBe(
      join('C:\\ud', 'logs', 'kloud-games-uninstall.log')
    )
    expect(getKloudGamesStatePath()).toBe(STATE)
  })

  it('grava logs de instalação/desinstalação e tolera falha', () => {
    expect(() => appendKloudGamesUninstallLog('teste')).not.toThrow()
    expect(mocks.appendFileSync).toHaveBeenCalled()

    mocks.appendFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(() => appendKloudGamesUninstallLog('x')).not.toThrow()
    expect(mocks.logWarn).toHaveBeenCalled()
  })
})

describe('migração e leitura/escrita de estado', () => {
  const legacy = join(HUB_DIR, 'kloud-games.paths.json')

  it('migra o estado legado válido e renomeia o antigo', () => {
    const content = JSON.stringify({ exePath: 'C:\\kg.exe' })
    setupFs({
      files: [legacy],
      dirs: ['C:\\ud'],
      content: { [legacy]: content, [STATE]: content }
    })

    expect(readKloudGamesState()).toEqual({
      exePath: 'C:\\kg.exe',
      msiPath: null,
      installedAt: null,
      updatedAt: null
    })
    expect(mocks.writeFileSync).toHaveBeenCalledWith(STATE, content, 'utf8')
    expect(mocks.renameSync).toHaveBeenCalledWith(legacy, `${legacy}.migrated`)
  })

  it('não migra JSON inválido nem suja o novo caminho', () => {
    setupFs({ files: [legacy], dirs: ['C:\\ud'], content: { [legacy]: '{quebrado' } })
    expect(readKloudGamesState()).toEqual({
      exePath: null,
      msiPath: null,
      installedAt: null,
      updatedAt: null
    })
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('migração com rename falhando mantém o legado e loga', () => {
    const content = JSON.stringify({ exePath: null })
    setupFs({
      files: [legacy],
      dirs: ['C:\\ud'],
      content: { [legacy]: content, [STATE]: content }
    })
    mocks.renameSync.mockImplementationOnce(() => {
      throw new Error('EBUSY')
    })
    readKloudGamesState()
    expect(mocks.writeFileSync).toHaveBeenCalled()
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('estado novo existente tem prioridade sobre o legado', () => {
    setupFs({
      files: [STATE, legacy],
      dirs: ['C:\\ud'],
      content: {
        [STATE]: JSON.stringify({ exePath: 'C:\\novo.exe', msiPath: null }),
        [legacy]: JSON.stringify({ exePath: 'C:\\velho.exe' })
      }
    })
    expect(readKloudGamesState().exePath).toBe('C:\\novo.exe')
    expect(mocks.renameSync).not.toHaveBeenCalled()
  })

  it('estado corrompido cai no vazio', () => {
    setupFs({ files: [STATE], dirs: ['C:\\ud'], content: { [STATE]: 'não é json' } })
    expect(readKloudGamesState()).toEqual({
      exePath: null,
      msiPath: null,
      installedAt: null,
      updatedAt: null
    })
  })

  it('writeKloudGamesState elide escrita idêntica e regrava a diferente', () => {
    const state = {
      exePath: 'C:\\kg.exe',
      msiPath: MSI,
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    setupFs({ files: [STATE], dirs: ['C:\\ud'], content: { [STATE]: JSON.stringify(state) } })
    expect(writeKloudGamesState(state)).toBe(true)
    expect(mocks.writeFileSync).not.toHaveBeenCalled()

    expect(writeKloudGamesState({ ...state, exePath: 'C:\\outro.exe' })).toBe(true)
    expect(mocks.writeFileSync).toHaveBeenCalled()
  })

  it('writeKloudGamesState cria a pasta e devolve false em falha', () => {
    setupFs({ dirs: [] })
    expect(
      writeKloudGamesState({ exePath: null, msiPath: null, installedAt: null, updatedAt: null })
    ).toBe(true)
    expect(mocks.mkdirSync).toHaveBeenCalled()

    mocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('EPERM')
    })
    expect(
      writeKloudGamesState({ exePath: 'C:\\x', msiPath: null, installedAt: null, updatedAt: null })
    ).toBe(false)
    expect(mocks.logWarn).toHaveBeenCalled()
  })

  it('resetKloudGamesState zera o exe e preserva o msi', () => {
    setupFs({ files: [MSI] })
    expect(resetKloudGamesState()).toBe(true)
    const [, raw] = mocks.writeFileSync.mock.calls.at(-1) ?? []
    expect(JSON.parse(String(raw))).toMatchObject({ exePath: null, msiPath: MSI })
  })
})

describe('findKloudGamesExe / msi', () => {
  it('usa o caminho salvo quando existe', () => {
    setupFs({
      files: [STATE, 'C:\\salvo\\KLOUD_GAMES.exe'],
      dirs: ['C:\\ud'],
      content: { [STATE]: JSON.stringify({ exePath: 'C:\\salvo\\KLOUD_GAMES.exe' }) }
    })
    expect(findKloudGamesExe()).toBe('C:\\salvo\\KLOUD_GAMES.exe')
  })

  it('varre a pasta do Hub em profundidade limitada, ignorando node_modules/_internal', () => {
    setupFs({
      dirs: [HUB_DIR, join(HUB_DIR, 'bin')],
      listing: {
        [HUB_DIR]: [
          { name: 'node_modules', kind: 'dir' },
          { name: '_internal', kind: 'dir' },
          { name: 'bin', kind: 'dir' }
        ],
        [join(HUB_DIR, 'bin')]: [{ name: 'kloud_games.exe', kind: 'file' }]
      }
    })
    expect(findKloudGamesExe()).toBe(join(HUB_DIR, 'bin', 'kloud_games.exe'))
  })

  it('sem pasta legível, testa Program Files e a varredura', () => {
    setupFs({
      dirs: [join('C:\\pf', 'KLOUD_GAMES')],
      listing: {
        [join('C:\\pf', 'KLOUD_GAMES')]: [{ name: 'KLOUD_GAMES.exe', kind: 'file' }]
      }
    })
    expect(findKloudGamesExe()).toBe(join('C:\\pf', 'KLOUD_GAMES', 'KLOUD_GAMES.exe'))
  })

  it('candidatos diretos de Program Files e ausência total', () => {
    setupFs({ files: [PF_EXE] })
    expect(findKloudGamesExe()).toBe(PF_EXE)

    setupFs({})
    expect(findKloudGamesExe()).toBeNull()
    expect(findKloudGamesMsi()).toBeNull()
  })

  it('default de ProgramFiles quando a env está ausente', () => {
    delete process.env.ProgramFiles
    setupFs({
      dirs: [join('C:\\Program Files', 'KLOUD_GAMES')],
      listing: {
        [join('C:\\Program Files', 'KLOUD_GAMES')]: [{ name: 'KLOUD_GAMES.exe', kind: 'file' }]
      }
    })
    expect(findKloudGamesExe()).toBe(join('C:\\Program Files', 'KLOUD_GAMES', 'KLOUD_GAMES.exe'))
    process.env.ProgramFiles = 'C:\\pf'
  })

  it('findKloudGamesMsi devolve o MSI embutido', () => {
    setupFs({ files: [MSI] })
    expect(findKloudGamesMsi()).toBe(MSI)
  })

  it('refreshKloudGamesPaths persiste exe/msi encontrados', () => {
    setupFs({ files: [MSI, PF_EXE] })
    expect(refreshKloudGamesPaths()).toEqual({ exePath: PF_EXE, msiPath: MSI })
    expect(mocks.writeFileSync).toHaveBeenCalled()
  })
})

describe('isKloudGamesRunning', () => {
  it('detecta pelo tasklist e cacheia por 2 s', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"KLOUD_GAMES.exe","1","Console"' })
    await expect(isKloudGamesRunning()).resolves.toBe(true)
    await expect(isKloudGamesRunning()).resolves.toBe(true)
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(1)
  })

  it('falha do tasklist vira false', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('tasklist falhou'))
    await expect(isKloudGamesRunning()).resolves.toBe(false)
  })
})

describe('ensureKloudGamesInstalled', () => {
  it('já instalado: não abre o MSI', async () => {
    setupFs({ files: [PF_EXE] })
    await expect(ensureKloudGamesInstalled()).resolves.toEqual({
      success: true,
      exePath: PF_EXE,
      msiPath: null,
      installedNow: false
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.appendFileSync).toHaveBeenCalled()
  })

  it('sem MSI embutido devolve erro explicativo', async () => {
    setupFs({})
    const result = await ensureKloudGamesInstalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('MSI do Kloud Games está ausente')
  })

  it('instala e confirma o exe depois do msiexec', async () => {
    setupFs({ files: [MSI] })
    const proc = child()
    const promise = ensureKloudGamesInstalled()
    await tick()
    // Depois do close, o exe passa a existir em Program Files.
    mocks.existsSync.mockImplementation((path: string) => path === MSI || path === PF_EXE)
    proc.emit('close', 0)

    await expect(promise).resolves.toEqual({
      success: true,
      exePath: PF_EXE,
      msiPath: MSI,
      installedNow: true
    })
  })

  it('msiexec falha mas o exe aparece → sucesso não fatal', async () => {
    setupFs({ files: [MSI] })
    const proc = child()
    const promise = ensureKloudGamesInstalled()
    await tick()
    mocks.existsSync.mockImplementation((path: string) => path === MSI || path === PF_EXE)
    proc.emit('close', 1602)
    await expect(promise).resolves.toMatchObject({ success: true, installedNow: true })
  })

  it('msiexec termina sem exe → falha de verificação', async () => {
    setupFs({ files: [MSI] })
    const proc = child()
    const promise = ensureKloudGamesInstalled()
    await tick()
    proc.emit('close', 0)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain('não foi encontrado')
  })

  it.each([
    [1602, 'cancelada no assistente'],
    [1500, 'Outra instalação'],
    [1618, 'Outra instalação'],
    [1704, 'pendente/suspensa'],
    [1705, 'pendente/suspensa']
  ])('código %s vira mensagem própria', async (code, expected) => {
    setupFs({ files: [MSI] })
    const proc = child()
    const promise = ensureKloudGamesInstalled()
    await tick()
    proc.emit('close', code)
    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toContain(expected)
  })

  it('UAC negado pelo texto de saída', async () => {
    setupFs({ files: [MSI] })
    const proc = child()
    const promise = ensureKloudGamesInstalled()
    await tick()
    proc.stderr.emit('data', 'A operação foi cancelada pelo usuário')
    proc.emit('close', 1)
    await expect(promise).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Permissão negada (UAC)')
    })
  })

  it('código genérico e erro de spawn também são tratados', async () => {
    setupFs({ files: [MSI] })
    let proc = child()
    let promise = ensureKloudGamesInstalled()
    await tick()
    proc.emit('close', 9)
    await expect(promise).resolves.toMatchObject({
      error: expect.stringContaining('código 9')
    })

    proc = child()
    promise = ensureKloudGamesInstalled()
    await tick()
    proc.emit('error', new Error('powershell sumiu'))
    await expect(promise).resolves.toMatchObject({
      error: expect.stringContaining('Não foi possível iniciar a instalação elevada')
    })
  })
})

describe('elevação (abrir/parar)', () => {
  it('launchKloudGamesElevated recusa caminho vazio', async () => {
    await expect(launchKloudGamesElevated('   ')).resolves.toEqual({
      success: false,
      error: 'Caminho do Kloud Games vazio.'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('launch com sucesso envia o comando com aspas literais', async () => {
    const proc = child()
    const promise = launchKloudGamesElevated("C:\\Program Files\\KLOUD'S\\kg.exe")
    await tick()
    expect(mocks.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-Command', expect.stringContaining("KLOUD''S")]),
      expect.any(Object)
    )
    proc.emit('close', 0)
    await expect(promise).resolves.toEqual({ success: true })
  })

  it('cancelamento do UAC e falha genérica são distinguidos', async () => {
    let proc = child()
    let promise = launchKloudGamesElevated('C:\\kg\\kg.exe')
    await tick()
    proc.emit('close', 1223)
    await expect(promise).resolves.toMatchObject({ success: false })
    expect((await promise).error).toContain('Permissão negada (UAC)')

    proc = child()
    promise = launchKloudGamesElevated('C:\\kg\\kg.exe')
    await tick()
    proc.stderr.emit('data', 'erro detalhado')
    proc.emit('close', 7)
    const failed = await promise
    expect(failed.error).toContain('código 7')
    expect(failed.error).toContain('erro detalhado')

    proc = child()
    promise = launchKloudGamesElevated('C:\\kg\\kg.exe')
    await tick()
    proc.emit('error', new Error('sem powershell'))
    await expect(promise).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('Não foi possível chamar o PowerShell')
    })
  })

  it('stop recusa quando o jogo não está rodando', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    await expect(stopKloudGamesElevated()).resolves.toEqual({
      success: false,
      error: 'Processo não está em execução'
    })
  })

  it('stop roda o taskkill elevado e invalida o cache em sucesso', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"KLOUD_GAMES.exe","1"' })
    const proc = child()
    const promise = stopKloudGamesElevated()
    await tick()
    proc.emit('close', 0)
    await expect(promise).resolves.toEqual({ success: true })
    // Como o cache foi invalidado, a próxima consulta chama o tasklist de novo.
    await isKloudGamesRunning()
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(2)
  })

  it('stop propaga o cancelamento do UAC', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"KLOUD_GAMES.exe","1"' })
    const proc = child()
    const promise = stopKloudGamesElevated()
    await tick()
    proc.emit('close', 1223)
    await expect(promise).resolves.toMatchObject({ success: false })
    expect((await promise).error).toContain('Permissão negada (UAC)')
  })
})
