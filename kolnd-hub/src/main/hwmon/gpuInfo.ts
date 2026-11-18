/**
 * Identificação da GPU sem privilégio e sem driver.
 *
 * Por que este módulo existe: o snapshot antigo só conhecia GPU NVIDIA (via
 * `nvidia-smi`) e caía na `Win32_VideoController.AdapterRAM` para VRAM — que é
 * um DWORD e satura em ~4 GiB (medido nesta máquina: placa de 8 GB reportada
 * como 4.293.918.720 bytes). Aqui:
 * - o adaptador primário é escolhido entre TODOS os fabricantes, descartando
 *   adaptadores virtuais (Parsec, Basic Display, monitores remotos);
 * - a VRAM real vem do registro (`HardwareInformation.qwMemorySize`, QWORD),
 *   com `AdapterRAM` apenas como fallback quando o valor é plausível;
 * - tudo é puro (recebe o JSON já decodificado) para ser testado sem tocar na
 *   máquina.
 */

export type GpuVendor = 'nvidia' | 'amd' | 'intel' | 'other'

/** Adaptador de vídeo normalizado — o que o resto do monitor consome. */
export interface GpuAdapterInfo {
  name: string
  vendor: GpuVendor
  pnpDeviceId: string | null
  driverVersion: string | null
  /** `YYYY-MM-DD` (a data vem como `/Date(ms)/` no JSON do CIM). */
  driverDate: string | null
  /** VRAM total em MiB; `null` quando nenhuma fonte é confiável. */
  vramTotalMb: number | null
  isVirtual: boolean
}

/** Subconjunto de `Win32_VideoController` que o monitor usa. */
export interface VideoControllerCim {
  name: string
  pnpDeviceId: string | null
  driverVersion: string | null
  driverDate: string | null
  adapterRamBytes: number | null
}

/** Entrada da chave de classe de vídeo no registro (`{4d36e968-...}\<nnnn>`). */
export interface GpuRegistryEntry {
  driverDesc: string | null
  driverVersion: string | null
  matchingDeviceId: string | null
  memoryBytes: number | null
}

const MIB = 1024 * 1024

/**
 * Teto de sanidade: nenhuma GPU de consumidor chega perto disso. Valor acima é
 * lixo do registro/CIM, não VRAM — melhor `null` do que número inventado.
 */
const MAX_PLAUSIBLE_VRAM_BYTES = 128 * 1024 * MIB

/**
 * `AdapterRAM` é um uint32: acima disso o valor satura (8 GB aparece como
 * 4.293.918.720). Abaixo de 3,5 GiB ainda dá para confiar; na região do teto,
 * não — e mostrar 4 GiB numa placa de 8 GiB seria mentira.
 */
const ADAPTER_RAM_TRUST_LIMIT_BYTES = 3.5 * 1024 * MIB

/** Minúsculo demais para ser VRAM de GPU (ruído de registro). */
const MIN_PLAUSIBLE_VRAM_BYTES = 16 * MIB

const NVIDIA_NAME = /\b(nvidia|geforce|rtx|gtx|quadro|tesla)\b/i
const AMD_NAME = /\b(amd|radeon|firepro|instinct)\b/i
const INTEL_NAME = /\b(intel|iris|uhd|arc)\b/i

/**
 * Nomes que denunciam adaptador que NÃO é uma GPU de verdade. `virtual` cobre
 * "Parsec Virtual Display Adapter"; `basic display`/`basic render` são os
 * adaptadores de software do Windows; `meta` é o driver do Quest Link.
 */
