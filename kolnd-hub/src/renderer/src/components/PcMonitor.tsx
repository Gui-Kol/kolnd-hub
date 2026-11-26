import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  Activity,
  AlertTriangle,
  CircuitBoard,
  Cpu,
  Gauge,
  Keyboard,
  Loader2,
  MemoryStick,
  Monitor,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap
} from 'lucide-react'
import type {
  DriverStatus,
  DriverStatusInfo,
  FpsStatusInfo,
  HudScale,
  HudStatus,
  HwCpuTempSource,
  HwGpuVendor,
  HwPowerSourceCpu,
  HwPowerSourceGpu,
  HwSnapshot,
  InstallDriverResult
} from '../types'
import {
  acceleratorFromKeyEvent,
  formatAcceleratorLabel,
  HUD_DEFAULT_SCALE,
  HUD_DEFAULT_SHORTCUT,
  HUD_DEFAULT_WIDTH,
  HUD_SCALES,
  HUD_WIDTH_MAX,
  HUD_WIDTH_MIN,
  HUD_WIDTH_STEP
} from '../../../shared/hud'
import { normalizeHudFpsReading } from '../../../shared/fps'
import {
  HWMON_INTERVAL_DEFAULT_MS,
  HWMON_INTERVAL_MAX_MS,
  HWMON_INTERVAL_MIN_MS,
  HWMON_INTERVAL_STEP_MS
} from '../../../shared/hwmon'
import { Badge, Button, Card, Select, Switch } from './ui'
import type { BadgeTone } from './ui'

const DASH = '—'

/** Opções de largura do HUD (180–560, passo 10) — o main aplica o mesmo clamp. */
const HUD_WIDTH_OPTIONS = Array.from(
  { length: (HUD_WIDTH_MAX - HUD_WIDTH_MIN) / HUD_WIDTH_STEP + 1 },
  (_, index) => HUD_WIDTH_MIN + index * HUD_WIDTH_STEP
)

const HUD_SCALE_LABEL: Record<HudScale, string> = {
  compacta: 'Compacta',
  normal: 'Normal',
  grande: 'Grande'
}

/**
 * Opções do intervalo de atualização do monitor (0,1 s a 2,0 s, passo 0,1 s).
 * O renderer não impõe limites além destas opções: o main normaliza de novo e
 * devolve o valor efetivo — a resposta do main é a fonte da verdade.
 */
const HWMON_INTERVAL_OPTIONS = Array.from(
  { length: (HWMON_INTERVAL_MAX_MS - HWMON_INTERVAL_MIN_MS) / HWMON_INTERVAL_STEP_MS + 1 },
  (_, index) => HWMON_INTERVAL_MIN_MS + index * HWMON_INTERVAL_STEP_MS
)

