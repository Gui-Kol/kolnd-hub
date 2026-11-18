// Acesso remoto (Tailscale + diagnóstico de rede).
//
// FRONTEIRA: este arquivo é importável por `main/`, `preload/` e `renderer/`
// (mesmo padrão de `shared/hud.ts` e `shared/gamepad.ts`). Só entram aqui
// tipos e lógica PURA — nada de Electron, `fs`, `net` ou `child_process`.
//
// Por que Tailscale e não um proxy HTTP: o Moonlight transmite vídeo, áudio e
// controle por UDP (47998–48002). Cloudflare Tunnel/ngrok carregam HTTP e TCP,
// não UDP, então servem para o painel web — nunca para jogar.

/** Portas TCP que o Moonlight precisa alcançar (RTSP e API). */
export const KLOUD_TCP_PORTS = [47984, 47989, 48010] as const

/** Painel web do Kloud Games (pareamento de PIN). */
export const KLOUD_WEB_PORT = 47990

/** Painel web local — abrir no navegador para digitar o PIN do Moonlight. */
export const KLOUD_WEB_URL = `http://localhost:${KLOUD_WEB_PORT}`

export const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download/windows'

/**
 * Endpoint usado APENAS quando o usuário clica em "Descobrir meu IP público".
 * A escolha é explícita e aparece na UI — o Hub nunca consulta isso sozinho.
 * IPv4 de propósito: é o que permite distinguir NAT de CGNAT (o Moonlight e o
 * diagnóstico de port forward giram em torno do IPv4).
 */
export const PUBLIC_IP_ENDPOINT = 'https://api.ipify.org?format=json'

/** Como o IP público se relaciona com as interfaces locais. */
export type RemoteNetworkKind = 'direct' | 'nat' | 'cgnat' | 'unknown'

/** Estado do Tailscale nesta máquina (saída de `tailscale status --json`). */
export interface TailscaleInfo {
  installed: boolean
  /** Backend "Running" e nó online. */
  connected: boolean
  /** BackendState cru (`Running`, `NeedsLogin`, `Stopped`…). */
  backendState: string | null
  hostname: string | null
  /** Nome MagicDNS sem o ponto final (ex.: `pc.tailnet.ts.net`). */
  dnsName: string | null
  /** IP 100.x.y.z — o endereço que o Moonlight deve usar. */
  ipv4: string | null
  ipv6: string | null
  /** Nome da tailnet (ou sufixo MagicDNS quando o nome não vem). */
  tailnet: string | null
  onlinePeers: number
  exePath: string | null
  error?: string
}

export interface LocalAddresses {
  /** IPv4 privados/roteáveis da LAN (exclui loopback e 100.64/10). */
  lan: string[]
  /** IPv4 na faixa 100.64/10 (Tailscale/CGNAT). */
  tailscale: string[]
  /** IPv6 globais (link-local fica de fora). */
  ipv6: string[]
}

export interface PortProbe {
  port: number
  open: boolean
}

export interface PortTargetResult {
  target: 'localhost' | 'tailscale'
  host: string
  probes: PortProbe[]
}

export interface PublicIpState {
  address: string | null
  /** ISO da última consulta bem-sucedida. */
  checkedAt: string | null
  kind: RemoteNetworkKind
}

export interface RemoteStatus {
  tailscale: TailscaleInfo
  addresses: LocalAddresses
  kloud: { installed: boolean; running: boolean }
  ports: PortTargetResult[]
  publicIp: PublicIpState
}

export interface PublicIpResult {
  success: boolean
  ip?: string
  kind?: RemoteNetworkKind
  checkedAt?: string
  error?: string
}

/** Por que o modo remoto não pôde ser ligado (mostrado no modal de ajuda). */
export type RemoteModeReason =
  'invalid' | 'tailscale-missing' | 'tailscale-disconnected' | 'store-unavailable'

export interface RemoteModeResult {
  success: boolean
  enabled: boolean
  reason?: RemoteModeReason
  error?: string
  /** Endereço que o Moonlight deve usar (IP 100.x ou MagicDNS). */
  address?: string | null
}

export interface RemoteActionResult {
  success: boolean
  error?: string
  /** O que a ação abriu, para a UI explicar sem adivinhar. */
  opened?: 'app' | 'download' | 'login' | 'web'
  installedNow?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** IPv4 canônico (4 octetos 0–255, sem zeros à esquerda). */
export function isIPv4(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false
    if (part.length > 1 && part.startsWith('0')) return false
    const n = Number(part)
    return n >= 0 && n <= 255
  })
}

