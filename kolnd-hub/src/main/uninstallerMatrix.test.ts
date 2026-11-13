// Matriz de erros e casos de borda da T6 — fluxos do Uninstaller com mocks
// de registro/serviço/exe/taskkill/MSI. Nenhum teste aqui executa nada
// destrutivo de verdade: o alvo de Program Files nunca é apagado (o gate de
// `isProgramFilesKloudGamesDir` é testado à parte e a recusa é verificada
// com pastas temporárias).
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  mapMsiexecExitCode,
  isProgramFilesKloudGamesDir,
  deleteKloudGamesOrphanFolder,
  looksLikePowerShellBlocked,
  POWERSHELL_BLOCKED_MESSAGE,
  KLOUD_KILL_FAILED_MESSAGE,
  Uninstaller,
  type MsiexecExitCodeResult
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
  electronMock: { isPackaged: false }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return electronMock.isPackaged
    },
    getPath: () => 'C:\\fake',
    get name() {
      return 'fake'
    }
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

const { execFileSync, spawn } = await import('child_process')

const ALL_GONE = {
  exeGone: true,
  serviceGone: true,
  registryGone: true,
  shortcutsGone: true,
  tempCleaned: true,
  remaining: [],
  logPath: 'C:\\fake\\logs\\kloud-games-uninstall.log'
}

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
  vi.mocked(spawn).mockImplementation((() => {
    process.nextTick(() => {
      if (stdoutText) child.stdout.emit('data', Buffer.from(stdoutText))
      child.emit('close', code)
    })
    return child
  }) as never)
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

  getKloudGamesUninstallLogPathMock.mockReturnValue('C:\\fake\\logs\\kloud-games-uninstall.log')
  verifyKloudGamesRemovalMock.mockReturnValue({ ...ALL_GONE })
  detectKloudGamesMock.mockReturnValue(INSTALLED)
  findHubUninstallerMock.mockReturnValue({
    available: true,
    uninstallerPath: 'C:\\fake\\Uninstall Kolnd Hub.exe',
    source: 'default-path',
    entry: null
  })
  electronMock.isPackaged = false
  findKloudGamesExeMock.mockReturnValue(null)
  isKloudGamesRunningMock.mockReturnValue(false)
  resetKloudGamesStateMock.mockReturnValue(true)
})

describe('matriz msiexec — mensagens pt-BR exatas', () => {
  const EXACT: Array<[number | null, string]> = [
    [1223, 'Você recusou a permissão (UAC). Nada foi removido.'],
    [
      1618,
      'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'
    ],
    [
      1500,
      'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'
    ],
    [
      1603,
      'O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
    ],
    [1625, 'Esta máquina bloqueia desinstalações por política de grupo. Fale com o administrador.'],
    [3010, 'Reinicie o PC para concluir a remoção.'],
    [1641, 'Reinicie o PC para concluir a remoção.'],
    [1605, 'O Kloud Games já não constava como instalado — nada foi removido.'],
    [1612, 'O Kloud Games já não constava como instalado — nada foi removido.'],
    [1638, 'Já existe uma versão mais nova do Kloud Games instalada; nada foi removido.'],
    [1602, 'Cancelado por você.']
  ]

  it.each(EXACT)('código %s → mensagem exata', (code, message) => {
    expect(mapMsiexecExitCode(code).message).toBe(message)
  })
})

