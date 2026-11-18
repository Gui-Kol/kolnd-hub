import { createServer } from 'net'
import type { AddressInfo } from 'net'
import type { NetworkInterfaceInfo } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TailscaleInfo } from '../shared/remote'

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
  findTailscaleExe,
  probeTcp,
  requestRemoteMode
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

describe('findTailscaleExe', () => {
  it('acha em Program Files sem depender do PATH', () => {
    const env = { ProgramFiles: 'C:\\Program Files' }
    const exists = (path: string): boolean => path === 'C:\\Program Files\\Tailscale\\tailscale.exe'
    expect(findTailscaleExe(env, exists)).toBe('C:\\Program Files\\Tailscale\\tailscale.exe')
  })

  it('cai para o PATH (PATH ou Path) e devolve null quando não existe', () => {
    const env = { Path: 'C:\\Windows;C:\\Tools' }
    const exists = (path: string): boolean => path === 'C:\\Tools\\tailscale.exe'
    expect(findTailscaleExe(env, exists)).toBe('C:\\Tools\\tailscale.exe')

    expect(findTailscaleExe({ ProgramFiles: 'C:\\Program Files' }, () => false)).toBeNull()
    expect(findTailscaleExe({}, () => false)).toBeNull()
  })

  it('respeita TAILSCALE_EXE quando definido', () => {
    const exists = (path: string): boolean => path === 'D:\\Custom\\tailscale.exe'
    expect(findTailscaleExe({ TAILSCALE_EXE: 'D:\\Custom\\tailscale.exe' }, exists)).toBe(
      'D:\\Custom\\tailscale.exe'
    )
  })
})

describe('collectLocalAddresses', () => {
  it('separa LAN, tailnet e IPv6 global; ignora loopback e link-local', () => {
    const addresses = collectLocalAddresses({
      Ethernet: [
        iface({ address: '192.168.0.10' }),
        iface({ address: '127.0.0.1', internal: true }),
        iface({ address: 'fe80::1', family: 'IPv6' }),
        iface({ address: '2001:db8::2', family: 'IPv6' })
      ],
      Tailscale: [iface({ address: '100.90.80.70' })],
      'Sem IP': undefined
    })

    expect(addresses.lan).toEqual(['192.168.0.10'])
    expect(addresses.tailscale).toEqual(['100.90.80.70'])
    expect(addresses.ipv6).toEqual(['2001:db8::2'])
  })

  it('devolve listas vazias quando não há interfaces', () => {
    expect(collectLocalAddresses({})).toEqual({ lan: [], tailscale: [], ipv6: [] })
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
  const connected: TailscaleInfo = {
    installed: true,
    connected: true,
    backendState: 'Running',
    hostname: 'desktop',
    dnsName: 'desktop.tail.ts.net',
    ipv4: '100.90.80.70',
    ipv6: null,
    tailnet: 'tail.ts.net',
    onlinePeers: 1,
    exePath: 'C:\\Program Files\\Tailscale\\tailscale.exe'
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

  it('recusa ligar sem Tailscale instalado ou conectado', async () => {
    const missing = await requestRemoteMode(true, async () => ({
      ...connected,
      installed: false,
      connected: false
    }))
    expect(missing).toMatchObject({ success: false, reason: 'tailscale-missing' })

    const offline = await requestRemoteMode(true, async () => ({
      ...connected,
      connected: false,
      backendState: 'NeedsLogin'
    }))
    expect(offline).toMatchObject({ success: false, reason: 'tailscale-disconnected' })
    expect(storeMock.setRemoteMode).not.toHaveBeenCalled()
  })

  it('ativa com Tailscale conectado e devolve o endereço para o Moonlight', async () => {
    const result = await requestRemoteMode(true, async () => connected)
    expect(result).toEqual({ success: true, enabled: true, address: '100.90.80.70' })
    expect(storeMock.setRemoteMode).toHaveBeenCalledWith(true)
  })

  it('desativa sem consultar o Tailscale', async () => {
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