/**
 * Faixa 100.64.0.0/10 (RFC 6598). No contexto doméstico significa CGNAT —
 * e é a mesma faixa que o Tailscale usa para os IPs da tailnet.
 */
export function isCGNAT(ip: string): boolean {
  if (!isIPv4(ip)) return false
  const [first, second] = ip.split('.').map(Number)
  return first === 100 && second >= 64 && second <= 127
}

function isPrivateLanIPv4(ip: string): boolean {
  if (!isIPv4(ip)) return false
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local/APIPA
  return false
}

/** Classifica um IPv4 local pela interface provável. */
export function classifyLocalIPv4(ip: string): 'loopback' | 'tailscale' | 'lan' | 'other' {
  if (!isIPv4(ip)) return 'other'
  if (ip.startsWith('127.')) return 'loopback'
  if (isCGNAT(ip)) return 'tailscale'
  if (isPrivateLanIPv4(ip)) return 'lan'
  return 'other'
}

/**
 * Compara o IP público com os IPs locais:
 * - `direct`: o IP público é de uma interface da máquina (sem NAT);
 * - `cgnat`: o IP público está em 100.64/10 (operadora faz CGNAT);
 * - `nat`: existe NAT, mas port forward ainda pode funcionar;
 * - `unknown`: sem leitura válida.
 */
export function comparePublicIp(publicIp: string, localIps: readonly string[]): RemoteNetworkKind {
  const value = publicIp.trim().toLowerCase()
  if (!/^[0-9a-f:.]+$/.test(value) || value.length < 3) return 'unknown'
  if (localIps.some((ip) => ip.toLowerCase() === value)) return 'direct'
  if (isCGNAT(value)) return 'cgnat'
  return 'nat'
}

/**
 * Interpreta `tailscale status --json` sem confiar no formato: campos
 * ausentes/estranhos viram `null`/`0` e nunca derrubam a tela.
 */
export function parseTailscaleStatus(
  raw: unknown
): Omit<TailscaleInfo, 'installed' | 'exePath' | 'error'> {
  const empty = {
    connected: false,
    backendState: null as string | null,
    hostname: null as string | null,
    dnsName: null as string | null,
    ipv4: null as string | null,
    ipv6: null as string | null,
    tailnet: null as string | null,
    onlinePeers: 0
  }
  if (!isRecord(raw)) return empty

  const backendState = typeof raw.BackendState === 'string' ? raw.BackendState : null
  const self = isRecord(raw.Self) ? raw.Self : null

  const ips =
    self && Array.isArray(self.TailscaleIPs)
      ? self.TailscaleIPs.filter((ip): ip is string => typeof ip === 'string')
      : []
  const ipv4 = ips.find(isIPv4) ?? null
  const ipv6 = ips.find((ip) => !isIPv4(ip) && ip.includes(':')) ?? null

  const rawDnsName = self && typeof self.DNSName === 'string' ? self.DNSName : ''
  const dnsName = rawDnsName ? rawDnsName.replace(/\.$/, '') : null
  const hostname = self && typeof self.HostName === 'string' ? self.HostName : null

  const tailnetObj = isRecord(raw.CurrentTailnet) ? raw.CurrentTailnet : null
  const tailnet =
    (tailnetObj && typeof tailnetObj.MagicDNSSuffix === 'string'
      ? tailnetObj.MagicDNSSuffix
      : null) ?? (tailnetObj && typeof tailnetObj.Name === 'string' ? tailnetObj.Name : null)

  const peers = isRecord(raw.Peer) ? Object.values(raw.Peer) : []
  const onlinePeers = peers.filter((peer) => isRecord(peer) && peer.Online === true).length

  // `Self.Online` ausente em algumas versões/saídas parciais: nesse caso o
  // BackendState decide sozinho.
  const selfOnline = self === null || self.Online !== false

  return {
    connected: backendState === 'Running' && selfOnline,
    backendState,
    hostname,
    dnsName,
    ipv4,
    ipv6,
    tailnet,
    onlinePeers
  }
}

/** Todos os IPs que podem identificar esta máquina na comparação com o IP público. */
export function flattenAddresses(addresses: LocalAddresses): string[] {
  return [...addresses.lan, ...addresses.tailscale, ...addresses.ipv6]
}
