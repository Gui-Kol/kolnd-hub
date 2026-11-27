// Fluxos do Hub e remoção do serviço KLOUD_GAMESsvc com mocks (T6 §2, §4).
// Nada aqui executa de verdade: app.isPackaged é alternável, o MSI/NSIS/sc
// fluem para mocks, e nenhuma pasta real é apagada.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  runHubUninstallSteps,
  removeKloudGamesService,
  POWERSHELL_BLOCKED_MESSAGE,
  uninstaller,
  type UninstallProgress
} from './uninstaller'

const {
  findKloudGamesExeMock,
  isKloudGamesRunningMock,
  resetKloudGamesStateMock,
  getKloudGamesUninstallLogPathMock,
  appendKloudGamesUninstallLogMock,
  detectKloudGamesMock,
  verifyKloudGamesRemovalMock,
  findHubUninstallerMock,
  electronMock
} = vi.hoisted(() => ({
  findKloudGamesExeMock: vi.fn(),
  isKloudGamesRunningMock: vi.fn(),
  resetKloudGamesStateMock: vi.fn(() => true),
  getKloudGamesUninstallLogPathMock: vi.fn(),
  appendKloudGamesUninstallLogMock: vi.fn(),
  detectKloudGamesMock: vi.fn(),
  verifyKloudGamesRemovalMock: vi.fn(),
  findHubUninstallerMock: vi.fn(),
  electronMock: { isPackaged: false, appDataPath: 'C:\\fake' }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged
    },
    getPath: () => electronMock.appDataPath
  },
  shell: { openPath: vi.fn() },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() }
}))

vi.mock('child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }))

vi.mock('./kloudGames', () => ({
  findKloudGamesExe: findKloudGamesExeMock,
  findKloudGamesMsi: vi.fn(() => null),
  getKloudGamesUninstallLogPath: getKloudGamesUninstallLogPathMock,
  isKloudGamesRunning: isKloudGamesRunningMock,
  invalidateKloudGamesRunningCache: vi.fn(),
  looksLikeUacDenied: (output: string): boolean =>
    /cancelad|cancelled|canceled|1223|operation was canceled|operação foi cancelada/i.test(
      output ?? ''
    ),
  resetKloudGamesState: resetKloudGamesStateMock,
  appendKloudGamesUninstallLog: appendKloudGamesUninstallLogMock
}))

vi.mock('./uninstallDetection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./uninstallDetection')>()
  return {
    ...actual,
    detectKloudGames: detectKloudGamesMock,
    findHubUninstaller: findHubUninstallerMock
  }
})

vi.mock('./uninstallVerify', () => ({
  verifyKloudGamesRemoval: verifyKloudGamesRemovalMock
}))

// A captura de FPS é uma tarefa do Windows: nos testes ela nunca é consultada
// de verdade (schtasks real + possível UAC), e o fluxo segue sem pendência.
vi.mock('./fps/agent', () => ({
  isFpsAgentInstalled: vi.fn(async () => false),
  removeFpsAgent: vi.fn(async () => ({ ok: true }))
}))

const { execFileSync, spawn } = await import('child_process')

const INSTALLED = {
  status: 'installed' as const,
  exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
  service: 'stopped' as const,
  entry: {
    productCode: '{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
    uninstallString: 'MsiExec.exe /I{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
    displayName: 'Kloud Games',
    scope: 'machine' as const
  }
}

function fakeChildThatClosesWith(code: number | null, stdoutText = '') {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  process.nextTick(() => {
    if (stdoutText) child.stdout.emit('data', Buffer.from(stdoutText))
    child.emit('close', code)
  })
  return child
}

beforeEach(() => {
  vi.mocked(execFileSync).mockReset()
  vi.mocked(spawn).mockReset()
  findKloudGamesExeMock.mockReset()
  isKloudGamesRunningMock.mockReset()
  resetKloudGamesStateMock.mockReset()
  getKloudGamesUninstallLogPathMock.mockReset()
  appendKloudGamesUninstallLogMock.mockReset()
  detectKloudGamesMock.mockReset()
  verifyKloudGamesRemovalMock.mockReset()
  findHubUninstallerMock.mockReset()

  electronMock.isPackaged = false
  electronMock.appDataPath = 'C:\\fake'
  getKloudGamesUninstallLogPathMock.mockReturnValue('C:\\fake\\logs\\kloud-games-uninstall.log')
  verifyKloudGamesRemovalMock.mockReturnValue({
    exeGone: true,
    serviceGone: true,
    registryGone: true,
    shortcutsGone: true,
    tempCleaned: true,
    configGone: true,
    remaining: [],
    logPath: 'C:\\fake\\logs\\kloud-games-uninstall.log'
  })
  detectKloudGamesMock.mockReturnValue(INSTALLED)
  findHubUninstallerMock.mockReturnValue({
    available: true,
    uninstallerPath: 'C:\\fake\\Uninstall Kolnd Hub.exe',
    source: 'default-path',
    entry: null
  })
  findKloudGamesExeMock.mockReturnValue(null)
  isKloudGamesRunningMock.mockReturnValue(false)
  resetKloudGamesStateMock.mockReturnValue(true)
})

