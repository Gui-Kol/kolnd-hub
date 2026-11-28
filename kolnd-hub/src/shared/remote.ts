// Acesso remoto (ZeroTier + diagnóstico de rede).
//
// FRONTEIRA: este arquivo é importável por `main/`, `preload/` e `renderer/`
// (mesmo padrão de `shared/hud.ts` e `shared/gamepad.ts`). Só entram aqui
// tipos e lógica PURA — nada de Electron, `fs`, `net` ou `child_process`.
//
// Por que ZeroTier e não um proxy HTTP: o Moonlight transmite vídeo, áudio e
// controle por UDP (47998–48002). Cloudflare Tunnel/ngrok carregam HTTP e TCP,
// não UDP, então servem para o painel web — nunca para jogar.

/** Portas TCP que o Moonlight precisa alcançar (RTSP e API). */
export const KLOUD_TCP_PORTS = [47984, 47989, 48010] as const

/** Painel web do Kloud Games (pareamento de PIN). */
export const KLOUD_WEB_PORT = 47990

/** Painel web local — abrir no navegador para digitar o PIN do Moonlight. */
export const KLOUD_WEB_URL = `http://localhost:${KLOUD_WEB_PORT}`

export const ZEROTIER_DOWNLOAD_URL = 'https://www.zerotier.com/download/'

/**
 * Vídeo explicativo do modo remoto (Moonlight + ZeroTier). O Hub nunca carrega
 * nada sozinho: o navegador externo só abre no clique do usuário.
 */
export const KLOUD_REMOTE_VIDEO_URL = 'https://youtu.be/2Ymk4tL5ryI'

/**
 * Endpoint usado APENAS quando o usuário clica em "Descobrir meu IP público".
 * A escolha é explícita e aparece na UI — o Hub nunca consulta isso sozinho.
 * IPv4 de propósito: é o que permite distinguir NAT de CGNAT (o Moonlight e o
 * diagnóstico de port forward giram em torno do IPv4).
 */
export const PUBLIC_IP_ENDPOINT = 'https://api.ipify.org?format=json'

/** Como o IP público se relaciona com as interfaces locais. */
export type RemoteNetworkKind = 'direct' | 'nat' | 'cgnat' | 'unknown'

/**
 * Estado do serviço `ZeroTierOneService` no Windows.
 * `unknown` cobre serviço ausente, consulta falhou ou saída ambígua — nunca
 * presumimos "parado" sem prova.
 */
export type ZeroTierServiceState = 'running' | 'stopped' | 'unknown'

/**
 * Estado do ZeroTier nesta máquina (saída de `zerotier-cli -j info` +
 * `zerotier-cli -j listnetworks` + leitura do serviço/GUI no main).
 */
export interface ZeroTierInfo {
  installed: boolean
  /** Serviço on-line E com pelo menos uma rede `OK` que tenha endereço. */
  connected: boolean
  /** O serviço respondeu `online: true` (independe de ter rede ingressada). */
  online: boolean
  /** Estado do serviço `ZeroTierOneService` (`sc.exe query`). */
  service: ZeroTierServiceState
  /** A janela/bandeja oficial (`zerotier_desktop_ui.exe`) está aberta. */
  uiOpen: boolean
  /** Node ID de 10 hex — o mesmo que aparece em my.zerotier.com. */
  nodeId: string | null
  version: string | null
  /** Nome da rede principal (primeira `OK` com endereço; senão a primeira). */
  network: string | null
  /** ID de 16 hex da rede principal. */
  networkId: string | null
  /** Status cru da rede principal (`OK`, `ACCESS_DENIED`, `REQUESTING_CONFIGURATION`…). */
  networkStatus: string | null
  /** IPv4 atribuído, sem o prefixo CIDR — o endereço que o Moonlight deve usar. */
  ipv4: string | null
  ipv6: string | null
  exePath: string | null
  error?: string
}

export interface LocalAddresses {
  /** IPv4 privados/roteáveis da LAN (sem loopback e sem endereços da VPN). */
  lan: string[]
  /** IPv4 das interfaces/endereços atribuídos pelo ZeroTier. */
  zerotier: string[]
  /** IPv6 globais (link-local fica de fora). */
  ipv6: string[]
}

export interface PortProbe {
  port: number
  open: boolean
}

