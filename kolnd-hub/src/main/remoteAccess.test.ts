import { createServer } from 'net'
import type { AddressInfo } from 'net'
import type { NetworkInterfaceInfo } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ZeroTierInfo } from '../shared/remote'

// O módulo importa Electron/estado do app no topo; os testes abaixo cobrem só
// os helpers puros (detecção de executável, interfaces e probe TCP).
vi.mock('electron', () => ({
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const storeMock = vi.hoisted(() => ({
  setRemoteMode: vi.fn((_value: boolean): { success: boolean; error?: string } => ({
    success: true
  }))
}))

vi.mock('./store', () => ({
  getRemoteAccessPrefs: () => ({ mode: false, lastPublicIp: null, lastPublicIpCheckedAt: null }),
  setRemotePublicIp: vi.fn(),
  getRemoteMode: () => false,
  setRemoteMode: (value: boolean) => storeMock.setRemoteMode(value)
}))
vi.mock('./kloudGames', () => ({
  getKloudGamesStatus: async () => ({
    installed: true,
    running: true,
    exePath: null,
    msiPath: null,
    dir: ''
  })
}))

import {
  collectLocalAddresses,
  findZeroTierCli,
  findZeroTierGui,
  probeTcp,
  requestRemoteMode,
  zeroTierCliInvocation
} from './remoteAccess'

function iface(partial: Partial<NetworkInterfaceInfo> & Pick<NetworkInterfaceInfo, 'address'>) {
  return {
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    ...partial
  } as NetworkInterfaceInfo
}

describe('findZeroTierCli', () => {
  it('acha o .bat do instalador oficial em Program Files (x86)', () => {
    const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' }
    const exists = (path: string): boolean =>
      path === 'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat'
    expect(findZeroTierCli(env, exists)).toBe(
      'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat'
    )
  })

  it('cai para ProgramData e para o PATH (PATH ou Path)', () => {
    const programData = { ProgramData: 'C:\\ProgramData' }
    expect(
      findZeroTierCli(
        programData,
        (path) => path === 'C:\\ProgramData\\ZeroTier\\One\\zerotier-cli.bat'
      )
    ).toBe('C:\\ProgramData\\ZeroTier\\One\\zerotier-cli.bat')

    const env = { Path: 'C:\\Windows;C:\\Tools' }
    const exists = (path: string): boolean => path === 'C:\\Tools\\zerotier-cli.exe'
    expect(findZeroTierCli(env, exists)).toBe('C:\\Tools\\zerotier-cli.exe')

    expect(findZeroTierCli({ ProgramFiles: 'C:\\Program Files' }, () => false)).toBeNull()
    expect(findZeroTierCli({}, () => false)).toBeNull()
  })

  it('respeita ZEROTIER_CLI quando definido', () => {
    const exists = (path: string): boolean => path === 'D:\\Custom\\zerotier-cli.exe'
    expect(findZeroTierCli({ ZEROTIER_CLI: 'D:\\Custom\\zerotier-cli.exe' }, exists)).toBe(
      'D:\\Custom\\zerotier-cli.exe'
    )
  })
})

describe('zeroTierCliInvocation', () => {
  it('executa .exe direto e manda .bat/.cmd por cmd.exe com args verbatim', () => {
    expect(zeroTierCliInvocation('C:\\ZT\\zerotier-cli.exe', ['-j', 'info'])).toEqual({
      command: 'C:\\ZT\\zerotier-cli.exe',
      args: ['-j', 'info'],
      verbatim: false
    })

    const bat = zeroTierCliInvocation('C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat', [
      '-j',
      'info'
    ])
    expect(bat.command).toBe('cmd.exe')
    expect(bat.verbatim).toBe(true)
    expect(bat.args).toEqual([
      '/d',
      '/s',
      '/c',
      '"C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat" -j info'
    ])
  })
})

describe('findZeroTierGui', () => {
  it('procura o executável da bandeja nos dois Program Files', () => {
    const env = { ProgramFiles: 'C:\\Program Files' }
    const gui = 'C:\\Program Files\\ZeroTier\\One\\zerotier_desktop_ui.exe'
    expect(findZeroTierGui(env, (path) => path === gui)).toBe(gui)
    expect(findZeroTierGui({}, () => true)).toBeNull()
  })
})

describe('collectLocalAddresses', () => {
  it('separa LAN, ZeroTier e IPv6 global; ignora loopback e link-local', () => {
    const addresses = collectLocalAddresses(
      {
        Ethernet: [
          iface({ address: '192.168.0.10' }),
          iface({ address: '127.0.0.1', internal: true }),
          iface({ address: 'fe80::1', family: 'IPv6' }),
          iface({ address: '2001:db8::2', family: 'IPv6' })
        ],
        'ZeroTier One [8056c2e21c000001]': [
          iface({ address: '10.147.20.5' }),
          iface({ address: 'fd00::5', family: 'IPv6' })
        ],
        'Sem IP': undefined
      },
      {
        devices: ['ZeroTier One [8056c2e21c000001]'],
        addresses: ['10.147.20.5', 'fd00::5']
      }
    )

    expect(addresses.lan).toEqual(['192.168.0.10'])
    expect(addresses.zerotier).toEqual(['10.147.20.5'])
    expect(addresses.ipv6).toEqual(['2001:db8::2'])
  })

  it('usa os endereços atribuídos quando o nome da interface não ajuda', () => {
    const addresses = collectLocalAddresses(
      {
        Ethernet: [iface({ address: '192.168.0.10' }), iface({ address: '10.147.20.5' })]
      },
      { addresses: ['10.147.20.5'] }
    )

    expect(addresses.lan).toEqual(['192.168.0.10'])
    expect(addresses.zerotier).toEqual(['10.147.20.5'])
  })

  it('devolve listas vazias quando não há interfaces', () => {
    expect(collectLocalAddresses({})).toEqual({ lan: [], zerotier: [], ipv6: [] })
  })
})

describe('probeTcp', () => {
  const servers: Array<ReturnType<typeof createServer>> = []

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve())
          })
      )
    )
  })

  it('detecta porta aberta em localhost e porta fechada', async () => {
    const server = createServer()
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port

    await expect(probeTcp('127.0.0.1', port, 1000)).resolves.toBe(true)

    await new Promise<void>((resolve) => server.close(() => resolve()))
    servers.splice(servers.indexOf(server), 1)

    await expect(probeTcp('127.0.0.1', port, 500)).resolves.toBe(false)
  })
})