const VIRTUAL_NAME = /parsec|basic display|basic render|remote|virtual|indirect|\bidd\b|\bmeta\b/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toRecordList(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (isRecord(value)) return [value]
  return []
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function collapse(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Fabricante pelo nome do modelo; cai no PNP quando o nome não identifica. */
export function gpuVendorFromName(name: string | null | undefined): GpuVendor {
  const text = typeof name === 'string' ? name : ''
  if (NVIDIA_NAME.test(text)) return 'nvidia'
  if (AMD_NAME.test(text)) return 'amd'
  if (INTEL_NAME.test(text)) return 'intel'
  return 'other'
}

/**
 * Fabricante pelo `PCI\VEN_xxxx`. É o sinal mais estável quando o nome do
 * adaptador é genérico ("Display Adapter").
 */
export function gpuVendorFromPnpId(pnpDeviceId: string | null | undefined): GpuVendor {
  const text = typeof pnpDeviceId === 'string' ? pnpDeviceId.toUpperCase() : ''
  if (text.includes('VEN_10DE')) return 'nvidia'
  if (text.includes('VEN_1002')) return 'amd'
  if (text.includes('VEN_8086')) return 'intel'
  return 'other'
}

/**
 * Adaptador virtual/software não entra no card de GPU. `ROOT\` é decisivo
 * (Parsec é `ROOT\DISPLAY\0000`); o nome só entra quando o PNP não existe.
 */
export function isVirtualAdapter(
  name: string | null | undefined,
  pnpDeviceId: string | null | undefined
): boolean {
  const pnp = typeof pnpDeviceId === 'string' ? pnpDeviceId.trim() : ''
  if (/^ROOT\\/i.test(pnp)) return true
  if (/^SWD\\/i.test(pnp)) return true
  const text = typeof name === 'string' ? name : ''
  return VIRTUAL_NAME.test(text)
}

/** `/Date(1794009600000)/`, `20261107000000.000000-000` ou ISO → `YYYY-MM-DD`. */
export function normalizeDriverDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  const jsonDate = /^\/Date\((-?\d+)\)\/$/.exec(text)
  if (jsonDate) {
    const ms = Number(jsonDate[1])
    if (!Number.isFinite(ms)) return null
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().slice(0, 10)
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  const compact = iso ?? /^(\d{4})(\d{2})(\d{2})/.exec(text)
  if (!compact) return null
  const month = Number(compact[2])
  const day = Number(compact[3])
  // `00000000` e afins: data inválida vira null em vez de "0000-00-00".
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${compact[1]}-${compact[2]}-${compact[3]}`
}

/** Parser da lista de `Win32_VideoController` (array ou item único do CIM). */
export function parseVideoControllers(value: unknown): VideoControllerCim[] {
  const controllers: VideoControllerCim[] = []
  for (const row of toRecordList(value)) {
    const name = toText(row.Name)
    if (!name) continue
    const adapterRam = toNumber(row.AdapterRAM)
    controllers.push({
      name,
      pnpDeviceId: toText(row.PNPDeviceID),
      driverVersion: toText(row.DriverVersion),
      driverDate: normalizeDriverDate(row.DriverDate),
      adapterRamBytes: adapterRam !== null && adapterRam > 0 ? adapterRam : null
    })
  }
  return controllers
}

/**
 * Parser das chaves de classe do registro. A chave `Configuration` e afins não
 * têm `DriverDesc`/`MatchingDeviceId` e são descartadas.
 */
export function parseGpuRegistry(value: unknown): GpuRegistryEntry[] {
  const entries: GpuRegistryEntry[] = []
  for (const row of toRecordList(value)) {
    const driverDesc = toText(row.DriverDesc)
    const matchingDeviceId = toText(row.MatchingDeviceId)
    if (!driverDesc && !matchingDeviceId) continue
    const memory = toNumber(row['HardwareInformation.qwMemorySize'] ?? row.QwMemorySize)
    entries.push({
      driverDesc,
      driverVersion: toText(row.DriverVersion),
      matchingDeviceId,
      memoryBytes: memory !== null && memory > 0 ? memory : null
    })
  }
  return entries
}

function plausibleMemory(bytes: number | null): number | null {
  if (bytes === null) return null
  if (bytes < MIN_PLAUSIBLE_VRAM_BYTES || bytes > MAX_PLAUSIBLE_VRAM_BYTES) return null
  return bytes
}

/** `AdapterRAM` só vale abaixo do teto do uint32; acima disso é saturação. */
function adapterRamBytes(controller: VideoControllerCim): number | null {
  const bytes = plausibleMemory(controller.adapterRamBytes)
  if (bytes === null) return null
  return bytes < ADAPTER_RAM_TRUST_LIMIT_BYTES ? bytes : null
}

function normalizeDeviceId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function entryMatchesController(entry: GpuRegistryEntry, controller: VideoControllerCim): boolean {
  if (entry.driverDesc && collapse(entry.driverDesc) === collapse(controller.name)) return true
  if (!entry.matchingDeviceId || !controller.pnpDeviceId) return false
  const match = normalizeDeviceId(entry.matchingDeviceId)
  const pnp = normalizeDeviceId(controller.pnpDeviceId)
  return pnp === match || pnp.startsWith(match) || match.startsWith(pnp)
}

/**
 * VRAM em MiB: registro (`qwMemorySize`) > `AdapterRAM` plausível > `null`.
 * O casamento é por `DriverDesc` (nome exato) e, se preciso, por
 * `MatchingDeviceId` — o registro não tem PNP completo, só o prefixo.
 */
export function resolveVramTotalMb(
  controller: VideoControllerCim,
  registry: readonly GpuRegistryEntry[]
): number | null {
  for (const entry of registry) {
    if (!entryMatchesController(entry, controller)) continue
    const bytes = plausibleMemory(entry.memoryBytes)
    if (bytes !== null) return Math.round(bytes / MIB)
  }
  const fallback = adapterRamBytes(controller)
  return fallback === null ? null : Math.round(fallback / MIB)
}

/** Normaliza todos os adaptadores com VRAM resolvida. */
export function buildGpuAdapters(
  controllers: readonly VideoControllerCim[],
  registry: readonly GpuRegistryEntry[]
): GpuAdapterInfo[] {
  return controllers.map((controller) => {
    const entry = registry.find((candidate) => entryMatchesController(candidate, controller))
    const vendorFromName = gpuVendorFromName(controller.name)
    return {
      name: controller.name,
      vendor:
        vendorFromName !== 'other' ? vendorFromName : gpuVendorFromPnpId(controller.pnpDeviceId),
      pnpDeviceId: controller.pnpDeviceId,
      driverVersion: controller.driverVersion ?? entry?.driverVersion ?? null,
      driverDate: controller.driverDate,
      vramTotalMb: resolveVramTotalMb(controller, registry),
      isVirtual: isVirtualAdapter(controller.name, controller.pnpDeviceId)
    }
  })
}

/**
 * Ordem de preferência: NVIDIA/AMD (discretas) > Intel (normalmente iGPU) >
 * outros. Empate mantém a ordem do CIM (estável) — sem "escolher" por acaso em
 * cada tick. Só virtuais (ou nenhum adaptador) → `null`.
 */
const VENDOR_RANK: Record<GpuVendor, number> = {
  nvidia: 0,
  amd: 1,
  intel: 2,
  other: 3
}

export function selectPrimaryGpu(adapters: readonly GpuAdapterInfo[]): GpuAdapterInfo | null {
  const candidates = adapters.filter(
    (adapter) => !adapter.isVirtual && adapter.name.trim().length > 0
  )
  if (candidates.length === 0) return null

  let best = candidates[0]
  for (const candidate of candidates.slice(1)) {
    if (VENDOR_RANK[candidate.vendor] < VENDOR_RANK[best.vendor]) best = candidate
  }
  return best
}
