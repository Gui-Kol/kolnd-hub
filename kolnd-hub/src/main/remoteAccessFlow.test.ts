import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ''),
  execFile: vi.fn(),
  httpsGet: vi.fn(),
  existsSync: vi.fn(),
  readFile: vi.fn(),
  networkInterfaces: vi.fn(() => ({})),
  getKloudGamesStatus: vi.fn(),
  prefs: { lastPublicIp: null as string | null, lastPublicIpCheckedAt: null as string | null },
  setRemotePublicIp: vi.fn(),
  setRemoteMode: vi.fn((_value: boolean): { success: boolean; error?: string } => ({
    success: true
  })),
  getRemoteMode: vi.fn(() => false),
  logError: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: { writeText: mocks.clipboardWrite },
  shell: { openExternal: mocks.openExternal, openPath: mocks.openPath }
}))
vi.mock('child_process', () => ({ execFile: mocks.execFile }))
vi.mock('https', () => ({ get: mocks.httpsGet }))
vi.mock('fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('fs/promises', () => ({ readFile: mocks.readFile }))
vi.mock('os', () => ({ networkInterfaces: mocks.networkInterfaces }))
vi.mock('./kloudGames', () => ({ getKloudGamesStatus: mocks.getKloudGamesStatus }))
vi.mock('./store', () => ({
  getRemoteAccessPrefs: () => mocks.prefs,
  getRemoteMode: mocks.getRemoteMode,
  setRemoteMode: mocks.setRemoteMode,
  setRemotePublicIp: mocks.setRemotePublicIp
}))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mocks.logError, debug: vi.fn() }
}))
const netState = vi.hoisted(() => ({
  behaviors: [] as Array<'connect' | 'timeout' | 'error'>
}))

vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net')>()
  const { EventEmitter } = await import('node:events')
  class FakeSocket extends EventEmitter {
    setTimeout(): void {}
    destroy(): void {}
    connect(): void {
      const behavior = netState.behaviors.shift() ?? 'connect'
      process.nextTick(() => this.emit(behavior))
    }
  }
  return { ...actual, Socket: FakeSocket }
})

import {
  checkKloudPorts,
  copyRemoteText,
  fetchPublicIp,
  getRemoteStatus,
  getZeroTierInfo,
  installZeroTier,
  openKloudWebPanel,
  openZeroTier,
  probeTcp,
  requestRemoteMode,
  zeroTierCliInvocation
} from './remoteAccess'
import { KLOUD_TCP_PORTS } from '../shared/remote'

const CLI = 'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat'
const INFO_OK = JSON.stringify({ address: 'ab12cd34ef', online: true, version: '1.14.0' })
const NETWORKS_OK = JSON.stringify([
  {
    id: '8056c2e21c000001',
    name: 'Rede',
    status: 'OK',
    portDeviceName: 'zt0',
    assignedAddresses: ['10.147.17.5/24']
  }
])

let cliPresent: boolean

function execResponder(
  impl: (
    args: string[],
    cb: (error: Error | null, stdout?: string, stderr?: string) => void
  ) => void
): void {
  mocks.execFile.mockImplementation(
    (
      _exe: string,
      args: string[],
      _options: unknown,
      cb: (error: Error | null, stdout?: string, stderr?: string) => void
    ) => {
      process.nextTick(() => impl(args, cb))
    }
  )
}

function fakeHttpsResponse(spec: {
  status?: number
  body?: string
  error?: Error
  hold?: boolean
}): EventEmitter {
  const res = new EventEmitter() as EventEmitter & {
    statusCode?: number
    headers: Record<string, string>
    setEncoding: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
  }
  res.statusCode = spec.status ?? 200
  res.headers = {}
  res.setEncoding = vi.fn()
  res.resume = vi.fn()
  mocks.httpsGet.mockImplementationOnce(
    (_url: string, _options: unknown, cb: (response: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> }
      req.destroy = vi.fn()
      process.nextTick(() => {
        cb(res)
        if (spec.error) res.emit('error', spec.error)
        else if (!spec.hold) res.emit('data', spec.body ?? '')
        if (!spec.hold && !spec.error) res.emit('end')
      })
      return req
    }
  )
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  netState.behaviors = []
  cliPresent = false
  mocks.prefs.lastPublicIp = null
  mocks.prefs.lastPublicIpCheckedAt = null
  mocks.setRemoteMode.mockReturnValue({ success: true })
  mocks.getRemoteMode.mockReturnValue(false)
  mocks.networkInterfaces.mockReturnValue({})
  mocks.getKloudGamesStatus.mockResolvedValue({ installed: true, running: true })
  mocks.existsSync.mockImplementation((path: string) => cliPresent && path === CLI)
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  delete process.env.ZEROTIER_CLI
})