describe('requestRemoteMode', () => {
  const connected: ZeroTierInfo = {
    installed: true,
    connected: true,
    online: true,
    nodeId: 'a1b2c3d4e5',
    version: '1.16.2',
    network: 'casa',
    networkId: '8056c2e21c000001',
    networkStatus: 'OK',
    ipv4: '10.147.20.5',
    ipv6: null,
    exePath: 'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat'
  }

  beforeEach(() => {
    storeMock.setRemoteMode.mockClear()
    storeMock.setRemoteMode.mockReturnValue({ success: true })
  })

  it('recusa valor não booleano sem tocar no store', async () => {
    const result = await requestRemoteMode('sim', async () => connected)
    expect(result).toMatchObject({ success: false, enabled: false, reason: 'invalid' })
    expect(storeMock.setRemoteMode).not.toHaveBeenCalled()
  })

  it('recusa ligar sem ZeroTier instalado', async () => {
    const missing = await requestRemoteMode(true, async () => ({
      ...connected,
      installed: false,
      connected: false,
      online: false
    }))
    expect(missing).toMatchObject({ success: false, reason: 'zerotier-missing' })
    expect(storeMock.setRemoteMode).not.toHaveBeenCalled()
  })

  it('recusa ligar com serviço desligado ou sem rede ingressada', async () => {
    const offline = await requestRemoteMode(true, async () => ({
      ...connected,
      connected: false,
      online: false,
      ipv4: null
    }))
    expect(offline).toMatchObject({ success: false, reason: 'zerotier-disconnected' })
    expect(offline.error).toMatch(/Abra o ZeroTier/)

    const noNetwork = await requestRemoteMode(true, async () => ({
      ...connected,
      connected: false,
      network: null,
      networkId: null,
      networkStatus: null,
      ipv4: null,
      ipv6: null
    }))
    expect(noNetwork).toMatchObject({ success: false, reason: 'zerotier-disconnected' })
    expect(noNetwork.error).toMatch(/Ingresse em uma rede/)

    expect(storeMock.setRemoteMode).not.toHaveBeenCalled()
  })

  it('ativa com ZeroTier conectado e devolve o endereço para o Moonlight', async () => {
    const result = await requestRemoteMode(true, async () => connected)
    expect(result).toEqual({ success: true, enabled: true, address: '10.147.20.5' })
    expect(storeMock.setRemoteMode).toHaveBeenCalledWith(true)
  })

  it('usa o IPv6 quando a rede não atribuiu IPv4', async () => {
    const result = await requestRemoteMode(true, async () => ({
      ...connected,
      ipv4: null,
      ipv6: 'fd00::5'
    }))
    expect(result).toEqual({ success: true, enabled: true, address: 'fd00::5' })
  })

  it('desativa sem consultar o ZeroTier', async () => {
    const getInfo = vi.fn(async () => connected)
    const result = await requestRemoteMode(false, getInfo)
    expect(result).toEqual({ success: true, enabled: false })
    expect(getInfo).not.toHaveBeenCalled()
    expect(storeMock.setRemoteMode).toHaveBeenCalledWith(false)
  })

  it('reporta falha do store ao persistir', async () => {
    storeMock.setRemoteMode.mockReturnValueOnce({ success: false, error: 'sem disco' })
    const result = await requestRemoteMode(true, async () => connected)
    expect(result).toMatchObject({
      success: false,
      enabled: false,
      reason: 'store-unavailable',
      error: 'sem disco'
    })
  })
})