/** Rótulo em pt-BR com vírgula decimal: 500 → "0,5 s". */
function formatIntervalLabel(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/**
 * Motivo de cada "—". Sensores variam por fabricante: em AMD/Intel não existe
 * `nvidia-smi` para temperatura/potência, e temperatura de CPU em desktop só é
 * exata com o driver de sensores. A UI explica em vez de deixar um traço mudo.
 */
const DASH_TITLE = {
  cpuTemp:
    'Sem zona térmica ACPI nesta placa. Para temperatura exata da CPU, instale e ative os sensores avançados (PawnIO).',
  cpuPower: 'Requer a leitura elevada dos sensores avançados (PawnIO) ativa.',
  cpuVoltage:
    'Vcore medido pela telemetria SVI2 (AMD) ou IA32_PERF_STATUS (Intel) — não é estimado. Se continuar "—" depois de atualizar o Hub, reative os sensores avançados no Monitor (uma vez).',
  total: 'Requer a potência medida da CPU (driver) e da GPU (nvidia-smi).',
  platform: 'Sem fonte mensurável sem driver; o consumo da plataforma é estimado.',
  vrm: 'VRM exige leitura do Super I/O da placa; não suportado nesta fase.',
  rpm: 'RPM da ventoinha só existe com a NVML do driver NVIDIA; AMD/Intel exigem o Super I/O da placa.',
  gpu: 'Nenhum adaptador de vídeo respondeu ao Windows nesta leitura.',
  gpuUsage: 'O contador de uso da GPU (CIM) não respondeu nesta leitura.',
  gpuTemp:
    'Temperatura da GPU só é exposta pelo nvidia-smi (NVIDIA). AMD/Intel exigem um driver de sensores que esta versão ainda não tem.',
  gpuClock: 'Clocks da GPU só são expostos pelo nvidia-smi (NVIDIA) nesta versão.',
  gpuDriver: 'O registro do driver de vídeo não informou a versão.',
  gpuPower: 'Potência e ventoinha da GPU só são expostas pelo nvidia-smi (NVIDIA).',
  gpuVramUsed: 'Uso de VRAM vem do nvidia-smi ou do contador de memória dedicada do CIM.',
  gpuVramTotal:
    'VRAM real vem do registro do driver. Sem ela, o AdapterRAM do Windows satura em ~4 GiB e não é exibido.',
  gpuShared: 'O contador de memória compartilhada da GPU não respondeu.',
  cpuClock: 'Requer a identificação da CPU.',
  ramSpeed: 'A velocidade não foi informada pelo SMBIOS.',
  ramVoltage: 'A tensão não foi informada pelo SMBIOS.',
  ramModules: 'O CIM não listou os módulos instalados.',
  spec: 'Ainda não identificado nesta sessão.'
} as const

/**
 * O botão que resolve o "—" de temperatura/potência da CPU fica no topo da aba,
 * então o tooltip diz onde clicar em vez de só explicar o motivo do traço.
 */
const INSTALL_HINT = 'Clique em "Instalar sensores avançados", no topo desta aba.'

const GPU_VENDOR_LABEL: Record<HwGpuVendor, string> = {
  nvidia: 'NVIDIA',
  amd: 'AMD',
  intel: 'Intel',
  other: 'Outro'
}

const CPU_TEMP_SOURCE_LABEL: Record<HwCpuTempSource, string> = {
  measured: 'driver',
  acpi: 'ACPI (aprox.)',
  unavailable: 'sem leitura'
}

// Rótulo e tom de cada fonte de energia — estimativa nunca veste roupa de medição.
const POWER_SOURCE_LABEL: Record<HwPowerSourceCpu, string> = {
  measured: 'medido',
  estimated: 'estimado',
  unavailable: 'sem leitura'
}

const POWER_SOURCE_TONE: Record<HwPowerSourceCpu, BadgeTone> = {
  measured: 'success',
  estimated: 'accent',
  unavailable: 'neutral'
}

const DRIVER_LABEL: Record<DriverStatus, string> = {
  absent: 'não instalado',
  present: 'instalado (leitura inativa)',
  ready: 'ativo'
}

const DRIVER_TONE: Record<DriverStatus, 'neutral' | 'warning' | 'success'> = {
  absent: 'neutral',
  present: 'warning',
  ready: 'success'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validação estrutural do que chega do main (o renderer não confia no IPC). */
function isHwSnapshot(value: unknown): value is HwSnapshot {
  if (!isRecord(value)) return false
  if (
    typeof value.capturedAt !== 'string' ||
    !isRecord(value.power) ||
    !isRecord(value.cpu) ||
    !isRecord(value.ram) ||
    !isRecord(value.gpu) ||
    !isRecord(value.specs) ||
    !isRecord(value.sources)
  ) {
    return false
  }

  // Campos aditivos (fabricante/driver/VRAM e origens de temperatura/uso) são
  // OPCIONAIS: um payload de versão anterior continua válido. Tipo errado,
  // porém, descarta o snapshot inteiro — nunca renderizamos valor suspeito.
  const gpu = value.gpu
  if (
    gpu.vendor !== undefined &&
    gpu.vendor !== null &&
    gpu.vendor !== 'nvidia' &&
    gpu.vendor !== 'amd' &&
    gpu.vendor !== 'intel' &&
    gpu.vendor !== 'other'
  ) {
    return false
  }
  const optionalText = (candidate: unknown): boolean =>
    candidate === undefined || candidate === null || typeof candidate === 'string'
  const optionalNumber = (candidate: unknown): boolean =>
    candidate === undefined ||
    candidate === null ||
    (typeof candidate === 'number' && Number.isFinite(candidate))
  if (!optionalText(gpu.driverVersion) || !optionalText(gpu.driverDate)) return false
  if (!optionalNumber(gpu.vramTotalMb) || !optionalNumber(gpu.usagePercent)) return false
  if (!optionalNumber(gpu.fanRpm)) return false
  // Tensão de CPU é aditiva: ausente/`null` vale, mas valor não numérico
  // descarta o snapshot inteiro — a UI nunca renderiza número suspeito.
  if (!optionalNumber(value.cpu.voltageV)) return false

  const sources = value.sources
  const isAbsent = (candidate: unknown): boolean => candidate === undefined || candidate === null
  if (
    !isAbsent(sources.cpuTemp) &&
    sources.cpuTemp !== 'measured' &&
    sources.cpuTemp !== 'acpi' &&
    sources.cpuTemp !== 'unavailable'
  ) {
    return false
  }
  if (
    !isAbsent(sources.gpuUsage) &&
    sources.gpuUsage !== 'measured' &&
    sources.gpuUsage !== 'unavailable'
  ) {
    return false
  }
  if (
    !isAbsent(sources.gpuTemp) &&
    sources.gpuTemp !== 'measured' &&
    sources.gpuTemp !== 'unavailable'
  ) {
    return false
  }
  return true
}

function isDriverStatusInfo(value: unknown): value is DriverStatusInfo {
  if (!isRecord(value)) return false
  const state = value.state
  // `outdated` é aditivo: payload de versão anterior (ausente) continua válido.
  if (value.outdated !== undefined && typeof value.outdated !== 'boolean') return false
  return (
    (state === 'absent' || state === 'present' || state === 'ready') &&
    typeof value.filePresent === 'boolean' &&
    typeof value.serviceInstalled === 'boolean' &&
    typeof value.deviceAccessible === 'boolean'
  )
}

/** O renderer não confia no IPC: valida o estado da sobreposição antes de usar. */
function isHudStatus(value: unknown): value is HudStatus {
  if (!isRecord(value)) return false
  const config = value.config
  if (!isRecord(config)) return false
  if (typeof config.shortcut !== 'string' || typeof config.visible !== 'boolean') return false
  if (typeof config.width !== 'number' || !Number.isFinite(config.width)) return false
  if (config.scale !== 'compacta' && config.scale !== 'normal' && config.scale !== 'grande') {
    return false
  }
  if (typeof value.registered !== 'boolean') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return true
}

/** O renderer valida a leitura de FPS (número só com `state === 'live'`). */
function isFpsStatusInfo(value: unknown): value is FpsStatusInfo {
  if (!isRecord(value)) return false
  if (value.installed !== null && typeof value.installed !== 'boolean') return false
  if (typeof value.active !== 'boolean') return false
  return normalizeHudFpsReading(value.reading) !== null
}

function isFpsActivationResult(
  value: unknown
): value is { ok: boolean; cancelled?: boolean; error?: string } {
  if (!isRecord(value)) return false
  if (typeof value.ok !== 'boolean') return false
  if (value.cancelled !== undefined && typeof value.cancelled !== 'boolean') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return true
}

const FPS_SEAL: Record<FpsStatusInfo['reading']['state'], { text: string; tone: BadgeTone }> = {
  live: { text: 'FPS ao vivo', tone: 'success' },
  warming: { text: 'medindo…', tone: 'neutral' },
  'not-activated': { text: 'captura não ativada', tone: 'warning' },
  outdated: { text: 'captura desatualizada', tone: 'warning' },
  unavailable: { text: 'sem leitura', tone: 'warning' },
  'no-target': { text: 'sem jogo em foco', tone: 'neutral' },
  'no-presents': { text: 'em foco não apresenta', tone: 'neutral' }
}

function fpsSeal(status: FpsStatusInfo | null): { text: string; tone: BadgeTone } {
  if (!status) return { text: 'carregando…', tone: 'neutral' }
  if (status.reading.state === 'unavailable' && status.reading.reason === 'engine-missing') {
    return { text: 'captura indisponível', tone: 'warning' }
  }
  return FPS_SEAL[status.reading.state]
}

function fpsActionLabel(status: FpsStatusInfo | null): string | null {
  if (!status) return null
  if (status.reading.state === 'not-activated') return 'Tentar de novo'
  if (status.reading.state === 'outdated') return 'Atualizar'
  return null
}

function formatInt(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

function formatGhz(mhz: number): string {
  return formatDecimal(mhz / 1000, 2)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return DASH
  return date.toLocaleTimeString('pt-BR')
}

/** `YYYY-MM-DD` do CIM → `DD/MM/AAAA` (a data do driver é só informativa). */
function formatDriverDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso
}

/** O renderer não confia no IPC: qualquer coisa fora de número finito vira "sem leitura". */
function finiteWatts(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

interface ValueProps {
  value: number | null | undefined
  format?: (value: number) => string
  unit?: string
  title?: string
}

function Value({ value, format = formatInt, unit, title }: ValueProps): JSX.Element {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span title={title ?? 'Indisponível nesta leitura.'}>
        <span className="text-ink-tertiary">{DASH}</span>
      </span>
    )
  }
  return (
    <span>
      {format(value)}
      {unit ? <span className="ml-1 text-[10px] font-normal text-ink-tertiary">{unit}</span> : null}
    </span>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] py-1.5 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
        {label}
      </span>
      <span className="font-mono text-[12px] text-ink-primary">{children}</span>
    </div>
  )
}

