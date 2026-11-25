import { describe, expect, it } from 'vitest'
import {
  classifyLocalIPv4,
  comparePublicIp,
  flattenAddresses,
  isCGNAT,
  isIPv4,
  isZeroTierInterfaceName,
  parseServiceState,
  parseZeroTierNetworks,
  parseZeroTierStatus,
  parseZeroTierUiOpen
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

describe('isZeroTierInterfaceName', () => {
  it('reconhece o adapter pelo nome ou pelo portDeviceName do CLI', () => {
    expect(isZeroTierInterfaceName('ZeroTier One [8056c2e21c000001]')).toBe(true)
    expect(isZeroTierInterfaceName('zerotier')).toBe(true)
    expect(isZeroTierInterfaceName('VPN ZT', ['vpn zt'])).toBe(true)
    expect(isZeroTierInterfaceName('Ethernet', ['ZeroTier One [abc]'])).toBe(false)
    expect(isZeroTierInterfaceName('', [])).toBe(false)
    expect(isZeroTierInterfaceName(null)).toBe(false)
  })
})

describe('classifyLocalIPv4', () => {
  it('separa loopback, LAN e outros sem contexto', () => {
    expect(classifyLocalIPv4('127.0.0.1')).toBe('loopback')
    expect(classifyLocalIPv4('192.168.1.20')).toBe('lan')
    expect(classifyLocalIPv4('10.1.2.3')).toBe('lan')
    expect(classifyLocalIPv4('172.20.1.1')).toBe('lan')
    expect(classifyLocalIPv4('172.32.1.1')).toBe('other')
    expect(classifyLocalIPv4('100.101.102.103')).toBe('other')
    expect(classifyLocalIPv4('8.8.8.8')).toBe('other')
    expect(classifyLocalIPv4('nao-e-ip')).toBe('other')
  })

  it('usa o nome da interface e os endereços do ZeroTier para separar a VPN', () => {
    const devices = ['ZeroTier One [8056c2e21c000001]']
    expect(
      classifyLocalIPv4('10.147.20.5', {
        interfaceName: 'ZeroTier One [8056c2e21c000001]',
        zerotierDevices: devices
      })
    ).toBe('zerotier')
    expect(
      classifyLocalIPv4('10.147.20.5', {
        interfaceName: 'Ethernet',
        zerotierAddresses: ['10.147.20.5']
      })
    ).toBe('zerotier')
    expect(
      classifyLocalIPv4('10.147.20.6', {
        interfaceName: 'Ethernet',
        zerotierDevices: devices,
        zerotierAddresses: ['10.147.20.5']
      })
    ).toBe('lan')
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

describe('parseZeroTierNetworks', () => {
  it('normaliza a lista do CLI e tira o prefixo CIDR dos endereços', () => {
    const networks = parseZeroTierNetworks([
      {
        id: '8056C2E21C000001',
        name: 'casa',
        status: 'OK',
        portDeviceName: 'ZeroTier One [8056c2e21c000001]',
        allowManaged: true,
        assignedAddresses: ['10.147.20.5/24', 'fd00::5/80', 'lixo', 42]
      }
    ])

    expect(networks).toEqual([
      {
        id: '8056c2e21c000001',
        name: 'casa',
        status: 'OK',
        deviceName: 'ZeroTier One [8056c2e21c000001]',
        assigned: ['10.147.20.5', 'fd00::5'],
        allowManaged: true
      }
    ])
  })

  it('aceita objeto indexado por id (saída alternativa) e preenche o id pela chave', () => {
    const networks = parseZeroTierNetworks({
      aaaaaaaaaaaaaaaa: { name: 'trabalho', status: 'OK', assignedAddresses: ['172.20.0.9/16'] }
    })

    expect(networks).toHaveLength(1)
    expect(networks[0].id).toBe('aaaaaaaaaaaaaaaa')
    expect(networks[0].assigned).toEqual(['172.20.0.9'])
  })

  it('descarta entradas e campos inválidos sem quebrar', () => {
    expect(parseZeroTierNetworks(null)).toEqual([])
    expect(parseZeroTierNetworks('texto')).toEqual([])
    expect(parseZeroTierNetworks([null, 42, 'x'])).toEqual([])

    const [network] = parseZeroTierNetworks([
      { id: 'curto', name: 42, status: 7, portDeviceName: '', assignedAddresses: 'nada' }
    ])
    expect(network).toEqual({
      id: null,
      name: null,
      status: null,
      deviceName: null,
      assigned: [],
      allowManaged: false
    })
  })
})

describe('parseZeroTierStatus', () => {
  const info = {
    address: 'A1B2C3D4E5',
    online: true,
    version: '1.16.2',
    tcpFallbackActive: false
  }

  it('escolhe a primeira rede OK com IPv4 e remove o prefixo', () => {
    const status = parseZeroTierStatus(info, [
      {
        id: '1111111111111111',
        name: 'pendente',
        status: 'REQUESTING_CONFIGURATION',
        assignedAddresses: ['10.0.0.2/24']
      },
      {
        id: '8056c2e21c000001',
        name: 'casa',
        status: 'OK',
        portDeviceName: 'ZeroTier One [8056c2e21c000001]',
        assignedAddresses: ['fd00::5/80', '10.147.20.5/24']
      }
    ])

    expect(status).toEqual({
      connected: true,
      online: true,
      service: 'unknown',
      uiOpen: false,
      nodeId: 'a1b2c3d4e5',
      version: '1.16.2',
      network: 'casa',
      networkId: '8056c2e21c000001',
      networkStatus: 'OK',
      ipv4: '10.147.20.5',
      ipv6: 'fd00::5'
    })
  })

  it('não considera conectado quando o serviço está off-line', () => {
    const status = parseZeroTierStatus({ ...info, online: false }, [
      { id: '8056c2e21c000001', name: 'casa', status: 'OK', assignedAddresses: ['10.147.20.5/24'] }
    ])

    expect(status.connected).toBe(false)
    expect(status.online).toBe(false)
    expect(status.ipv4).toBe('10.147.20.5')
  })

  it('expõe a rede recusada como estado distinto (sem endereço)', () => {
    const status = parseZeroTierStatus(info, [
      { id: '8056c2e21c000001', name: 'casa', status: 'ACCESS_DENIED', assignedAddresses: [] }
    ])

    expect(status.connected).toBe(false)
    expect(status.networkId).toBe('8056c2e21c000001')
    expect(status.networkStatus).toBe('ACCESS_DENIED')
    expect(status.ipv4).toBeNull()
  })

  it('devolve estado neutro para info/redes inválidas', () => {
    const empty = {
      connected: false,
      online: false,
      service: 'unknown',
      uiOpen: false,
      nodeId: null,
      version: null,
      network: null,
      networkId: null,
      networkStatus: null,
      ipv4: null,
      ipv6: null
    }

    for (const raw of [null, undefined, 42, 'texto', []]) {
      expect(parseZeroTierStatus(raw, raw)).toEqual(empty)
    }
    expect(parseZeroTierStatus({ address: 'xyz', online: 'sim', version: 'v1' }, [])).toEqual(empty)
  })
})

describe('parseServiceState', () => {
  it('reconhece sc query, Get-Service e estados pendentes', () => {
    expect(parseServiceState('STATE              : 4  RUNNING')).toBe('running')
    expect(parseServiceState('STATE              : 1  STOPPED')).toBe('stopped')
    expect(parseServiceState('STATE              : 2  START_PENDING')).toBe('running')
    expect(parseServiceState('STATE              : 3  STOP_PENDING')).toBe('stopped')
    expect(
      parseServiceState('Status   Name               DisplayName\nRunning  ZeroTierOneService')
    ).toBe('running')
    expect(parseServiceState('Status: Stopped')).toBe('stopped')
  })

  it('trata saída vazia/ambígua/serviço ausente como unknown', () => {
    expect(parseServiceState('')).toBe('unknown')
    expect(parseServiceState('   ')).toBe('unknown')
    expect(parseServiceState('O serviço especificado não existe como serviço instalado.')).toBe(
      'unknown'
    )
    expect(parseServiceState('ACCESS_DENIED')).toBe('unknown')
  })
})

describe('parseZeroTierUiOpen', () => {
  it('detecta a GUI pela primeira coluna do tasklist CSV', () => {
    expect(
      parseZeroTierUiOpen('"zerotier_desktop_ui.exe","4321","Console","1","10.000 K"\r\n')
    ).toBe(true)
    expect(parseZeroTierUiOpen('"zerotier_desktop_ui.exe","4321","Console"')).toBe(true)
  })

  it('devolve false para lista vazia, outro processo ou saída inesperada', () => {
    expect(
      parseZeroTierUiOpen('INFO: No tasks are running which match the specified criteria.')
    ).toBe(false)
    expect(parseZeroTierUiOpen('"explorer.exe","1000","Console"')).toBe(false)
    expect(parseZeroTierUiOpen('')).toBe(false)
    expect(parseZeroTierUiOpen('   ')).toBe(false)
  })
})

describe('flattenAddresses', () => {
  it('junta LAN, ZeroTier e IPv6', () => {
    expect(
      flattenAddresses({ lan: ['192.168.0.2'], zerotier: ['10.147.20.5'], ipv6: ['2001:db8::2'] })
    ).toEqual(['192.168.0.2', '10.147.20.5', '2001:db8::2'])
  })
})