describe('fluxo uninstall — vertentes da matriz', () => {
  it.each([
    [0, true, false],
    [3010, true, true],
    [1641, true, true],
    [1605, true, false],
    [1612, true, false]
  ] as Array<[number, boolean, boolean]>)(
    'código %s → success %s (needsReboot %s)',
    async (code, success, needsReboot) => {
      fakeChildThatClosesWith(code)
      const u = new Uninstaller()
      const report = await u.uninstall(() => {})
      expect(report.success).toBe(success)
      expect(report.needsReboot).toBe(needsReboot)
    }
  )

  it('1638 (versão mais nova) → sucesso parcial com aviso e laudo anexado', async () => {
    fakeChildThatClosesWith(1638)
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.success).toBe(true)
    expect(report.msiexecKind).toBe('newer-version')
    expect(report.remaining.some((r) => r.includes('versão mais nova'))).toBe(true)
    expect(report.report).toBeDefined()
  })

  it.each([
    [1223, 'uac-denied', 'Você recusou a permissão (UAC). Nada foi removido.'],
    [1602, 'cancelled', 'Cancelado por você.'],
    [
      1618,
      'other-install',
      'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'
    ],
    [
      1500,
      'other-install',
      'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'
    ],
    [
      1603,
      'fatal',
      'O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
    ],
    [
      1625,
      'policy-blocked',
      'Esta máquina bloqueia desinstalações por política de grupo. Fale com o administrador.'
    ]
  ] as Array<[number, MsiexecExitCodeResult['kind'], string]>)(
    'código %s → erro exato (msiexecKind %s)',
    async (code, kind, message) => {
      fakeChildThatClosesWith(code)
      const u = new Uninstaller()
      const report = await u.uninstall(() => {})
      expect(report.success).toBe(false)
      expect(report.error).toBe(message)
      expect(report.msiexecKind).toBe(kind)
      expect(report.report).toBeDefined() // laudo T3 sempre anexado
    }
  )

  it('UAC negado detectado pela saída do PowerShell (código 1 + texto de cancelamento)', async () => {
    fakeChildThatClosesWith(1, 'Start-Process : A operação foi cancelada pelo usuário.\r\n')
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.success).toBe(false)
    expect(report.msiexecKind).toBe('uac-denied')
    expect(report.error).toBe('Você recusou a permissão (UAC). Nada foi removido.')
    expect(report.cancelled).toBe(true)
  })

  it('1602 com saída vazia NÃO é confundido com PowerShell bloqueado', async () => {
    fakeChildThatClosesWith(1602, '')
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.msiexecKind).toBe('cancelled')
    expect(report.error).toBe('Cancelado por você.')
  })

  it('PowerShell bloqueado (saída vazia + código sem significado) → mensagem específica', async () => {
    fakeChildThatClosesWith(1, '')
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.success).toBe(false)
    expect(report.error).toBe(POWERSHELL_BLOCKED_MESSAGE)
    expect(report.stage).toBe('msiexec')
    expect(report.report).toBeDefined()
  })

  it('PowerShell bloqueado (code null) → mensagem específica', async () => {
    fakeChildThatClosesWith(null, '')
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.error).toBe(POWERSHELL_BLOCKED_MESSAGE)
  })

  it('PowerShell bloqueado com código conhecido (1605) → segue o mapa, não a mensagem de bloqueio', async () => {
    fakeChildThatClosesWith(1605, '')
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(report.success).toBe(true)
    expect(report.msiexecKind).toBe('already-absent')
  })

  it.each([0, 1602, 1618, 1223])(
    'complete é emitido exatamente uma vez para o código %s',
    async (code) => {
      fakeChildThatClosesWith(code)
      const u = new Uninstaller()
      let completions = 0
      u.on('complete', () => {
        completions += 1
      })
      await u.uninstall(() => {})
      expect(completions).toBe(1)
    }
  )

  it('registro órfão (registro sem exe) → fluxo normal pelo msiexec funciona (o produto consta)', async () => {
    detectKloudGamesMock.mockReturnValue({
      status: 'partial',
      exePath: null,
      service: 'missing',
      entry: {
        productCode: '{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
        uninstallString: 'MsiExec.exe /I{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
        displayName: 'Kloud Games',
        scope: 'machine'
      }
    })
    fakeChildThatClosesWith(0)
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1) // o msiexec rodou
    const args = vi.mocked(spawn).mock.calls[0]?.[1] as unknown as string[]
    expect(args[2]).toContain('/x')
    expect(args[2]).toContain('{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}')
    expect(report.success).toBe(true)
  })

  it('exe órfão no fluxo normal → aborta sem msiexec (ProductCode ausente)', async () => {
    // O modal do exe-órfão não oferece "Desinstalar" (vai para uninstallOrphan);
    // este teste prova que o canal normal também não dispara o MSI nesse estado.
    detectKloudGamesMock.mockReturnValue({
      status: 'partial',
      exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
      service: 'missing',
      entry: null
    })
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(report.success).toBe(false)
    expect(report.error).toContain('ProductCode')
  })

  it('taskkill falhando duas vezes → msiexec NUNCA é chamado; instrução manual com o nome do processo', async () => {
    isKloudGamesRunningMock.mockReturnValue(true)
    vi.mocked(execFileSync).mockImplementation((() => {
      throw new Error('Acesso negado')
    }) as never)
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(vi.mocked(spawn)).not.toHaveBeenCalled() // nunca chegou ao MSI
    expect(report.success).toBe(false)
    expect(report.stage).toBe('kill')
    expect(report.error).toBe(KLOUD_KILL_FAILED_MESSAGE)
    expect(report.error).toContain('KLOUD_GAMES.exe')
    expect(report.error).toContain('Gerenciador de Tarefas')
    expect(report.report).toBeDefined() // laudo sempre anexado
  })

  it('taskkill direto falha mas o elevado funciona → o fluxo segue para o msiexec', async () => {
    isKloudGamesRunningMock.mockReturnValue(true)
    vi.mocked(execFileSync).mockImplementation(((cmd: string) => {
      if (cmd === 'taskkill') throw new Error('Acesso negado')
      return '' // taskkill elevado via PowerShell funciona
    }) as never)
    fakeChildThatClosesWith(0)
    const u = new Uninstaller()
    const report = await u.uninstall(() => {})
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1) // apenas o msiexec
    expect(report.success).toBe(true)
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      'taskkill',
      ['/IM', 'KLOUD_GAMES.exe', '/F'],
      expect.objectContaining({ windowsHide: true })
    )
  })
})