describe('removeKloudGamesService (sc.exe elevado, com confirmação na UI)', () => {
  const SC_STOPPED = [
    'SERVICE_NAME: KLOUD_GAMESsvc',
    '        TYPE               : 10  WIN32_OWN_PROCESS',
    '        STATE              : 1  STOPPED',
    '        WIN32_EXIT_CODE    : 0  (0x0)'
  ].join('\r\n')

  it('serviço já ausente → sucesso idempotente', async () => {
    vi.mocked(spawn).mockImplementation((() => fakeChildThatClosesWith(0)) as never)
    vi.mocked(execFileSync).mockImplementation((() => {
      throw Object.assign(new Error('sc query falhou'), {
        stdout: '[SC] OpenService FALHOU 1060: O servico especificado nao existe.'
      })
    }) as never)

    const result = await removeKloudGamesService()
    expect(result.success).toBe(true)
    expect(result.serviceStatus).toBe('missing')
  })

  it('serviço ainda presente após a tentativa → erro honesto com a instrução manual', async () => {
    vi.mocked(spawn).mockImplementation((() => fakeChildThatClosesWith(0)) as never)
    vi.mocked(execFileSync).mockImplementation(((cmd: string) => {
      if (cmd === 'sc') return SC_STOPPED
      return ''
    }) as never)

    const result = await removeKloudGamesService()
    expect(result.success).toBe(false)
    expect(result.serviceStatus).toBe('stopped')
    expect(result.error).toContain('sc delete KLOUD_GAMESsvc')
  })

  it('UAC negado na elevação → mensagem de UAC, não derruba o processo', async () => {
    vi.mocked(spawn).mockImplementation(
      () =>
        fakeChildThatClosesWith(
          1,
          'Start-Process : A operação foi cancelada pelo usuário.\r\n'
        ) as never
    )
    const result = await removeKloudGamesService()
    expect(result.success).toBe(false)
    expect(result.error).toBe('Você recusou a permissão (UAC). Nada foi removido.')
  })

  it('PowerShell bloqueado → mensagem específica de política', async () => {
    vi.mocked(spawn).mockImplementation(() => fakeChildThatClosesWith(1, '') as never)
    const result = await removeKloudGamesService()
    expect(result.success).toBe(false)
    expect(result.error).toBe(POWERSHELL_BLOCKED_MESSAGE)
  })
})

