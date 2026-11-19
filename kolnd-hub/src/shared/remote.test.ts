import { describe, expect, it } from 'vitest'
import {
  classifyLocalIPv4,
  comparePublicIp,
  flattenAddresses,
  isCGNAT,
  isIPv4,
  parseTailscaleStatus
} from './remote'

describe('isIPv4', () => {
  it('aceita IPv4 canônico e rejeita lixo/zeros à esquerda', () => {
    expect(isIPv4('192.168.0.10')).toBe(true)
    expect(isIPv4('100.64.0.1')).toBe(true)
    expect(isIPv4('255.255.255.255')).toBe(true)
    expect(isIPv4('192.168.0')).toBe(false)
    expect(isIPv4('192.168.0.256')).toBe(false)
    expect(isIPv4('192.168.00.1')).toBe(false)
    expect(isIPv4('fd7a::1')).toBe(false)
    expect(isIPv4(42)).toBe(false)
    expect(isIPv4(null)).toBe(false)
  })
})

describe('isCGNAT', () => {
  it('respeita os limites de 100.64.0.0/10', () => {
    expect(isCGNAT('100.63.255.255')).toBe(false)
    expect(isCGNAT('100.64.0.0')).toBe(true)
    expect(isCGNAT('100.100.100.100')).toBe(true)
    expect(isCGNAT('100.127.255.255')).toBe(true)
    expect(isCGNAT('100.128.0.0')).toBe(false)
    expect(isCGNAT('10.0.0.1')).toBe(false)
  })
})

describe('classifyLocalIPv4', () => {
  it('separa loopback, tailnet, LAN e outros', () => {
    expect(classifyLocalIPv4('127.0.0.1')).toBe('loopback')
    expect(classifyLocalIPv4('100.101.102.103')).toBe('tailscale')
    expect(classifyLocalIPv4('192.168.1.20')).toBe('lan')
    expect(classifyLocalIPv4('10.1.2.3')).toBe('lan')
    expect(classifyLocalIPv4('172.20.1.1')).toBe('lan')
    expect(classifyLocalIPv4('172.32.1.1')).toBe('other')
    expect(classifyLocalIPv4('8.8.8.8')).toBe('other')
    expect(classifyLocalIPv4('nao-e-ip')).toBe('other')
  })
})

describe('comparePublicIp', () => {
  const lan = ['192.168.1.20', 'fd7a:115c:a1e0::1']

  it('detecta IP público direto quando ele está na máquina', () => {
    expect(comparePublicIp('192.168.1.20', lan)).toBe('direct')
  })

  it('detecta CGNAT pela faixa 100.64/10', () => {
    expect(comparePublicIp('100.72.10.4', lan)).toBe('cgnat')
  })

  it('trata o resto como NAT e entrada inválida como unknown', () => {
    expect(comparePublicIp('201.10.20.30', lan)).toBe('nat')
    expect(comparePublicIp('', lan)).toBe('unknown')
    expect(comparePublicIp('nao-e-ip', lan)).toBe('unknown')
  })

  it('compara IPv6 sem diferenciar maiúsculas', () => {
    expect(comparePublicIp('FD7A:115C:A1E0::1', lan)).toBe('direct')
  })
})

describe('parseTailscaleStatus', () => {
  it('extrai IP, MagicDNS, tailnet e peers online', () => {
    const info = parseTailscaleStatus({
      BackendState: 'Running',
      Self: {
        HostName: 'desktop-kolnd',
        DNSName: 'desktop-kolnd.tail1234.ts.net.',
        TailscaleIPs: ['fd7a:115c:a1e0::5', '100.90.80.70'],
        Online: true
      },
      CurrentTailnet: { Name: 'gui@example.com', MagicDNSSuffix: 'tail1234.ts.net' },
      Peer: {
        a: { Online: true },
        b: { Online: false },
        c: { Online: true },
        d: 'lixo'
      }
    })

    expect(info.connected).toBe(true)
    expect(info.ipv4).toBe('100.90.80.70')
    expect(info.ipv6).toBe('fd7a:115c:a1e0::5')
    expect(info.dnsName).toBe('desktop-kolnd.tail1234.ts.net')
    expect(info.hostname).toBe('desktop-kolnd')
    expect(info.tailnet).toBe('tail1234.ts.net')
    expect(info.onlinePeers).toBe(2)
  })

  it('não considera conectado quando o backend exige login', () => {
    const info = parseTailscaleStatus({
      BackendState: 'NeedsLogin',
      Self: { TailscaleIPs: ['100.90.80.70'], Online: false }
    })
    expect(info.connected).toBe(false)
    expect(info.backendState).toBe('NeedsLogin')
    expect(info.dnsName).toBeNull()
    expect(info.onlinePeers).toBe(0)
  })

  it('devolve estado neutro para entrada inválida', () => {
    for (const raw of [null, undefined, 42, 'texto', []]) {
      expect(parseTailscaleStatus(raw)).toEqual({
        connected: false,
        backendState: null,
        hostname: null,
        dnsName: null,
        ipv4: null,
        ipv6: null,
        tailnet: null,
        onlinePeers: 0
      })
    }
  })
})

describe('flattenAddresses', () => {
  it('junta LAN, tailnet e IPv6', () => {
    expect(
      flattenAddresses({ lan: ['192.168.0.2'], tailscale: ['100.64.0.2'], ipv6: ['2001:db8::2'] })
    ).toEqual(['192.168.0.2', '100.64.0.2', '2001:db8::2'])
  })
})