describe('looksLikePowerShellBlocked (parser de saída vazia)', () => {
  it.each([
    [{ exitCode: 1, output: '' }, true],
    [{ exitCode: 1, output: '   \r\n' }, true],
    [{ exitCode: null, output: '' }, true],
    [{ exitCode: 1602, output: '' }, true],
    [{ exitCode: 0, output: '' }, false],
    [{ exitCode: 1, output: 'erro qualquer' }, false],
    [{ exitCode: null, output: 'Falha ao iniciar o processo elevado: boom' }, false]
  ] as Array<[{ exitCode: number | null; output: string }, boolean]>)(
    'exitCode=%s output=%j → %s',
    (input, expected) => {
      expect(looksLikePowerShellBlocked(input)).toBe(expected)
    }
  )
})

describe('isProgramFilesKloudGamesDir (trava do alvo da remoção manual)', () => {
  it.each([
    ['C:\\Program Files\\KLOUD_GAMES', true],
    ['c:\\program files\\kloud_games\\', true],
    ['C:\\Program Files\\KLOUD_GAMES\\', true],
    ['C:\\Program Files (x86)\\KLOUD_GAMES', true],
    ['D:\\Program Files\\KLOUD_GAMES', true],
    ['C:\\Program Files', false],
    ['C:\\Program Files\\KLOUD_GAMES\\config', false],
    ['C:\\Program Files\\KLOUD_GAMES-2', false],
    ['C:\\Windows\\System32', false],
    ['C:\\Users\\Teste\\KLOUD_GAMES', false],
    ['\\\\servidor\\share\\KLOUD_GAMES', false],
    ['', false]
  ] as Array<[string, boolean]>)('%s → %s', (input, expected) => {
    expect(isProgramFilesKloudGamesDir(input)).toBe(expected)
  })
})

describe('deleteKloudGamesOrphanFolder (pastas temporárias KLOUD_GAMES)', () => {
  let base: string

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'kg-orphan-test-'))
  })

  it('apaga o conteúdo item a item e remove a raiz vazia', () => {
    const target = join(base, 'KLOUD_GAMES')
    mkdirSync(join(target, 'config'), { recursive: true })
    writeFileSync(join(target, 'KLOUD_GAMES.exe'), 'exe')
    writeFileSync(join(target, 'config', 'settings.json'), '{}')

    const logs: string[] = []
    const result = deleteKloudGamesOrphanFolder(target, (line) => logs.push(line))

    expect(result.errors).toEqual([])
    expect(result.deleted.sort()).toEqual(['KLOUD_GAMES.exe', 'config'])
    expect(existsSync(target)).toBe(false)
    expect(logs.join('')).toContain('Inventário')

    rmSync(base, { recursive: true, force: true })
  })

  it('recusa apagar pasta que não se chama KLOUD_GAMES (trava de basename)', () => {
    const target = join(base, 'outra-coisa')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'importante.txt'), 'não apague')

    const result = deleteKloudGamesOrphanFolder(target, () => {})

    expect(result.errors).toHaveLength(1)
    expect(result.deleted).toEqual([])
    expect(readFileSync(join(target, 'importante.txt'), 'utf8')).toBe('não apague')

    rmSync(base, { recursive: true, force: true })
  })

  it('pasta KLOUD_GAMES inexistente → idempotente, sem erros', () => {
    const result = deleteKloudGamesOrphanFolder(join(base, 'KLOUD_GAMES'), () => {})
    expect(result.errors).toEqual([])
    expect(result.deleted).toEqual([])
    rmSync(base, { recursive: true, force: true })
  })
})