describe('zeroTierCliInvocation', () => {
  it('roda .bat/.cmd via cmd.exe e mantém .exe direto', () => {
    expect(zeroTierCliInvocation('C:\\zt\\zerotier-cli.bat', ['-j', 'info'])).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\zt\\zerotier-cli.bat" -j info'],
      verbatim: true
    })
    expect(zeroTierCliInvocation('C:\\zt\\zerotier-cli.exe', ['-j'])).toEqual({
      command: 'C:\\zt\\zerotier-cli.exe',
      args: ['-j'],
      verbatim: false
    })
  })
})

describe('getZeroTierInfo', () => {
  it('sem CLI instalado devolve installed=false', async () => {
    const info = await getZeroTierInfo()
    expect(info.installed).toBe(false)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('lê info e redes e marca conectado quando há rede OK com IPv4', async () => {
    cliPresent = true
    process.env.ZEROTIER_CLI = CLI
    execResponder((args, cb) => {
      if (args.join(' ').includes('listnetworks')) cb(null, NETWORKS_OK, '')
      else cb(null, `aviso do cli\n${INFO_OK}`, '')
    })

    const info = await getZeroTierInfo()
    expect(info).toMatchObject({
      installed: true,
      connected: true,
      online: true,
      nodeId: 'ab12cd34ef',
      ipv4: '10.147.17.5',
      networkId: '8056c2e21c000001',
      exePath: CLI
    })
  })

  it('erro de autenticação tenta de novo com o token do usuário', async () => {
    cliPresent = true
    process.env.ZEROTIER_CLI = CLI
    process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local'
    mocks.readFile.mockResolvedValue('abcdef0123456789abcdef01\n')

    let authAttempts = 0
    execResponder((args, cb) => {
      if (args.join(' ').includes('-Tabcd')) {
        if (args.join(' ').includes('listnetworks')) cb(null, NETWORKS_OK, '')
        else cb(null, INFO_OK, '')
        return
      }
      authAttempts += 1
      cb(new Error('exit 1'), '', 'authtoken not readable')
    })

    const info = await getZeroTierInfo()
    expect(authAttempts).toBe(2)
    expect(info.connected).toBe(true)
    expect(mocks.readFile).toHaveBeenCalled()
    delete process.env.LOCALAPPDATA
  })

  it('sem token, expõe o erro do CLI de forma concisa', async () => {
    cliPresent = true
    process.env.ZEROTIER_CLI = CLI
    mocks.readFile.mockRejectedValue(new Error('EACCES'))
    execResponder((_args, cb) => {
      cb(new Error('exit 1'), '', 'authtoken not readable '.repeat(30))
    })

    const info = await getZeroTierInfo()
    expect(info.installed).toBe(true)
    expect(info.error).toContain('authtoken not readable')
    expect(info.error?.length ?? 0).toBeLessThanOrEqual(301)
  })
})

describe('probeTcp / checkKloudPorts', () => {
  it('connect → true, timeout/erro → false', async () => {
    netState.behaviors = ['connect', 'timeout', 'error']
    await expect(probeTcp('127.0.0.1', 47984)).resolves.toBe(true)
    await expect(probeTcp('127.0.0.1', 47984)).resolves.toBe(false)
    await expect(probeTcp('127.0.0.1', 47984)).resolves.toBe(false)
  })

  it('testa localhost e o IP do ZeroTier quando informado', async () => {
    const result = await checkKloudPorts('10.147.17.5')
    expect(result.map((entry) => entry.target)).toEqual(['localhost', 'zerotier'])
    expect(result[0].probes).toHaveLength(KLOUD_TCP_PORTS.length)

    const onlyLocal = await checkKloudPorts('127.0.0.1')
    expect(onlyLocal).toHaveLength(1)
    const none = await checkKloudPorts(null)
    expect(none).toHaveLength(1)
  })
})

describe('getRemoteStatus', () => {
  it('monta a fotografia completa e trata falha do Kloud Games', async () => {
    mocks.prefs.lastPublicIp = '203.0.113.10'
    mocks.prefs.lastPublicIpCheckedAt = '2026-01-01T00:00:00.000Z'
    mocks.getKloudGamesStatus.mockRejectedValueOnce(new Error('sem status'))

    const status = await getRemoteStatus()
    expect(status.zerotier.installed).toBe(false)
    expect(status.kloud).toEqual({ installed: false, running: false })
    expect(status.ports).toHaveLength(1)
    expect(status.publicIp).toMatchObject({
      address: '203.0.113.10',
      checkedAt: '2026-01-01T00:00:00.000Z'
    })
    expect(mocks.logError).toHaveBeenCalled()
  })
})

describe('requestRemoteMode', () => {
  const info = (overrides: Record<string, unknown>) =>
    ({
      installed: true,
      connected: true,
      online: true,
      ipv4: '10.147.17.5',
      ipv6: null,
      ...overrides
    }) as never

  it('valor inválido → erro', async () => {
    await expect(requestRemoteMode('sim')).resolves.toEqual({
      success: false,
      enabled: false,
      reason: 'invalid',
      error: 'Valor inválido para o modo remoto.'
    })
  })

  it('desligar persiste e não consulta o ZeroTier', async () => {
    await expect(requestRemoteMode(false)).resolves.toEqual({ success: true, enabled: false })
    expect(mocks.setRemoteMode).toHaveBeenCalledWith(false)

    mocks.setRemoteMode.mockReturnValueOnce({ success: false, error: 'store off' })
    await expect(requestRemoteMode(false)).resolves.toEqual({
      success: false,
      enabled: false,
      reason: 'store-unavailable',
      error: 'store off'
    })
  })

  it('ligar exige ZeroTier instalado, conectado e store disponível', async () => {
    await expect(
      requestRemoteMode(true, async () => info({ installed: false }))
    ).resolves.toMatchObject({ reason: 'zerotier-missing' })

    await expect(
      requestRemoteMode(true, async () => info({ connected: false, online: false }))
    ).resolves.toMatchObject({
      reason: 'zerotier-disconnected',
      error: expect.stringContaining('Abra o ZeroTier')
    })

    await expect(
      requestRemoteMode(true, async () => info({ connected: false, online: true }))
    ).resolves.toMatchObject({
      reason: 'zerotier-disconnected',
      error: expect.stringContaining('Ingresse em uma rede')
    })

    mocks.setRemoteMode.mockReturnValueOnce({ success: false, error: 'store off' })
    await expect(requestRemoteMode(true, async () => info({}))).resolves.toMatchObject({
      reason: 'store-unavailable'
    })
  })

  it('ligar com sucesso devolve o endereço preferido', async () => {
    await expect(requestRemoteMode(true, async () => info({}))).resolves.toEqual({
      success: true,
      enabled: true,
      address: '10.147.17.5'
    })
    expect(mocks.setRemoteMode).toHaveBeenLastCalledWith(true)

    await expect(
      requestRemoteMode(true, async () => info({ ipv4: null, ipv6: 'fd00::1' }))
    ).resolves.toMatchObject({ address: 'fd00::1' })
  })
})

describe('fetchPublicIp', () => {
  it('consulta, valida e persiste um IPv4 público', async () => {
    fakeHttpsResponse({ body: JSON.stringify({ ip: '203.0.113.10' }) })
    const result = await fetchPublicIp()
    expect(result).toMatchObject({ success: true, ip: '203.0.113.10' })
    expect(mocks.setRemotePublicIp).toHaveBeenCalledWith('203.0.113.10', expect.any(String))
  })

  it('HTTP diferente de 200 → erro', async () => {
    fakeHttpsResponse({ status: 500 })
    await expect(fetchPublicIp()).resolves.toEqual({
      success: false,
      error: 'Serviço respondeu HTTP 500.'
    })
  })

  it('IP inválido, JSON inválido e erro de rede', async () => {
    fakeHttpsResponse({ body: JSON.stringify({ ip: 'não-é-ip' }) })
    await expect(fetchPublicIp()).resolves.toMatchObject({ success: false })

    fakeHttpsResponse({ body: '{quebrado' })
    await expect(fetchPublicIp()).resolves.toEqual({
      success: false,
      error: 'Não foi possível interpretar a resposta.'
    })

    fakeHttpsResponse({ error: new Error('ECONNRESET') })
    await expect(fetchPublicIp()).resolves.toMatchObject({
      success: false,
      error: 'ECONNRESET'
    })
  })

  it('timeout do serviço → erro amigável', async () => {
    const res = fakeHttpsResponse({ hold: true })
    void res
    const promise = fetchPublicIp()
    const req = mocks.httpsGet.mock.results[0].value as EventEmitter
    req.emit('timeout')
    await expect(promise).resolves.toEqual({
      success: false,
      error: 'Tempo esgotado ao consultar o IP público.'
    })
  })
})

describe('installZeroTier', () => {
  it('já instalado → installedNow=false sem rodar winget', async () => {
    cliPresent = true
    process.env.ZEROTIER_CLI = CLI
    await expect(installZeroTier()).resolves.toEqual({ success: true, installedNow: false })
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('sem winget → erro com link de download', async () => {
    execResponder((_args, cb) => cb(new Error('ENOENT'), '', ''))
    await expect(installZeroTier()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('winget não encontrado')
    })
  })

  it('winget instala e o CLI aparece → installedNow=true', async () => {
    execResponder((args, cb) => {
      if (args.includes('--version')) {
        cb(null, 'v1.29', '')
        return
      }
      cliPresent = true
      cb(null, '', '')
    })
    await expect(installZeroTier()).resolves.toEqual({ success: true, installedNow: true })
  })

  it('winget falha e o CLI continua ausente → erro conciso', async () => {
    execResponder((args, cb) => {
      if (args.includes('--version')) cb(null, 'v1.29', '')
      else cb(new Error('exit 1'), '', 'instalação falhou')
    })
    await expect(installZeroTier()).resolves.toEqual({
      success: false,
      error: 'instalação falhou'
    })
  })
})

describe('openZeroTier / openKloudWebPanel / copyRemoteText', () => {
  it('sem GUI abre a página de download', async () => {
    await expect(openZeroTier()).resolves.toEqual({ success: true, opened: 'download' })
    expect(mocks.openExternal).toHaveBeenCalled()
  })

  it('com GUI, falha de openPath vira erro', async () => {
    cliPresent = true
    const gui = 'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier_desktop_ui.exe'
    mocks.existsSync.mockImplementation((path: string) => path === gui)
    await expect(openZeroTier()).resolves.toEqual({ success: true, opened: 'app' })

    mocks.openPath.mockResolvedValueOnce('sem associação')
    await expect(openZeroTier()).resolves.toEqual({ success: false, error: 'sem associação' })
  })

  it('painel web abre e converte exceção em erro', async () => {
    await expect(openKloudWebPanel()).resolves.toEqual({ success: true, opened: 'web' })

    mocks.openExternal.mockRejectedValueOnce(new Error('bloqueado'))
    await expect(openKloudWebPanel()).resolves.toEqual({ success: false, error: 'bloqueado' })
  })

  it('copia texto curto e recusa vazio/longo/não-string', () => {
    expect(copyRemoteText('10.0.0.5')).toEqual({ success: true })
    expect(mocks.clipboardWrite).toHaveBeenCalledWith('10.0.0.5')
    expect(copyRemoteText('')).toMatchObject({ success: false })
    expect(copyRemoteText(null)).toMatchObject({ success: false })
    expect(copyRemoteText('x'.repeat(513))).toMatchObject({ success: false })
  })
})