export interface PortTargetResult {
  target: 'localhost' | 'zerotier'
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
  zerotier: ZeroTierInfo
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
  'invalid' | 'zerotier-missing' | 'zerotier-disconnected' | 'store-unavailable'

export interface RemoteModeResult {
  success: boolean
  enabled: boolean
  reason?: RemoteModeReason
  error?: string
  /** Endereço que o Moonlight deve usar (IP da rede ZeroTier). */
  address?: string | null
}

export interface RemoteActionResult {
  success: boolean
  error?: string
  /** O que a ação abriu, para a UI explicar sem adivinhar. */
  opened?: 'app' | 'download' | 'web'
  installedNow?: boolean
}

/** Resultado de abrir/fechar o ZeroTier (serviço + GUI). */
export interface ZeroTierPowerResult {
  success: boolean
  /** Estado desejado aplicado (true = aberto, false = fechado). */
  open: boolean
  /** O usuário recusou o UAC — nada foi alterado. */
  cancelled?: boolean
  error?: string
  /** Estado relido ao fim da ação (fonte da UI, nunca adivinhado). */
  info?: ZeroTierInfo
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

/** IPv6 em forma textual (tolerante: só descarta o que claramente não é IPv6). */
export function isIPv6(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const text = value.trim()
  return text.includes(':') && text.length <= 45 && /^[0-9a-f:.]+$/i.test(text)
}

/**
 * Interpreta a saída de `sc.exe query ZeroTierOneService` (ou texto solto do
 * PowerShell/Get-Service). Só devolve `running`/`stopped` com palavra inteira
 * reconhecida; `START_PENDING` conta como caminho para aberto e
 * `STOP_PENDING` como fechado. Qualquer outra coisa é `unknown` — a UI nunca
 * deve inventar "fechado" quando a consulta falhou.
 */
export function parseServiceState(raw: string): ZeroTierServiceState {
  if (typeof raw !== 'string' || !raw.trim()) return 'unknown'
  const text = raw.toUpperCase()

  if (/\bSTART_PENDING\b/.test(text)) return 'running'
  if (/\bRUNNING\b/.test(text)) return 'running'
  if (/\bSTOP_PENDING\b/.test(text)) return 'stopped'
  if (/\bSTOPPED\b/.test(text)) return 'stopped'
  return 'unknown'
}

/**
 * `tasklist /FI "IMAGENAME eq zerotier_desktop_ui.exe" /NH /FO CSV` devolve uma
 * linha CSV por processo ou "INFO: No tasks are running…". Só o nome exato do
 * executável na primeira coluna conta — evita casar com o serviço/CLI.
 */
export function parseZeroTierUiOpen(output: string): boolean {
  if (typeof output !== 'string' || !output.trim()) return false
  for (const line of output.split(/\r?\n/)) {
    const firstCell = line.trim().replace(/^"/, '').split('"')[0].trim().toLowerCase()
    if (firstCell === 'zerotier_desktop_ui.exe') return true
  }
  return false
}

/**
 * Faixa 100.64.0.0/10 (RFC 6598). No contexto doméstico significa CGNAT da
 * operadora. NÃO identifica mais a VPN: o ZeroTier usa a faixa que o
 * administrador da rede escolher (normalmente 10.x ou 172.x).
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

/**
 * Nome de interface do ZeroTier no Windows. O `portDeviceName` do CLI é a
 * fonte oficial; o fallback por texto cobre instalações em que o adapter
 * aparece como "ZeroTier One [<network id>]".
 */
export function isZeroTierInterfaceName(
  name: string | null | undefined,
  devices: readonly string[] = []
): boolean {
  const value = (name ?? '').trim().toLowerCase()
  if (!value) return false
  if (value.includes('zerotier')) return true
  return devices.some((device) => device.trim().toLowerCase() === value)
}

export interface LocalIPv4Context {
  /** Nome da interface dona do endereço (Windows: "ZeroTier One [id]"). */
  interfaceName?: string | null
  /** `portDeviceName` de todas as redes do `-j listnetworks`. */
  zerotierDevices?: readonly string[]
  /** `assignedAddresses` (sem prefixo) de todas as redes do CLI. */
  zerotierAddresses?: readonly string[]
}

/** Classifica um IPv4 local pela interface e pelos endereços do ZeroTier. */
export function classifyLocalIPv4(
  ip: string,
  context: LocalIPv4Context = {}
): 'loopback' | 'zerotier' | 'lan' | 'other' {
  if (!isIPv4(ip)) return 'other'
  if (ip.startsWith('127.')) return 'loopback'
  if (context.zerotierAddresses?.includes(ip)) return 'zerotier'
  if (isZeroTierInterfaceName(context.interfaceName, context.zerotierDevices)) return 'zerotier'
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

/** Uma rede normalizada de `-j listnetworks`. */
export interface ZeroTierNetworkEntry {
  id: string | null
  name: string | null
  status: string | null
  /** Nome do adapter no SO (`portDeviceName`). */
  deviceName: string | null
  /** Endereços atribuídos, já sem o prefixo CIDR. */
  assigned: string[]
  allowManaged: boolean
}

/**
 * Normaliza `-j listnetworks` sem confiar no formato: aceita a lista do CLI,
 * um objeto indexado por ID (saída de emergência) e descarta o resto. Puro.
 */
export function parseZeroTierNetworks(raw: unknown): ZeroTierNetworkEntry[] {
  const entries: Array<Record<string, unknown>> = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isRecord(item)) entries.push(item)
    }
  } else if (isRecord(raw)) {
    for (const [id, item] of Object.entries(raw)) {
      if (isRecord(item)) entries.push({ ...item, id })
    }
  }

