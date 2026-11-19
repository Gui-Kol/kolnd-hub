import { describe, expect, it } from 'vitest'
import {
  bestRemoteAddress,
  closedLocalhostPorts,
  networkKindBadge,
  parseRemoteStatus,
  summarizePorts,
  tailscaleBadge
} from './remoteAccess'

const VALID = {
  tailscale: {
    installed: true,
    connected: true,
    backendState: 'Running',
    hostname: 'desktop',
    dnsName: 'desktop.tail.ts.net',
    ipv4: '100.90.80.70',
    ipv6: 'fd7a:115c::1',
    tailnet: 'tail.ts.net',
    onlinePeers: 2,
    exePath: 'C:\\Program Files\\Tailscale\\tailscale.exe'
  },
  addresses: {
    lan: ['192.168.0.10', 'lixo'],
    tailscale: ['100.90.80.70'],
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
      target: 'tailscale',
      host: '100.90.80.70',
      probes: [{ port: 47984, open: true }]
    }
  ],
  publicIp: { address: '100.72.10.4', checkedAt: '2026-11-17T10:00:00.000Z', kind: 'cgnat' }
}

describe('parseRemoteStatus', () => {
  it('normaliza um payload válido e descarta IPs inválidos', () => {
    const status = parseRemoteStatus(VALID)
    expect(status).not.toBeNull()
    expect(status?.tailscale.ipv4).toBe('100.90.80.70')
    expect(status?.addresses.lan).toEqual(['192.168.0.10'])
    expect(status?.ports).toHaveLength(2)
    expect(status?.publicIp.kind).toBe('cgnat')
  })

  it('rejeita payload sem o mínimo (tailscale/kloud) e entrada não-objeto', () => {
    expect(parseRemoteStatus(null)).toBeNull()
    expect(parseRemoteStatus('texto')).toBeNull()
    expect(parseRemoteStatus({})).toBeNull()
    expect(parseRemoteStatus({ ...VALID, tailscale: undefined })).toBeNull()
    expect(parseRemoteStatus({ ...VALID, tailscale: { installed: 'sim' } })).toBeNull()
    expect(parseRemoteStatus({ ...VALID, kloud: undefined })).toBeNull()
  })

  it('cai em defaults seguros quando partes opcionais vêm corrompidas', () => {
    const status = parseRemoteStatus({
      ...VALID,
      addresses: 'lixo',
      ports: [{ target: 'x', host: '', probes: 'nada' }, null],
      publicIp: { address: 42, checkedAt: null, kind: 'inventado' },
      tailscale: { ...VALID.tailscale, onlinePeers: -3, ipv4: '999.1.1.1' }
    })
    expect(status?.addresses).toEqual({ lan: [], tailscale: [], ipv6: [] })
    expect(status?.ports).toEqual([])
    expect(status?.publicIp).toEqual({ address: null, checkedAt: null, kind: 'unknown' })
    expect(status?.tailscale.onlinePeers).toBe(0)
    expect(status?.tailscale.ipv4).toBeNull()
  })
})

describe('tailscaleBadge', () => {
  const base = {
    installed: true,
    connected: false,
    backendState: null,
    hostname: null,
    dnsName: null,
    ipv4: null,
    ipv6: null,
    tailnet: null,
    onlinePeers: 0,
    exePath: null
  }

  it('cobre não instalado, conectado e estados de login', () => {
    expect(tailscaleBadge({ ...base, installed: false })).toEqual({
      tone: 'neutral',
      label: 'Não instalado'
    })
    expect(tailscaleBadge({ ...base, connected: true })).toEqual({
      tone: 'success',
      label: 'Conectado'
    })
    expect(tailscaleBadge({ ...base, backendState: 'NeedsLogin' })).toEqual({
      tone: 'warning',
      label: 'Falta entrar'
    })
    expect(tailscaleBadge({ ...base, backendState: 'Stopped' })).toEqual({
      tone: 'neutral',
      label: 'Desligado'
    })
    expect(tailscaleBadge({ ...base, backendState: 'algo' })).toEqual({
      tone: 'danger',
      label: 'Desconectado'
    })
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
      tailscaleOpen: 1
    })
  })

  it('sem alvos devolve zeros', () => {
    expect(summarizePorts([])).toEqual({ open: 0, total: 0, localhostOpen: 0, tailscaleOpen: 0 })
  })
})

describe('closedLocalhostPorts / bestRemoteAddress', () => {
  it('lista portas fechadas em localhost', () => {
    const status = parseRemoteStatus(VALID)
    expect(closedLocalhostPorts(status?.ports ?? [])).toEqual([47989])
  })

  it('prefere o IPv4 e cai no MagicDNS quando não há IP', () => {
    const status = parseRemoteStatus(VALID)
    expect(bestRemoteAddress(status!.tailscale)).toBe('100.90.80.70')
    expect(bestRemoteAddress({ ...status!.tailscale, ipv4: null, dnsName: 'pc.tail.ts.net' })).toBe(
      'pc.tail.ts.net'
    )
    expect(bestRemoteAddress({ ...status!.tailscale, ipv4: null, dnsName: null })).toBeNull()
  })
})
