import {
  KLOUD_TCP_PORTS,
  isIPv4,
  type LocalAddresses,
  type PortProbe,
  type PortTargetResult,
  type RemoteNetworkKind,
  type RemoteStatus,
  type TailscaleInfo
} from '../../../shared/remote'

/**
 * Validação/normalização do que chega do main (regra do projeto: o renderer
 * não confia no IPC) + rótulos da seção "Acesso remoto".
 *
 * Tudo aqui é puro e testável — nenhum acesso a `window.api`.
 */

export type RemoteTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function ipv4OrNull(value: unknown): string | null {
  return typeof value === 'string' && isIPv4(value) ? value : null
}

function uniqueIPs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
}

function parseAddresses(raw: unknown): LocalAddresses {
  const obj = isRecord(raw) ? raw : {}
  return {
    lan: uniqueIPs(obj.lan).filter(isIPv4),
    tailscale: uniqueIPs(obj.tailscale).filter(isIPv4),
    ipv6: uniqueIPs(obj.ipv6)
  }
}

function parseProbe(raw: unknown): PortProbe | null {
  if (!isRecord(raw)) return null
  if (typeof raw.port !== 'number' || !Number.isInteger(raw.port)) return null
  if (raw.port < 1 || raw.port > 65535) return null
  if (typeof raw.open !== 'boolean') return null
  return { port: raw.port, open: raw.open }
}

function parsePortTargets(raw: unknown): PortTargetResult[] {
  if (!Array.isArray(raw)) return []
  const out: PortTargetResult[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const target =
      item.target === 'tailscale' ? 'tailscale' : item.target === 'localhost' ? 'localhost' : null
    const host = stringOrNull(item.host)
    if (!target || !host) continue
    const probes = Array.isArray(item.probes)
      ? item.probes.map(parseProbe).filter((probe): probe is PortProbe => probe !== null)
      : []
    out.push({ target, host, probes })
  }
  return out
}

function parseTailscale(raw: unknown): TailscaleInfo | null {
  if (!isRecord(raw)) return null
  if (typeof raw.installed !== 'boolean' || typeof raw.connected !== 'boolean') return null

  const info: TailscaleInfo = {
    installed: raw.installed,
    connected: raw.connected,
    backendState: stringOrNull(raw.backendState),
    hostname: stringOrNull(raw.hostname),
    dnsName: stringOrNull(raw.dnsName),
    ipv4: ipv4OrNull(raw.ipv4),
    ipv6: stringOrNull(raw.ipv6),
    tailnet: stringOrNull(raw.tailnet),
    onlinePeers:
      typeof raw.onlinePeers === 'number' &&
      Number.isFinite(raw.onlinePeers) &&
      raw.onlinePeers >= 0
        ? Math.trunc(raw.onlinePeers)
        : 0,
    exePath: stringOrNull(raw.exePath)
  }
  if (typeof raw.error === 'string' && raw.error.trim()) info.error = raw.error.trim()
  return info
}

const NETWORK_KINDS: RemoteNetworkKind[] = ['direct', 'nat', 'cgnat', 'unknown']

/** Retorna `null` se o payload não tiver o mínimo para a tela funcionar. */
export function parseRemoteStatus(raw: unknown): RemoteStatus | null {
  if (!isRecord(raw)) return null

  const tailscale = parseTailscale(raw.tailscale)
  if (!tailscale) return null

  if (!isRecord(raw.kloud)) return null
  const installed = raw.kloud.installed === true
  const running = raw.kloud.running === true

  const publicRaw = isRecord(raw.publicIp) ? raw.publicIp : {}
  const kind = NETWORK_KINDS.includes(publicRaw.kind as RemoteNetworkKind)
    ? (publicRaw.kind as RemoteNetworkKind)
    : 'unknown'

  return {
    tailscale,
    addresses: parseAddresses(raw.addresses),
    kloud: { installed, running },
    ports: parsePortTargets(raw.ports),
    publicIp: {
      address: stringOrNull(publicRaw.address),
      checkedAt: stringOrNull(publicRaw.checkedAt),
      kind
    }
  }
}

/** Selo do estado do Tailscale na UI. */
export function tailscaleBadge(info: TailscaleInfo): { tone: RemoteTone; label: string } {
  if (!info.installed) return { tone: 'neutral', label: 'Não instalado' }
  if (info.connected) return { tone: 'success', label: 'Conectado' }
  switch (info.backendState) {
    case 'NeedsLogin':
      return { tone: 'warning', label: 'Falta entrar' }
    case 'NeedsMachineAuth':
      return { tone: 'warning', label: 'Aguardando aprovação' }
    case 'Starting':
      return { tone: 'warning', label: 'Iniciando' }
    case 'Stopped':
    case 'NoState':
      return { tone: 'neutral', label: 'Desligado' }
    default:
      return { tone: 'danger', label: 'Desconectado' }
  }
}

/** Selo do tipo de rede (com base no último IP público consultado). */
export function networkKindBadge(kind: RemoteNetworkKind): { tone: RemoteTone; label: string } {
  switch (kind) {
    case 'direct':
      return { tone: 'success', label: 'IPv4 público direto' }
    case 'cgnat':
      return { tone: 'warning', label: 'CGNAT — precisa de VPN' }
    case 'nat':
      return { tone: 'accent', label: 'Atrás de NAT' }
    default:
      return { tone: 'neutral', label: 'Não verificado' }
  }
}

export interface PortSummary {
  open: number
  total: number
  localhostOpen: number
  tailscaleOpen: number
}

/** Conta portas abertas por alvo; `total` é o esperado (portas × alvos). */
export function summarizePorts(targets: PortTargetResult[]): PortSummary {
  let open = 0
  let total = 0
  let localhostOpen = 0
  let tailscaleOpen = 0

  for (const target of targets) {
    for (const probe of target.probes) {
      total += 1
      if (probe.open) {
        open += 1
        if (target.target === 'localhost') localhostOpen += 1
        else tailscaleOpen += 1
      }
    }
  }

  return { open, total, localhostOpen, tailscaleOpen }
}

/** Endereço mais seguro para digitar no Moonlight (IP ganha do MagicDNS). */
export function bestRemoteAddress(info: TailscaleInfo): string | null {
  return info.ipv4 ?? info.dnsName
}

/** Quais portas esperadas ficaram fechadas em localhost (para a lista da UI). */
export function closedLocalhostPorts(targets: PortTargetResult[]): number[] {
  const localhost = targets.find((target) => target.target === 'localhost')
  if (!localhost) return [...KLOUD_TCP_PORTS]
  return localhost.probes.filter((probe) => !probe.open).map((probe) => probe.port)
}