  return entries.map((entry) => {
    const rawId = typeof entry.id === 'string' ? entry.id.trim().toLowerCase() : ''
    const rawStatus = typeof entry.status === 'string' ? entry.status.trim() : ''
    const assignedRaw = Array.isArray(entry.assignedAddresses) ? entry.assignedAddresses : []
    const assigned = [
      ...new Set(
        assignedRaw
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.split('/')[0].trim().toLowerCase())
          .filter((item) => isIPv4(item) || isIPv6(item))
      )
    ]

    return {
      id: /^[0-9a-f]{16}$/.test(rawId) ? rawId : null,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null,
      status: rawStatus || null,
      deviceName:
        typeof entry.portDeviceName === 'string' && entry.portDeviceName.trim()
          ? entry.portDeviceName.trim()
          : null,
      assigned,
      allowManaged: entry.allowManaged === true
    }
  })
}

/**
 * Interpreta `zerotier-cli -j info` + `-j listnetworks` sem confiar no formato:
 * campos ausentes/estranhos viram `null`/`false` e nunca derrubam a tela.
 *
 * Regra de conexão: serviço on-line (`online === true`) E pelo menos uma rede
 * `status === 'OK'` com endereço. Ter o CLI instalado mas nenhuma rede
 * ingressada é um estado distinto (`connected: false`, `networkId: null`).
 */
export function parseZeroTierStatus(
  rawInfo: unknown,
  rawNetworks: unknown
): Omit<ZeroTierInfo, 'installed' | 'exePath' | 'error'> {
  const info = isRecord(rawInfo) ? rawInfo : null
  const online = info?.online === true

  const rawAddress = typeof info?.address === 'string' ? info.address.trim().toLowerCase() : ''
  const nodeId = /^[0-9a-f]{10}$/.test(rawAddress) ? rawAddress : null

  const rawVersion = typeof info?.version === 'string' ? info.version.trim() : ''
  const version = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(rawVersion) ? rawVersion : null

  const networks = parseZeroTierNetworks(rawNetworks)
  const ok = networks.filter((network) => network.status === 'OK')
  const primary =
    ok.find((network) => network.assigned.some((ip) => isIPv4(ip))) ??
    ok.find((network) => network.assigned.some((ip) => isIPv6(ip))) ??
    null
  // Sem rede utilizável, ainda mostramos a primeira para a UI explicar o porquê
  // (ex.: ACCESS_DENIED) em vez de fingir que o nó não tem rede nenhuma.
  const shown = primary ?? networks[0] ?? null

  return {
    connected: online && primary !== null,
    online,
    // O parser JSON não conhece serviço/GUI — o main injeta a leitura real.
    service: 'unknown',
    uiOpen: false,
    nodeId,
    version,
    network: shown?.name ?? null,
    networkId: shown?.id ?? null,
    networkStatus: shown?.status ?? null,
    ipv4: primary?.assigned.find((ip) => isIPv4(ip)) ?? null,
    ipv6: primary?.assigned.find((ip) => isIPv6(ip)) ?? null
  }
}

/** Todos os IPs que podem identificar esta máquina na comparação com o IP público. */
export function flattenAddresses(addresses: LocalAddresses): string[] {
  return [...addresses.lan, ...addresses.zerotier, ...addresses.ipv6]
}