describe('uninstallOrphan (remoção manual parcial)', () => {
  it('registro consta (órfão de registro) → RECUSA; nada é apagado e msiexec é o caminho', async () => {
    detectKloudGamesMock.mockReturnValue({
      status: 'partial',
      exePath: null,
      service: 'missing',
      entry: {
        productCode: '{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
        uninstallString: 'MsiExec.exe /I{512A3D1B-BE16-401B-A0D1-59BBA3942FB8}',
        displayName: 'Kloud Games',
        scope: 'machine'
      }
    })
    const u = new Uninstaller()
    const report = await u.uninstallOrphan(() => {})
    expect(report.success).toBe(false)
    expect(report.error).toContain('consta no registro')
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
    expect(resetKloudGamesStateMock).not.toHaveBeenCalled()
  })

  it('exe fora de C:\\Program Files\\KLOUD_GAMES → RECUSA; a pasta do usuário sobrevive', async () => {
    const victim = mkdtempSync(join(tmpdir(), 'kg-orphan-victim-'))
    const target = join(victim, 'KLOUD_GAMES')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'nao-apague.txt'), 'arquivo da pessoa')
    detectKloudGamesMock.mockReturnValue({
      status: 'partial',
      exePath: join(target, 'KLOUD_GAMES.exe'),
      service: 'missing',
      entry: null
    })

    const u = new Uninstaller()
    const report = await u.uninstallOrphan(() => {})

    expect(report.success).toBe(false)
    expect(report.error).toContain('C:\\Program Files\\KLOUD_GAMES')
    expect(existsSync(join(target, 'nao-apague.txt'))).toBe(true)
    rmSync(victim, { recursive: true, force: true })
  })

  it('só o serviço presente (sem exe, sem registro) → erro honesto com a saída possível', async () => {
    detectKloudGamesMock.mockReturnValue({
      status: 'partial',
      exePath: null,
      service: 'stopped',
      entry: null
    })
    const u = new Uninstaller()
    const report = await u.uninstallOrphan(() => {})
    expect(report.success).toBe(false)
    expect(report.error).toContain('KLOUD_GAMESsvc')
    expect(report.error).toContain('Remover serviço agora')
  })

  it('missing → erro "não está instalado", sem lançar', async () => {
    detectKloudGamesMock.mockReturnValue({
      status: 'missing',
      exePath: null,
      service: 'missing',
      entry: null
    })
    const u = new Uninstaller()
    const report = await u.uninstallOrphan(() => {})
    expect(report.success).toBe(false)
    expect(report.error).toBe('O Kloud Games não está instalado.')
  })

  // Trava de segurança: este teste apaga apenas se a pasta realmente não existir
  // (idempotente). Se você instalar o Kloud Games de verdade nesta máquina, ele é
  // pulado — apagar coisas reais nunca acontece em teste.
  const realProgramFilesInstallExists = existsSync('C:\\Program Files\\KLOUD_GAMES')

  it.skipIf(realProgramFilesInstallExists)(
    'exe órfão no padrão oficial e pasta já inexistente → idempotente, laudo de remoção manual',
    async () => {
      detectKloudGamesMock.mockReturnValue({
        status: 'partial',
        exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
        service: 'missing',
        entry: null
      })
      const u = new Uninstaller()
      const report = await u.uninstallOrphan(() => {})
      expect(report.orphanManual).toBe(true)
      expect(report.report).toBeDefined()
      expect(report.remaining.some((r) => r.includes('Remoção manual parcial'))).toBe(true)
      expect(resetKloudGamesStateMock).toHaveBeenCalled()
    }
  )
})
