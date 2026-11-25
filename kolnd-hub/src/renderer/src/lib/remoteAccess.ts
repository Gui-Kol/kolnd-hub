import {
  KLOUD_TCP_PORTS,
  isIPv4,
  type LocalAddresses,
  type PortProbe,
  type PortTargetResult,
  type RemoteNetworkKind,
  type RemoteStatus,
  type ZeroTierInfo,
  type ZeroTierServiceState
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
    zerotier: uniqueIPs(obj.zerotier).filter(isIPv4),
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
      item.target === 'zerotier' ? 'zerotier' : item.target === 'localhost' ? 'localhost' : null
    const host = stringOrNull(item.host)
    if (!target || !host) continue
    const probes = Array.isArray(item.probes)
      ? item.probes.map(parseProbe).filter((probe): probe is PortProbe => probe !== null)
      : []
    out.push({ target, host, probes })
  }
  return out
}

function parseServiceState(raw: unknown): ZeroTierServiceState {
  return raw === 'running' || raw === 'stopped' ? raw : 'unknown'
}

function parseZeroTier(raw: unknown): ZeroTierInfo | null {
  if (!isRecord(raw)) return null
  if (typeof raw.installed !== 'boolean' || typeof raw.connected !== 'boolean') return null

  const info: ZeroTierInfo = {
    installed: raw.installed,
    connected: raw.connected,
    online: raw.online === true,
    service: parseServiceState(raw.service),
    uiOpen: raw.uiOpen === true,
    nodeId: stringOrNull(raw.nodeId),
    version: stringOrNull(raw.version),
    network: stringOrNull(raw.network),
    networkId: stringOrNull(raw.networkId),
    networkStatus: stringOrNull(raw.networkStatus),
    ipv4: ipv4OrNull(raw.ipv4),
    ipv6: stringOrNull(raw.ipv6),
    exePath: stringOrNull(raw.exePath)
  }
  if (typeof raw.error === 'string' && raw.error.trim()) info.error = raw.error.trim()
  return info
}

const NETWORK_KINDS: RemoteNetworkKind[] = ['direct', 'nat', 'cgnat', 'unknown']

/** Retorna `null` se o payload não tiver o mínimo para a tela funcionar. */
export function parseRemoteStatus(raw: unknown): RemoteStatus | null {
  if (!isRecord(raw)) return null

  const zerotier = parseZeroTier(raw.zerotier)
  if (!zerotier) return null

  if (!isRecord(raw.kloud)) return null
  const installed = raw.kloud.installed === true
  const running = raw.kloud.running === true

  const publicRaw = isRecord(raw.publicIp) ? raw.publicIp : {}
  const kind = NETWORK_KINDS.includes(publicRaw.kind as RemoteNetworkKind)
    ? (publicRaw.kind as RemoteNetworkKind)
    : 'unknown'

  return {
    zerotier,
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

/**
 * Selo do estado do ZeroTier na UI. O serviço/GUI (aberto/fechado) vem ANTES
 * do estado de rede: "Aberto" responde à pergunta do botão, enquanto
 * "Conectado/Acesso negado…" responde se há rede utilizável.
 */
export function zeroTierBadge(info: ZeroTierInfo): { tone: RemoteTone; label: string } {
  if (!info.installed) return { tone: 'neutral', label: 'Não instalado' }
  if (info.service === 'running') {
    return info.uiOpen
      ? { tone: 'success', label: 'Aberto' }
      : { tone: 'accent', label: 'Aberto em segundo plano' }
  }
  if (info.service === 'stopped') return { tone: 'neutral', label: 'Fechado' }

  if (info.connected) return { tone: 'success', label: 'Conectado' }
  if (!info.online) return { tone: 'neutral', label: 'Desligado' }

  if (!info.networkId) return { tone: 'warning', label: 'Sem rede' }

  switch (info.networkStatus) {
    case 'OK':
      return { tone: 'warning', label: 'Sem endereço' }
    case 'REQUESTING_CONFIGURATION':
      return { tone: 'warning', label: 'Conectando' }
    case 'ACCESS_DENIED':
      return { tone: 'warning', label: 'Acesso negado' }
    case 'AUTHENTICATION_REQUIRED':
      return { tone: 'warning', label: 'Falta autorizar' }
    case 'NOT_FOUND':
      return { tone: 'danger', label: 'Rede não encontrada' }
    case 'PORT_ERROR':
      return { tone: 'danger', label: 'Erro na interface' }
    case 'CLIENT_TOO_OLD':
      return { tone: 'danger', label: 'Cliente desatualizado' }
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
  zerotierOpen: number
}

/** Conta portas abertas por alvo; `total` é o esperado (portas × alvos). */
export function summarizePorts(targets: PortTargetResult[]): PortSummary {
  let open = 0
  let total = 0
  let localhostOpen = 0
  let zerotierOpen = 0

  for (const target of targets) {
    for (const probe of target.probes) {
      total += 1
      if (probe.open) {
        open += 1
        if (target.target === 'localhost') localhostOpen += 1
        else zerotierOpen += 1
      }
    }
  }

  return { open, total, localhostOpen, zerotierOpen }
}

/** Endereço mais seguro para digitar no Moonlight (IPv4 ganha do IPv6). */
export function bestRemoteAddress(info: ZeroTierInfo): string | null {
  return info.ipv4 ?? info.ipv6
}

export interface RemoteAddressSummary {
  zerotierIp: string | null
  networkId: string | null
  lanIp: string | null
  /** Texto pronto para "Copiar tudo" — só linhas com valor. */
  text: string
}

/**
 * Bloco "Endereços" do tutorial/card: IP do ZeroTier, ID da rede e IP local,
 * com um texto pronto para colar no Moonlight/celular. Nada é inventado —
 * campo ausente vira `null` e some do texto.
 */
export function buildAddressSummary(status: RemoteStatus): RemoteAddressSummary {
  const zerotierIp = bestRemoteAddress(status.zerotier)
  const rawNetworkId = status.zerotier.networkId
  const networkId =
    typeof rawNetworkId === 'string' && /^[0-9a-f]{16}$/i.test(rawNetworkId)
      ? rawNetworkId.toLowerCase()
      : null
  const lanIp = status.addresses.lan[0] ?? null

  const lines: string[] = []
  if (zerotierIp) lines.push(`IP do ZeroTier: ${zerotierIp}`)
  if (networkId) lines.push(`ID da rede: ${networkId}`)
  if (lanIp) lines.push(`IP local: ${lanIp}`)

  return { zerotierIp, networkId, lanIp, text: lines.join('\n') }
}

/** Quais portas esperadas ficaram fechadas em localhost (para a lista da UI). */
export function closedLocalhostPorts(targets: PortTargetResult[]): number[] {
  const localhost = targets.find((target) => target.target === 'localhost')
  if (!localhost) return [...KLOUD_TCP_PORTS]
  return localhost.probes.filter((probe) => !probe.open).map((probe) => probe.port)
}