describe('runHubUninstallSteps — dependências e ordem (T5/T6)', () => {
  it('app não empacotado → erro amigável; nada é destruído e nem a etapa kloud roda', async () => {
    electronMock.isPackaged = false
    const events: UninstallProgress[] = []
    const result = await runHubUninstallSteps(
      { wipeUserData: true, skipKloud: false, backupPath: null },
      (evt) => events.push(evt)
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Desinstalador não encontrado')
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(detectKloudGamesMock).not.toHaveBeenCalled() // parou na etapa 0
    expect(resetKloudGamesStateMock).not.toHaveBeenCalled()
  })

  it('kloud falha (1603) → sequência pausa com pergunta "só o Hub?"; nada do wipe/spawn acontece', async () => {
    electronMock.isPackaged = true
    // O msiexec do fluxo do Kloud Games falha; o spawn mock devolve 1603.
    vi.mocked(spawn).mockImplementation(() => fakeChildThatClosesWith(1603) as never)

    const events: UninstallProgress[] = []
    const result = await runHubUninstallSteps(
      { wipeUserData: true, skipKloud: false, backupPath: 'C:\\backup\\x' },
      (evt) => events.push(evt)
    )

    expect(result.ok).toBe(false)
    expect(result.paused).toBe(true)
    expect(result.kloudError).toBe(
      'O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
    )
    // O NSIS nunca é iniciado; o wipe nunca começa
    const spawned = vi.mocked(spawn).mock.calls.map((c) => String(c[0]))
    expect(spawned.every((cmd) => cmd.includes('powershell'))).toBe(true)
    expect(events.some((evt) => evt.stepId === 'wipe')).toBe(false)
    expect(events.some((evt) => evt.stepId === 'spawn' && evt.status === 'done')).toBe(false)
  })

  it('kloud falha e "Desinstalar só o Hub" (skipKloud:true) → NSIS inicia; skipKloud preserva a escolha de dados', async () => {
    electronMock.isPackaged = true
    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        const child = new EventEmitter() as EventEmitter & { unref: () => void }
        child.unref = vi.fn()
        process.nextTick(() => child.emit('spawn'))
        return child
      }
      // powershell do subfluxo kloud: sucesso (mas skipKloud pula o subfluxo inteiro)
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      process.nextTick(() => child.emit('close', 0))
      return child
    }) as never)

    const events: UninstallProgress[] = []
    const result = await runHubUninstallSteps(
      { wipeUserData: false, skipKloud: true, backupPath: 'C:\\backup\\meu' },
      (evt) => events.push(evt)
    )

    expect(result.ok).toBe(true)
    expect(result.spawned).toBe(true)
    // Com skipKloud, a detecção do Kloud nem roda
    expect(detectKloudGamesMock).not.toHaveBeenCalled()
    // O NSIS foi iniciado desconectado
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'C:\\fake\\Uninstall Kolnd Hub.exe',
      [],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    const kloudEvent = events.find((evt) => evt.stepId === 'kloud')
    expect(kloudEvent?.status).toBe('done')
  })

  it('falha no spawn do NSIS → wipe nem começa e nada é apagado', async () => {
    electronMock.isPackaged = true
    // O spawn do NSIS falha: nenhum dado pode ser apagado antes disso.
    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = vi.fn()
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        process.nextTick(() => child.emit('error', new Error('spawn EACCES')))
      }
      return child
    }) as never)

    const events: UninstallProgress[] = []
    const logs: string[] = []
    const onLog = (line: string): void => {
      logs.push(line)
    }
    uninstaller.on('log', onLog)
    try {
      const result = await runHubUninstallSteps(
        { wipeUserData: true, skipKloud: true, backupPath: null },
        (evt) => events.push(evt)
      )

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Não foi possível iniciar o desinstalador')
      // O wipe não chegou a rodar: sem lista de itens com falha e sem eventos.
      expect(result.wipeErrors).toBeUndefined()
      expect(events.some((evt) => evt.stepId === 'wipe')).toBe(false)
      expect(logs.some((line) => line.startsWith('[wipe]'))).toBe(false)
    } finally {
      uninstaller.off('log', onLog)
    }
  })

  it('ordem: spawn resolvido antes do primeiro evento do wipe', async () => {
    electronMock.isPackaged = true
    // Caminho de dados que não existe: o wipe roda, mas não apaga nada real.
    electronMock.appDataPath = 'C:\\__kolnd_hub_flow_test__'
    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        const child = new EventEmitter() as EventEmitter & { unref: () => void }
        child.unref = vi.fn()
        process.nextTick(() => child.emit('spawn'))
        return child
      }
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      process.nextTick(() => child.emit('close', 0))
      return child
    }) as never)

    const events: UninstallProgress[] = []
    const result = await runHubUninstallSteps(
      { wipeUserData: true, skipKloud: true, backupPath: null },
      (evt) => events.push(evt)
    )

    expect(result.ok).toBe(true)
    const spawnDone = events.findIndex((evt) => evt.stepId === 'spawn' && evt.status === 'done')
    const firstWipe = events.findIndex((evt) => evt.stepId === 'wipe')
    expect(spawnDone).toBeGreaterThanOrEqual(0)
    expect(firstWipe).toBeGreaterThan(spawnDone)
  })

  it('wipeUserData:true apaga %APPDATA%\\kolnd-hub e %APPDATA%\\absolem depois de parar os apps', async () => {
    electronMock.isPackaged = true
    const root = mkdtempSync(join(tmpdir(), 'hub-wipe-absolem-'))
    electronMock.appDataPath = root
    mkdirSync(join(root, 'kolnd-hub', 'logs'), { recursive: true })
    mkdirSync(join(root, 'absolem', 'logs'), { recursive: true })
    writeFileSync(join(root, 'absolem', 'config.json'), '{}')
    writeFileSync(join(root, 'absolem', 'memory.sqlite'), 'db')
    writeFileSync(join(root, 'kolnd-hub', 'config.json'), '{}')

    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = vi.fn()
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        process.nextTick(() => child.emit('spawn'))
      }
      return child
    }) as never)

    const stopApps = vi.fn(async () => undefined)
    try {
      const result = await runHubUninstallSteps(
        { wipeUserData: true, skipKloud: true, backupPath: null },
        () => {},
        { stopApps }
      )

      expect(result.ok).toBe(true)
      expect(stopApps).toHaveBeenCalledTimes(1)
      expect(existsSync(join(root, 'kolnd-hub'))).toBe(false)
      expect(existsSync(join(root, 'absolem'))).toBe(false)
      expect(result.wipeErrors).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('wipeUserData:true com Kloud Games já ausente apaga as configurações por usuário dele', async () => {
    electronMock.isPackaged = true
    const root = mkdtempSync(join(tmpdir(), 'hub-wipe-kloud-config-'))
    const appData = join(root, 'Roaming')
    const localAppData = join(root, 'Local')
    mkdirSync(appData, { recursive: true })
    mkdirSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES'), { recursive: true })
    writeFileSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES', 'config.json'), '{}')
    electronMock.appDataPath = appData
    const savedLocalAppData = process.env.LOCALAPPDATA
    const savedProgramData = process.env.ProgramData
    process.env.LOCALAPPDATA = localAppData
    process.env.ProgramData = join(root, 'ProgramData')
    detectKloudGamesMock.mockReturnValue({
      status: 'missing',
      exePath: null,
      service: 'missing',
      entry: null
    })

    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = vi.fn()
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        process.nextTick(() => child.emit('spawn'))
      }
      return child
    }) as never)

    try {
      const result = await runHubUninstallSteps(
        { wipeUserData: true, skipKloud: false, backupPath: null },
        () => {}
      )

      expect(result.ok).toBe(true)
      expect(existsSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES'))).toBe(false)
    } finally {
      process.env.LOCALAPPDATA = savedLocalAppData
      process.env.ProgramData = savedProgramData
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skipKloud:true preserva as configurações do Kloud Games (produto continua instalado)', async () => {
    electronMock.isPackaged = true
    const root = mkdtempSync(join(tmpdir(), 'hub-skip-kloud-config-'))
    const localAppData = join(root, 'Local')
    mkdirSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES'), { recursive: true })
    writeFileSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES', 'config.json'), '{}')
    electronMock.appDataPath = join(root, 'Roaming')
    mkdirSync(join(root, 'Roaming'), { recursive: true })
    const savedLocalAppData = process.env.LOCALAPPDATA
    const savedProgramData = process.env.ProgramData
    process.env.LOCALAPPDATA = localAppData
    process.env.ProgramData = join(root, 'ProgramData')

    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = vi.fn()
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        process.nextTick(() => child.emit('spawn'))
      }
      return child
    }) as never)

    try {
      const result = await runHubUninstallSteps(
        { wipeUserData: true, skipKloud: true, backupPath: null },
        () => {}
      )

      expect(result.ok).toBe(true)
      expect(existsSync(join(localAppData, 'LizardByte', 'KLOUD_GAMES', 'config.json'))).toBe(true)
    } finally {
      process.env.LOCALAPPDATA = savedLocalAppData
      process.env.ProgramData = savedProgramData
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('wipeUserData:false preserva %APPDATA%\\absolem (a opção "manter" vale para o Absolem)', async () => {
    electronMock.isPackaged = true
    const root = mkdtempSync(join(tmpdir(), 'hub-keep-absolem-'))
    electronMock.appDataPath = root
    mkdirSync(join(root, 'absolem'), { recursive: true })
    writeFileSync(join(root, 'absolem', 'config.json'), '{}')

    vi.mocked(spawn).mockImplementation(((cmd: unknown) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = vi.fn()
      if (String(cmd).toLowerCase().includes('uninstall kolnd hub')) {
        process.nextTick(() => child.emit('spawn'))
      }
      return child
    }) as never)

    const stopApps = vi.fn(async () => undefined)
    try {
      const result = await runHubUninstallSteps(
        { wipeUserData: false, skipKloud: true, backupPath: null },
        () => {},
        { stopApps }
      )

      expect(result.ok).toBe(true)
      expect(stopApps).not.toHaveBeenCalled()
      expect(existsSync(join(root, 'absolem', 'config.json'))).toBe(true)
      expect(result.wipeErrors).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
