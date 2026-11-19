import { describe, expect, it } from 'vitest'
import {
  bestRemoteAddress,
  closedLocalhostPorts,
  networkKindBadge,
  parseRemoteStatus,
  summarizePorts,
  zeroTierBadge
} from './remoteAccess'

const VALID = {
  zerotier: {
    installed: true,
    connected: true,
    online: true,
    nodeId: 'a1b2c3d4e5',
    version: '1.16.2',
    network: 'casa',
    networkId: '8056c2e21c000001',
    networkStatus: 'OK',
    ipv4: '10.147.20.5',
    ipv6: 'fd00::5',
    exePath: 'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat'
  },
  addresses: {
    lan: ['192.168.0.10', 'lixo'],
    zerotier: ['10.147.20.5'],
    ipv6: ['2001:db8::1']
  },
  kloud: { installed: true, running: true },
  ports: [
    {
      target: 'localhost',
      host: '127.0.0.1',
      probes: [
        { port: 47984, open: true },
        { port: 47989, open: false },
        { port: 48010, open: true }
      ]
    },
    {
      target: 'zerotier',
      host: '10.147.20.5',
      probes: [{ port: 47984, open: true }]
    }
  ],
  publicIp: { address: '100.72.10.4', checkedAt: '2026-11-17T10:00:00.000Z', kind: 'cgnat' }
}

describe('parseRemoteStatus', () => {
  it('normaliza um payload válido e descarta IPs inválidos', () => {
    const status = parseRemoteStatus(VALID)
    expect(status).not.toBeNull()
    expect(status?.zerotier.ipv4).toBe('10.147.20.5')
    expect(status?.addresses.lan).toEqual(['192.168.0.10'])
    expect(status?.addresses.zerotier).toEqual(['10.147.20.5'])
    expect(status?.ports).toHaveLength(2)
    expect(status?.publicIp.kind).toBe('cgnat')
  })

  it('rejeita payload sem o mínimo (zerotier/kloud) e entrada não-objeto', () => {
    expect(parseRemoteStatus(null)).toBeNull()
    expect(parseRemoteStatus('texto')).toBeNull()
    expect(parseRemoteStatus({})).toBeNull()
    expect(parseRemoteStatus({ ...VALID, zerotier: undefined })).toBeNull()
    expect(parseRemoteStatus({ ...VALID, zerotier: { installed: 'sim' } })).toBeNull()
    expect(parseRemoteStatus({ ...VALID, kloud: undefined })).toBeNull()
  })

  it('cai em defaults seguros quando partes opcionais vêm corrompidas', () => {
    const status = parseRemoteStatus({
      ...VALID,
      addresses: 'lixo',
      ports: [{ target: 'x', host: '', probes: 'nada' }, null],
      publicIp: { address: 42, checkedAt: null, kind: 'inventado' },
      zerotier: { ...VALID.zerotier, online: 'sim', ipv4: '999.1.1.1' }
    })
    expect(status?.addresses).toEqual({ lan: [], zerotier: [], ipv6: [] })
    expect(status?.ports).toEqual([])
    expect(status?.publicIp).toEqual({ address: null, checkedAt: null, kind: 'unknown' })
    expect(status?.zerotier.online).toBe(false)
    expect(status?.zerotier.ipv4).toBeNull()
  })
})

describe('zeroTierBadge', () => {
  const base = {
    installed: true,
    connected: false,
    online: true,
    nodeId: null,
    version: null,
    network: null,
    networkId: null,
    networkStatus: null,
    ipv4: null,
    ipv6: null,
    exePath: null
  }

  it('cobre não instalado, conectado e serviço desligado', () => {
    expect(zeroTierBadge({ ...base, installed: false })).toEqual({
      tone: 'neutral',
      label: 'Não instalado'
    })
    expect(zeroTierBadge({ ...base, connected: true })).toEqual({
      tone: 'success',
      label: 'Conectado'
    })
    expect(zeroTierBadge({ ...base, online: false })).toEqual({
      tone: 'neutral',
      label: 'Desligado'
    })
  })

  it('distingue instalado sem rede de rede recusada/aguardando', () => {
    expect(zeroTierBadge(base)).toEqual({ tone: 'warning', label: 'Sem rede' })
    expect(zeroTierBadge({ ...base, networkId: '8056c2e21c000001' })).toEqual({
      tone: 'danger',
      label: 'Desconectado'
    })
    expect(
      zeroTierBadge({
        ...base,
        networkId: '8056c2e21c000001',
        networkStatus: 'OK'
      })
    ).toEqual({ tone: 'warning', label: 'Sem endereço' })
    expect(
      zeroTierBadge({
        ...base,
        networkId: '8056c2e21c000001',
        networkStatus: 'REQUESTING_CONFIGURATION'
      })
    ).toEqual({ tone: 'warning', label: 'Conectando' })
    expect(
      zeroTierBadge({
        ...base,
        networkId: '8056c2e21c000001',
        networkStatus: 'ACCESS_DENIED'
      })
    ).toEqual({ tone: 'warning', label: 'Acesso negado' })
    expect(
      zeroTierBadge({
        ...base,
        networkId: '8056c2e21c000001',
        networkStatus: 'AUTHENTICATION_REQUIRED'
      })
    ).toEqual({ tone: 'warning', label: 'Falta autorizar' })
    expect(
      zeroTierBadge({ ...base, networkId: '8056c2e21c000001', networkStatus: 'NOT_FOUND' })
    ).toEqual({ tone: 'danger', label: 'Rede não encontrada' })
  })
})

describe('networkKindBadge', () => {
  it('traduz os quatro tipos de rede', () => {
    expect(networkKindBadge('direct').tone).toBe('success')
    expect(networkKindBadge('nat').tone).toBe('accent')
    expect(networkKindBadge('cgnat').tone).toBe('warning')
    expect(networkKindBadge('unknown')).toEqual({ tone: 'neutral', label: 'Não verificado' })
  })
})

describe('summarizePorts', () => {
  it('conta abertas por alvo e o total esperado', () => {
    const status = parseRemoteStatus(VALID)
    expect(summarizePorts(status?.ports ?? [])).toEqual({
      open: 3,
      total: 4,
      localhostOpen: 2,
      zerotierOpen: 1
    })
  })

  it('sem alvos devolve zeros', () => {
    expect(summarizePorts([])).toEqual({ open: 0, total: 0, localhostOpen: 0, zerotierOpen: 0 })
  })
})

describe('closedLocalhostPorts / bestRemoteAddress', () => {
  it('lista portas fechadas em localhost', () => {
    const status = parseRemoteStatus(VALID)
    expect(closedLocalhostPorts(status?.ports ?? [])).toEqual([47989])
  })

  it('prefere o IPv4 e cai no IPv6 quando não há IPv4', () => {
    const status = parseRemoteStatus(VALID)
    expect(bestRemoteAddress(status!.zerotier)).toBe('10.147.20.5')
    expect(bestRemoteAddress({ ...status!.zerotier, ipv4: null, ipv6: 'fd00::5' })).toBe('fd00::5')
    expect(bestRemoteAddress({ ...status!.zerotier, ipv4: null, ipv6: null })).toBeNull()
  })
})