function UsageBar({ percent }: { percent: number | null }): JSX.Element {
  const safe =
    percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent))
  return (
    <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
      <div className="h-full rounded-pill bg-accent" style={{ width: `${safe}%` }} />
    </div>
  )
}

interface PowerRowProps {
  testId: string
  label: string
  watts: number | null
  source: HwPowerSourceCpu
  /** Maior parcela do card: normaliza as barras para comparar peças entre si. */
  maxW: number
  title?: string
}

/** Barra de uma peça com o valor em W e a fonte explícita (medido/estimado). */
function PowerRow({ testId, label, watts, source, maxW, title }: PowerRowProps): JSX.Element {
  const available = watts !== null && Number.isFinite(watts)
  const width = available && maxW > 0 ? Math.min(100, Math.max(0, (watts / maxW) * 100)) : 0
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-ink-primary" data-testid={`${testId}-value`}>
            {available ? (
              <>
                {formatDecimal(watts, 1)}
                <span className="ml-1 text-[10px] font-normal text-ink-tertiary">W</span>
              </>
            ) : (
              <span className="text-ink-tertiary" title={title}>
                {DASH}
              </span>
            )}
          </span>
          <Badge tone={POWER_SOURCE_TONE[source]}>{POWER_SOURCE_LABEL[source]}</Badge>
        </span>
      </div>
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
        <div
          className={`h-full rounded-pill ${source === 'measured' ? 'bg-success' : 'bg-accent'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function CardTitle({ icon: Icon, title }: { icon: typeof Cpu; title: string }): JSX.Element {
  return (
    <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink-primary">
      <Icon size={18} className="text-accent" aria-hidden="true" />
      {title}
    </h3>
  )
}

export function PcMonitor(): JSX.Element {
  const reduced = useReducedMotion()
  const mountedRef = useRef(true)
  const [snapshot, setSnapshot] = useState<HwSnapshot | null>(null)
  const [driver, setDriver] = useState<DriverStatusInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Sobreposição (HUD): estado do atalho global + visibilidade persistida.
  const [hud, setHud] = useState<HudStatus | null>(null)
  const [hudRecording, setHudRecording] = useState(false)
  const [hudBusy, setHudBusy] = useState(false)
  const [hudNotice, setHudNotice] = useState<string | null>(null)
  const [hudError, setHudError] = useState<string | null>(null)
  const [hudSizeBusy, setHudSizeBusy] = useState(false)
  // Captura de FPS: selo/retry no Monitor (a ativação primária é o atalho).
  const [fpsStatus, setFpsStatus] = useState<FpsStatusInfo | null>(null)
  const [fpsBusy, setFpsBusy] = useState(false)
  // Intervalo de atualização do monitor (aba + HUD usam o MESMO timer no main).
  const [hwIntervalMs, setHwIntervalMs] = useState(HWMON_INTERVAL_DEFAULT_MS)
  const [hwIntervalBusy, setHwIntervalBusy] = useState(false)

  useEffect(() => {
    mountedRef.current = true

    const unsubscribe = window.api.onHwMonitorUpdate((value) => {
      if (!mountedRef.current) return
      if (isHwSnapshot(value)) setSnapshot(value)
    })

    // Polling começa ao montar a aba; o unmount abaixo chama hwmon:stop.
    void window.api.hwmonStart().catch(() => undefined)
    void window.api
      .hwmonSnapshot()
      .then((value) => {
        if (mountedRef.current && isHwSnapshot(value)) setSnapshot(value)
      })
      .catch(() => undefined)
    void window.api
      .hwmonDriverStatus()
      .then((info) => {
        if (mountedRef.current && isDriverStatusInfo(info)) setDriver(info)
      })
      .catch(() => undefined)
    // Intervalo persistido: o seletor mostra o que o main realmente usa.
    void window.api
      .hwmonGetInterval()
      .then((info) => {
        if (!mountedRef.current) return
        if (typeof info?.intervalMs === 'number' && Number.isFinite(info.intervalMs)) {
          setHwIntervalMs(info.intervalMs)
        }
      })
      .catch(() => undefined)
    void window.api
      .hudGet()
      .then((status) => {
        if (mountedRef.current && isHudStatus(status)) setHud(status)
      })
      .catch(() => undefined)
    void window.api
      .fpsStatus()
      .then((status) => {
        if (mountedRef.current && isFpsStatusInfo(status)) setFpsStatus(status)
      })
      .catch(() => undefined)

    // Atalho global/fora da aba: o main avisa quando a visibilidade muda.
    const unsubscribeHudStatus = window.api.onHudStatus((status) => {
      if (mountedRef.current && isHudStatus(status)) setHud(status)
    })

    return () => {
      mountedRef.current = false
      unsubscribe()
      unsubscribeHudStatus()
      void window.api.hwmonStop().catch(() => undefined)
    }
  }, [])

  // ── Sobreposição (HUD) ─────────────────────────────
  // Um único caminho para salvar o atalho: valida/registra no main e, em erro
  // (atalho em uso), mantém o anterior sem persistir nada.
  const applyHudShortcut = useCallback(async (accelerator: string): Promise<void> => {
    setHudBusy(true)
    setHudError(null)
    setHudNotice(null)
    try {
      const result = await window.api.hudSetShortcut(accelerator)
      if (!mountedRef.current) return
      if (isHudStatus(result.status)) setHud(result.status)
      if (!result.success) {
        setHudError(result.error ?? 'Não foi possível registrar o atalho.')
        return
      }
      setHudNotice(`Atalho ${formatAcceleratorLabel(accelerator)} registrado.`)
    } catch {
      if (mountedRef.current) {
        setHudError('Não foi possível salvar o atalho. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) {
        setHudBusy(false)
        setHudRecording(false)
      }
    }
  }, [])

  // Gravador: captura o próximo keydown com modificador e converte no mesmo
  // formato canônico que o main valida. Esc sozinho cancela.
  useEffect(() => {
    if (!hudRecording) return

    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (
        event.key === 'Escape' &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey
      ) {
        setHudRecording(false)
        return
      }
      const accelerator = acceleratorFromKeyEvent(event)
      if (!accelerator) return // tecla modificadora isolada: continua esperando
      void applyHudShortcut(accelerator)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return (): void => window.removeEventListener('keydown', onKeyDown, true)
  }, [hudRecording, applyHudShortcut])

  // O atalho global pode ligar/desligar o HUD com o Hub em segundo plano: ao
  // voltar o foco, relê o estado para o switch não mostrar informação velha.
  useEffect(() => {
    const refresh = (): void => {
      void window.api
        .hudGet()
        .then((status) => {
          if (mountedRef.current && isHudStatus(status)) setHud(status)
        })
        .catch(() => undefined)
      void window.api
        .fpsStatus()
        .then((status) => {
          if (mountedRef.current && isFpsStatusInfo(status)) setFpsStatus(status)
        })
        .catch(() => undefined)
    }
    window.addEventListener('focus', refresh)
    return (): void => window.removeEventListener('focus', refresh)
  }, [])

  const toggleHudVisible = async (): Promise<void> => {
    if (hudBusy) return
    setHudBusy(true)
    setHudError(null)
    setHudNotice(null)
    try {
      const status = await window.api.hudSetVisible(hud?.config.visible !== true)
      if (!mountedRef.current) return
      if (isHudStatus(status)) setHud(status)
    } catch {
      if (mountedRef.current) {
        setHudError('Não foi possível alterar a sobreposição. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setHudBusy(false)
    }
  }

  // Retry explícito da captura de FPS (o caminho primário continua sendo o
  // atalho; aqui o usuário pediu outra tentativa depois de recusa/atualização).
  const activateFps = async (): Promise<void> => {
    if (fpsBusy) return
    setFpsBusy(true)
    setHudError(null)
    setHudNotice(null)
    try {
      const result = await window.api.fpsActivate()
      if (!mountedRef.current) return
      if (isFpsActivationResult(result)) {
        if (result.cancelled) {
          setHudError('A permissão não foi concedida. Nada foi alterado.')
        } else if (!result.ok) {
          setHudError(result.error ?? 'Não foi possível ativar a captura de FPS.')
        }
      }
      const status = await window.api.fpsStatus()
      if (mountedRef.current && isFpsStatusInfo(status)) setFpsStatus(status)
    } catch {
      if (mountedRef.current) {
        setHudError('Não foi possível ativar a captura de FPS. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setFpsBusy(false)
    }
  }

  // Largura/escala: o main normaliza (clamp 180–560, passo 10) e aplica na
  // janela; a altura continua automática, medida pelo overlay.
  const applyHudSize = async (patch: { width?: number; scale?: HudScale }): Promise<void> => {
    if (hudSizeBusy) return
    setHudSizeBusy(true)
    setHudError(null)
    setHudNotice(null)
    try {
      const result = await window.api.hudSetSize(patch)
      if (!mountedRef.current) return
      if (isHudStatus(result.status)) setHud(result.status)
      if (!result.success) {
        setHudError(result.error ?? 'Não foi possível salvar o tamanho do HUD.')
        return
      }
      setHudNotice(
        `Tamanho do HUD: ${result.status.config.width} px · escala ${
          HUD_SCALE_LABEL[result.status.config.scale]
        }.`
      )
    } catch {
      if (mountedRef.current) {
        setHudError('Não foi possível salvar o tamanho do HUD. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setHudSizeBusy(false)
    }
  }

  const restoreHudSize = async (): Promise<void> => {
    await applyHudSize({ width: HUD_DEFAULT_WIDTH, scale: HUD_DEFAULT_SCALE })
  }

  // Intervalo do monitor: o main normaliza, persiste e devolve o valor efetivo.
  // O estado só anda com a resposta — nada de "meio caminho" na UI.
  const applyHwInterval = async (next: number): Promise<void> => {
    if (hwIntervalBusy) return
    setHwIntervalBusy(true)
    setError(null)
    try {
      const result = await window.api.hwmonSetInterval(next)
      if (!mountedRef.current) return
      if (result?.success && Number.isFinite(result.intervalMs)) {
        setHwIntervalMs(result.intervalMs)
        return
      }
      setError('Não foi possível salvar o intervalo de atualização do monitor.')
    } catch {
      if (mountedRef.current) {
        setError('Não foi possível salvar o intervalo de atualização do monitor. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setHwIntervalBusy(false)
    }
  }

  const installSensors = async (): Promise<void> => {
    if (installing) return
    setInstalling(true)
    setError(null)
    setNotice(null)
    try {
      const result: InstallDriverResult = await window.api.hwmonInstallDriver()
      if (!mountedRef.current) return
      if (result.cancelled) {
        setNotice('Instalação cancelada. Nenhuma alteração foi feita no sistema.')
        return
      }
      if (!result.ok) {
        setError(result.error ?? 'Não foi possível instalar os sensores avançados.')
        return
      }

      setNotice(result.error ?? 'Sensores avançados instalados.')
      const info = await window.api.hwmonDriverStatus()
      if (mountedRef.current && isDriverStatusInfo(info)) setDriver(info)
      const fresh = await window.api.hwmonSnapshot()
      if (mountedRef.current && isHwSnapshot(fresh)) setSnapshot(fresh)
    } catch {
      if (mountedRef.current) {
        setError('Não foi possível instalar os sensores avançados. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setInstalling(false)
    }
  }

  const driverState: DriverStatus = driver?.state ?? snapshot?.sources.driver ?? 'absent'
  const driverReady = driverState === 'ready'
  // Agente ativo, mas com script antigo (sem os registradores novos, ex.: SVI2):
  // o botão precisa reaparecer como "atualizar", mesmo com `state = ready`.
  const sensorsOutdated = driver?.outdated === true

  const power = snapshot?.power ?? null
  const cpu = snapshot?.cpu ?? null
  const ram = snapshot?.ram ?? null
  const gpu = snapshot?.gpu ?? null
  const specs = snapshot?.specs ?? null

  // Fabricante/origem vêm do snapshot; ausentes em payload antigo = desconhecido.
  const gpuVendor = gpu?.vendor ?? null
  const cpuTempSource: HwCpuTempSource = snapshot?.sources.cpuTemp ?? 'unavailable'
  const gpuUsageSource = snapshot?.sources.gpuUsage ?? 'unavailable'
  const gpuVendorLabel = gpuVendor ? GPU_VENDOR_LABEL[gpuVendor] : null
  const cpuTempTitle =
    cpuTempSource === 'acpi'
      ? 'Leitura ACPI do firmware — aproximada. O driver de sensores entrega a temperatura real do pacote.'
      : driverReady
        ? 'O driver de sensores não devolveu temperatura nesta leitura.'
        : `${DASH_TITLE.cpuTemp} ${INSTALL_HINT}`
  const cpuPowerTitle = driverReady
    ? 'O driver de sensores não devolveu potência nesta leitura.'
    : `${DASH_TITLE.cpuPower} ${INSTALL_HINT}`
  const gpuTempTitle =
    gpuVendor === null
      ? DASH_TITLE.gpu
      : gpuVendor === 'nvidia'
        ? 'O nvidia-smi não respondeu nesta leitura.'
        : `GPU ${GPU_VENDOR_LABEL[gpuVendor]}: temperatura não é exposta sem um driver de sensores.`
  const gpuModelTitle = gpu?.model ?? DASH_TITLE.gpu
  const gpuFanRpmTitle =
    gpuVendor === null
      ? DASH_TITLE.rpm
      : gpuVendor === 'nvidia'
        ? 'O NVML não devolveu RPM nesta leitura (driver antigo ou GPU sem ventoinha controlada).'
        : `GPU ${GPU_VENDOR_LABEL[gpuVendor]}: RPM não é exposto sem o Super I/O da placa.`

  const totalTitle = driverReady
    ? 'Aguardando uma leitura completa de CPU e GPU.'
    : DASH_TITLE.total

  // A fonte exibida deriva do valor efetivamente mostrado: "medido" só com
  // número medido, "estimado" com estimativa. Assim um snapshot parcial nunca
  // pinta uma estimativa como medição.
  const measuredCpuW = finiteWatts(power?.cpuW)
  const cpuPowerW = measuredCpuW ?? finiteWatts(power?.cpuEstimatedW)
  const gpuPowerW = finiteWatts(power?.gpuW)
  const platformW = finiteWatts(power?.platformEstimatedW)
  const measuredTotalW = finiteWatts(power?.totalMeasuredW)
  const totalW = measuredTotalW ?? finiteWatts(power?.totalEstimatedW)

  const cpuSource: HwPowerSourceCpu =
    cpuPowerW === null ? 'unavailable' : measuredCpuW !== null ? 'measured' : 'estimated'
  const gpuSource: HwPowerSourceGpu = gpuPowerW === null ? 'unavailable' : 'measured'
  const platformSource: HwPowerSourceCpu = platformW === null ? 'unavailable' : 'estimated'
  const totalSource: HwPowerSourceCpu =
    totalW === null ? 'unavailable' : measuredTotalW !== null ? 'measured' : 'estimated'
  const barMaxW = Math.max(cpuPowerW ?? 0, gpuPowerW ?? 0, platformW ?? 0, 1)

  // Intervalo vigente no texto do cabeçalho (a fonte da verdade é o main).
  const intervalLabel = formatIntervalLabel(hwIntervalMs)

  return (
    <div className="space-y-4" data-testid="hw-monitor">
      {/* ── Cabeçalho ────────────────────────────────────── */}
      <motion.div {...entranceProps(reduced, { y: -10 })}>
        <Card className="flex flex-col justify-between gap-4 p-5 md:flex-row md:items-center md:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-muted">
              <Activity size={22} className="text-accent" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
                Monitor de hardware
              </h3>
              <p className="max-w-xl text-[12px] leading-relaxed text-ink-secondary">
                Leitura ao vivo dos sensores desta máquina a cada {intervalLabel}. Tudo é lido
                localmente — nada sai daqui.
              </p>
              <p
                className="max-w-xl text-[10px] leading-relaxed text-ink-tertiary"
                data-testid="hw-interval-hint"
              >
                Intervalos curtos usam mais CPU. A coleta completa leva ~0,6 s; abaixo disso o Hub
                atualiza o mais rápido que consegue. Com só a sobreposição (HUD) ativa, ela atualiza
                1×/s; com esta aba aberta vale o intervalo acima.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={DRIVER_TONE[driverState]} data-testid="hw-driver-badge">
              Driver: {DRIVER_LABEL[driverState]}
            </Badge>
            <span className="text-[10px] text-ink-tertiary" data-testid="hw-last-updated">
              {snapshot ? `Última leitura: ${formatTime(snapshot.capturedAt)}` : 'Lendo sensores…'}
            </span>
            <div className="flex items-center gap-2">
              <label
                htmlFor="hw-interval"
                className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary"
              >
                Atualização
              </label>
              <div className="w-24 shrink-0">
                <Select
                  id="hw-interval"
                  aria-label="Intervalo de atualização do monitor"
                  value={String(hwIntervalMs)}
                  onChange={(event) => void applyHwInterval(Number(event.target.value))}
                  disabled={hwIntervalBusy}
                  data-testid="hw-interval-select"
                >
                  {HWMON_INTERVAL_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>
                      {formatIntervalLabel(ms)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </div>
        </Card>
      </motion.div>

      {/* ── Sensores avançados (driver opcional) ───────────
          Fica no topo de propósito: sem driver, a CPU mostra "—" em temperatura e
          potência — a ação que resolve o traço precisa estar à vista, sem rolar a
          página. O estado do driver continua no badge do cabeçalho, sem duplicar. */}
      <motion.div {...entranceProps(reduced, { y: 10 })} data-testid="hw-advanced-sensors">
        <Card className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:gap-6 md:p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold tracking-tight text-ink-primary">
                Sensores avançados para temperatura e potência da CPU
              </h3>
              <p
                className={`max-w-xl text-[11px] leading-relaxed ${
                  driverState === 'present' || sensorsOutdated ? 'text-warn' : 'text-ink-secondary'
                }`}
              >
                {driverState === 'absent'
                  ? 'Sem eles, temperatura e potência da CPU ficam em “—”. A instalação é opcional e pede 1 confirmação do Windows.'
                  : driverState === 'present'
                    ? 'Instalado, mas a leitura não está ativa — clique para ativar.'
                    : sensorsOutdated
                      ? 'Sensores ativos, mas a leitura elevada está incompleta (registradores ausentes ou restos do coletor antigo) — clique para atualizar.'
                      : 'Sensores avançados ativos — leitura elevada em segundo plano.'}
              </p>
              {driver?.error && !driverReady && (
                <p className="text-[11px] text-warn">{driver.error}</p>
              )}
            </div>
          </div>
          {(!driverReady || sensorsOutdated) && (
            <Button
              variant="secondary"
              size="md"
              onClick={() => void installSensors()}
              disabled={installing}
              data-testid="hw-install-driver"
              className="shrink-0"
            >
              {installing ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck size={14} aria-hidden="true" />
              )}
              {sensorsOutdated
                ? 'Atualizar leitura elevada (1 confirmação do Windows)'
                : driverState === 'present'
                  ? 'Ativar leitura elevada (1 confirmação do Windows)'
                  : 'Instalar sensores avançados (1 confirmação do Windows)'}
            </Button>
          )}
        </Card>
      </motion.div>

      {/* Feedback da instalação fica junto do botão (agora no topo): erro e aviso
          de cancelamento não podem nascer no fim de uma página longa. */}
      {error && (
        <motion.div
          {...entranceProps(reduced, { y: 10 })}
          role="alert"
          className="flex items-start gap-3 rounded-card border border-danger-border bg-danger-bg p-5"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div className="space-y-1">
            <p className="text-[13px] font-semibold text-danger">Algo não saiu como esperado</p>
            <p className="text-[11px] leading-relaxed text-ink-secondary">{error}</p>
          </div>
        </motion.div>
      )}

      {notice && (
        <p role="status" className="text-[11px] text-ink-tertiary">
          {notice}
        </p>
      )}

      {/* ── Energia (centralizada: total + peças) ────────── */}
      <motion.div {...entranceProps(reduced, { y: 10 })}>
        <Card className="space-y-4 p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle icon={Zap} title="Energia" />
            <Badge tone={POWER_SOURCE_TONE[totalSource]} data-testid="hw-total-power-badge">
              {POWER_SOURCE_LABEL[totalSource]}
            </Badge>
          </div>

          <p className="flex flex-wrap items-baseline gap-2">
            <span
              className="text-[34px] font-bold leading-none tracking-tight text-ink-primary"
              data-testid="hw-total-power"
            >
              {totalW === null ? (
                <span className="text-ink-tertiary" title={totalTitle}>
                  {DASH}
                </span>
              ) : (
                formatDecimal(totalW, 1)
              )}
            </span>
            <span className="text-[11px] text-ink-tertiary">W no total</span>
          </p>

          <div className="space-y-3">
            <PowerRow
              testId="hw-power-cpu"
              label="CPU (pacote)"
              watts={cpuPowerW}
              source={cpuSource}
              maxW={barMaxW}
              title={cpuPowerTitle}
            />
            <PowerRow
              testId="hw-power-gpu"
              label="GPU (board power)"
              watts={gpuPowerW}
              source={gpuSource}
              maxW={barMaxW}
              title={DASH_TITLE.gpu}
            />
            <PowerRow
              testId="hw-power-platform"
              label="Plataforma (placa, RAM, SSDs)"
              watts={platformW}
              source={platformSource}
              maxW={barMaxW}
              title={DASH_TITLE.platform}
            />
          </div>

          <p className="text-[10px] leading-relaxed text-ink-tertiary">
            GPU medida pelo nvidia-smi (NVIDIA); em AMD/Intel o uso vem do contador do Windows, mas
            a potência não é exposta sem driver. CPU e plataforma são <strong>estimadas</strong>{' '}
            pelo modelo fixo: classe térmica de 35 W + 4,5 W por núcleo (limitada a 45–150 W),
            proporcional ao uso da CPU
            {platformW !== null
              ? `, mais ${formatDecimal(platformW, 0)} W fixos de plataforma`
              : ''}
            . O total estimado só aparece com a GPU medida; o total medido soma apenas CPU + GPU.
            {!driverReady ? ' Instale os sensores avançados para medir a CPU.' : ''}
          </p>
        </Card>
      </motion.div>

      {/* ── CPU · RAM · GPU ──────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div {...entranceProps(reduced, { y: 10 })}>
          <Card className="space-y-3 p-5">
            <CardTitle icon={Cpu} title="CPU" />
            <p
              className="truncate text-[12px] font-semibold text-ink-primary"
              title={cpu?.model ?? 'Ainda não identificado'}
              data-testid="hw-cpu-model"
            >
              {cpu?.model ?? 'Detectando…'}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  Uso
                </span>
                <Value
                  value={cpu?.usagePercent ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="%"
                />
              </div>
              <UsageBar percent={cpu?.usagePercent ?? null} />
            </div>
            <Stat label="Clock efetivo">
              <Value
                value={cpu?.clockMhz ?? null}
                format={formatGhz}
                unit="GHz"
                title={DASH_TITLE.cpuClock}
              />
            </Stat>
            <Stat label="Temperatura (Tctl)">
              <span data-testid="hw-cpu-temp" className="inline-flex items-center gap-2">
                <Value
                  value={cpu?.tempC ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="°C"
                  title={cpuTempTitle}
                />
                {cpu?.tempC !== null && cpu?.tempC !== undefined ? (
                  <span
                    className="text-[10px] font-normal text-ink-tertiary"
                    data-testid="hw-cpu-temp-source"
                    title={
                      cpuTempSource === 'acpi'
                        ? 'Temperatura aproximada lida do firmware (ACPI); não é o pacote da CPU.'
                        : 'Temperatura lida pelo driver de sensores.'
                    }
                  >
                    {CPU_TEMP_SOURCE_LABEL[cpuTempSource]}
                  </span>
                ) : null}
              </span>
            </Stat>
            <Stat label="Potência">
              <span data-testid="hw-cpu-power">
                <Value
                  value={cpu?.watts ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="W"
                  title={cpuPowerTitle}
                />
              </span>
            </Stat>
            <Stat label="Tensão (Vcore)">
              <span data-testid="hw-cpu-voltage">
                <Value
                  value={cpu?.voltageV ?? null}
                  format={(value) => formatDecimal(value, 3)}
                  unit="V"
                  title={DASH_TITLE.cpuVoltage}
                />
              </span>
            </Stat>
            <Stat label="VRM">
              <span title={DASH_TITLE.vrm} className="text-ink-tertiary">
                {DASH}
              </span>
            </Stat>
          </Card>
        </motion.div>

        <motion.div {...entranceProps(reduced, { y: 10 })}>
          <Card className="space-y-3 p-5">
            <CardTitle icon={MemoryStick} title="RAM" />
            <p
              className="truncate text-[12px] font-semibold text-ink-primary"
              data-testid="hw-ram-installed"
            >
              {ram?.installedGb !== null && ram?.installedGb !== undefined
                ? `${formatDecimal(ram.installedGb, 1)} GB instalados`
                : 'Capacidade não identificada'}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  Em uso
                </span>
                <span className="font-mono text-[12px] text-ink-primary">
                  <Value
                    value={ram?.usedGb ?? null}
                    format={(value) => formatDecimal(value, 1)}
                    unit="GB"
                  />
                  <span className="mx-1 text-ink-tertiary">·</span>
                  <Value
                    value={ram?.usedPercent ?? null}
                    format={(value) => formatDecimal(value, 1)}
                    unit="%"
                  />
                </span>
              </div>
              <UsageBar percent={ram?.usedPercent ?? null} />
            </div>
            <Stat label="Velocidade">
              <Value value={ram?.speedMhz ?? null} unit="MHz" title={DASH_TITLE.ramSpeed} />
            </Stat>
            <Stat label="Tensão">
              <Value
                value={ram?.voltageV ?? null}
                format={(value) => formatDecimal(value, 2)}
                unit="V"
                title={DASH_TITLE.ramVoltage}
              />
            </Stat>
            <Stat label="Módulos">
              {specs?.ram ?? (
                <span className="text-ink-tertiary" title={DASH_TITLE.ramModules}>
                  {DASH}
                </span>
              )}
            </Stat>
          </Card>
        </motion.div>

        <motion.div {...entranceProps(reduced, { y: 10 })}>
          <Card className="space-y-3 p-5">
            <CardTitle icon={Gauge} title="GPU" />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {gpuVendorLabel ? (
                <Badge tone="neutral" data-testid="hw-gpu-vendor">
                  {gpuVendorLabel}
                </Badge>
              ) : null}
              <p
                className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ink-primary"
                title={gpuModelTitle}
                data-testid="hw-gpu-model"
              >
                {gpu?.model ?? 'GPU não detectada'}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  Uso
                </span>
                <Value
                  value={gpu?.usagePercent ?? null}
                  format={(value) => formatInt(value)}
                  unit="%"
                  title={gpuUsageSource === 'measured' ? undefined : DASH_TITLE.gpuUsage}
                />
              </div>
              <UsageBar percent={gpu?.usagePercent ?? null} />
            </div>
            <Stat label="Clock do núcleo">
              <Value value={gpu?.coreClockMhz ?? null} unit="MHz" title={DASH_TITLE.gpuClock} />
            </Stat>
            <Stat label="Clock da memória">
              <Value value={gpu?.memClockMhz ?? null} unit="MHz" title={DASH_TITLE.gpuClock} />
            </Stat>
            <Stat label="VRAM (usada / total)">
              <span className="font-mono text-[12px] text-ink-primary">
                <Value value={gpu?.vramUsedMb ?? null} title={DASH_TITLE.gpuVramUsed} />
                <span className="mx-1 text-ink-tertiary">/</span>
                <Value
                  value={gpu?.vramTotalMb ?? null}
                  unit="MiB"
                  title={DASH_TITLE.gpuVramTotal}
                />
              </span>
            </Stat>
            <Stat label="Driver">
              <span data-testid="hw-gpu-driver">
                {gpu?.driverVersion ? (
                  <>
                    {gpu.driverVersion}
                    {gpu.driverDate ? (
                      <span className="ml-1 text-[10px] font-normal text-ink-tertiary">
                        · {formatDriverDate(gpu.driverDate)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-ink-tertiary" title={DASH_TITLE.gpuDriver}>
                    {DASH}
                  </span>
                )}
              </span>
            </Stat>
            <Stat label="Memória compartilhada">
              <Value
                value={gpu?.sharedMb ?? null}
                format={(value) => formatDecimal(value, 0)}
                unit="MiB"
                title={DASH_TITLE.gpuShared}
              />
            </Stat>
            <Stat label="Temperatura">
              <Value
                value={gpu?.tempC ?? null}
                format={(value) => formatDecimal(value, 1)}
                unit="°C"
                title={gpuTempTitle}
              />
            </Stat>
            <Stat label="Ventoinha (%)">
              <Value
                value={gpu?.fanPercent ?? null}
                format={(value) => formatInt(value)}
                unit="%"
                title={DASH_TITLE.gpuPower}
              />
            </Stat>
            <Stat label="Ventoinha (RPM)">
              <span data-testid="hw-gpu-fan-rpm">
                <Value
                  value={gpu?.fanRpm ?? null}
                  format={(value) => formatInt(value)}
                  unit="RPM"
                  title={gpuFanRpmTitle}
                />
              </span>
            </Stat>
            <Stat label="Potência">
              <span>
                <Value
                  value={gpu?.watts ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="W"
                  title={DASH_TITLE.gpuPower}
                />
                {gpu?.powerLimitW !== null && gpu?.powerLimitW !== undefined ? (
                  <span className="text-[10px] text-ink-tertiary">
                    {' '}
                    / {formatDecimal(gpu.powerLimitW, 0)} W
                  </span>
                ) : null}
              </span>
            </Stat>
          </Card>
        </motion.div>
      </div>

      {/* ── Sobreposição (HUD) ───────────────────────────── */}
      <motion.div {...entranceProps(reduced, { y: 10 })}>
        <Card className="space-y-4 p-5 md:p-6" data-testid="hud-settings">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle icon={Monitor} title="Sobreposição (HUD)" />
            <Badge
              tone={hud?.registered ? 'success' : hud === null ? 'neutral' : 'warning'}
              data-testid="hud-status"
            >
              {hud === null
                ? 'carregando…'
                : hud.registered
                  ? 'atalho registrado'
                  : 'atalho não registrado'}
            </Badge>
          </div>

          <p className="max-w-3xl text-[12px] leading-relaxed text-ink-secondary">
            Uma janela compacta sempre no topo com CPU, GPU, RAM e energia. Ela não aparece na barra
            de tarefas, não rouba o foco e os cliques atravessam para o que estiver atrás. O atalho
            funciona mesmo com o Hub em segundo plano.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className="rounded-control border border-[var(--border-strong)] bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink-primary"
              data-testid="hud-shortcut-value"
            >
              {hud ? formatAcceleratorLabel(hud.config.shortcut) : DASH}
            </span>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setHudRecording((current) => !current)}
              disabled={hudBusy || hud === null}
              aria-pressed={hudRecording}
              data-testid="hud-shortcut-record"
            >
              {hudRecording ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Keyboard size={14} aria-hidden="true" />
              )}
              {hudRecording ? 'Pressione a combinação…' : 'Alterar atalho'}
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => void applyHudShortcut(HUD_DEFAULT_SHORTCUT)}
              disabled={hudBusy || hud === null}
              data-testid="hud-shortcut-reset"
            >
              <RotateCcw size={14} aria-hidden="true" />
              Restaurar padrão
            </Button>
          </div>

          <p className="text-[10px] text-ink-tertiary">
            Padrão: {formatAcceleratorLabel(HUD_DEFAULT_SHORTCUT)}. A combinação precisa de pelo
            menos um modificador (Ctrl, Alt, Shift ou Win). Esc cancela a captura.
          </p>

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-1.5">
                <label
                  htmlFor="hud-width"
                  className="block text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary"
                >
                  Largura do HUD
                </label>
                <Select
                  id="hud-width"
                  value={String(hud?.config.width ?? HUD_DEFAULT_WIDTH)}
                  onChange={(event) => void applyHudSize({ width: Number(event.target.value) })}
                  disabled={hudSizeBusy || hud === null}
                  data-testid="hud-width-select"
                >
                  {HUD_WIDTH_OPTIONS.map((width) => (
                    <option key={width} value={width}>
                      {width} px
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="hud-scale"
                  className="block text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary"
                >
                  Escala dos valores
                </label>
                <Select
                  id="hud-scale"
                  value={hud?.config.scale ?? HUD_DEFAULT_SCALE}
                  onChange={(event) => void applyHudSize({ scale: event.target.value as HudScale })}
                  disabled={hudSizeBusy || hud === null}
                  data-testid="hud-scale-select"
                >
                  {HUD_SCALES.map((scale) => (
                    <option key={scale} value={scale}>
                      {HUD_SCALE_LABEL[scale]}
                    </option>
                  ))}
                </Select>
              </div>

              <Button
                variant="ghost"
                size="md"
                onClick={() => void restoreHudSize()}
                disabled={hudSizeBusy || hud === null}
                data-testid="hud-size-reset"
                className="lg:mb-0.5"
              >
                <RotateCcw size={14} aria-hidden="true" />
                Restaurar tamanho padrão
              </Button>
            </div>

            <p className="text-[10px] leading-relaxed text-ink-tertiary" data-testid="hud-position">
              Posição fixa: <strong>canto superior esquerdo</strong> do monitor primário (margem de
              12 px). A altura é automática — o HUD cresce com o conteúdo e nunca corta informação.
              Largura: 180–560 px (padrão {HUD_DEFAULT_WIDTH} px).
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border-subtle)] pt-4">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-ink-primary">Mostrar sobreposição</h4>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-secondary">
                Liga/desliga agora e lembra a escolha na próxima abertura do Hub.
              </p>
            </div>
            <Switch
              aria-label="Mostrar sobreposição (HUD)"
              checked={hud?.config.visible === true}
              disabled={hudBusy || hud === null}
              onCheckedChange={() => void toggleHudVisible()}
              data-testid="hud-visible-switch"
              className="shrink-0"
            />
          </div>

          <div className="flex flex-wrap items-start justify-between gap-4 border-t border-[var(--border-subtle)] pt-4">
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-ink-primary">FPS do app em foco</h4>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-ink-secondary">
                Abra o jogo e use o atalho: a faixa mostra o FPS do app em primeiro plano. Sem jogo
                em foco, aparece “—” com a instrução.
              </p>
              <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-ink-tertiary">
                A ativação acontece no primeiro atalho e pede permissão de administrador uma única
                vez (leitura por ETW). Nada é injetado no jogo.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge tone={fpsSeal(fpsStatus).tone} data-testid="fps-capture-status">
                {fpsSeal(fpsStatus).text}
              </Badge>
              {fpsActionLabel(fpsStatus) && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => void activateFps()}
                  disabled={fpsBusy}
                  data-testid="fps-capture-action"
                >
                  {fpsBusy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  {fpsActionLabel(fpsStatus)}
                </Button>
              )}
            </div>
          </div>

          {(hudError ?? hud?.error) && (
            <p role="alert" className="text-[11px] text-danger" data-testid="hud-error">
              {hudError ?? hud?.error}
            </p>
          )}
          {hudNotice && (
            <p role="status" className="text-[11px] text-ink-tertiary">
              {hudNotice}
            </p>
          )}

          <p className="max-w-3xl text-[10px] leading-relaxed text-ink-tertiary">
            Funciona sobre jogos em <strong>janela</strong> ou <strong>borderless</strong>. Em tela
            cheia exclusiva o jogo pode cobrir a sobreposição — use o modo borderless para vê-la. A
            janela é do próprio Hub: nada é injetado no jogo.
          </p>
        </Card>
      </motion.div>

      {/* ── Especificações identificadas ─────────────────── */}
      <motion.div {...entranceProps(reduced, { y: 10 })}>
        <Card className="space-y-3 p-5">
          <CardTitle icon={CircuitBoard} title="Especificações identificadas" />
          <dl className="grid gap-3 text-[12px] md:grid-cols-2">
            {[
              { label: 'CPU', value: specs?.cpu },
              { label: 'GPU', value: specs?.gpu },
              { label: 'RAM', value: specs?.ram },
              { label: 'Placa-mãe', value: specs?.board }
            ].map((row) => (
              <div
                key={row.label}
                className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-3"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  {row.label}
                </dt>
                <dd className="mt-1 text-ink-primary">
                  {row.value ?? (
                    <span className="text-ink-tertiary" title={DASH_TITLE.spec}>
                      {DASH}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </motion.div>
    </div>
  )
}
