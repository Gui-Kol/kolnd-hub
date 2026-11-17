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
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Square,
  Zap
} from 'lucide-react'
import type {
  DriverStatus,
  DriverStatusInfo,
  FpsAutoStatus,
  FpsInactiveReason,
  FpsState,
  FpsStatusInfo,
  FpsUpdate,
  HudScale,
  HudStatus,
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

const DASH_TITLE = {
  cpuTemp: 'Requer o driver de sensores avançados (WinRing0) instalado.',
  cpuPower: 'Requer o driver de sensores avançados (WinRing0) instalado.',
  total: 'Requer a potência medida da CPU (driver) e da GPU (nvidia-smi).',
  platform: 'Sem fonte mensurável sem driver; o consumo da plataforma é estimado.',
  vrm: 'VRM exige leitura do Super I/O da placa; não suportado nesta fase.',
  rpm: 'O nvidia-smi expõe apenas percentual; RPM exigiria o Super I/O da placa.',
  gpu: 'A GPU não respondeu ao nvidia-smi nesta leitura.'
} as const

const FPS_REASON_TEXT: Record<FpsInactiveReason, string> = {
  'not-started': 'Ative a medição para ver o FPS da janela em primeiro plano.',
  'no-target':
    'Nenhum app com apresentações em primeiro plano. O próprio Hub, o Explorer e o DWM são ignorados.',
  'no-presents': 'O app em primeiro plano não apresentou quadros nesta janela.',
  'helper-stopped': 'A medição está parada.'
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
  present: 'instalado (device indisponível)',
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
  return (
    typeof value.capturedAt === 'string' &&
    isRecord(value.power) &&
    isRecord(value.cpu) &&
    isRecord(value.ram) &&
    isRecord(value.gpu) &&
    isRecord(value.specs) &&
    isRecord(value.sources)
  )
}

function isDriverStatusInfo(value: unknown): value is DriverStatusInfo {
  if (!isRecord(value)) return false
  const state = value.state
  return (
    (state === 'absent' || state === 'present' || state === 'ready') &&
    typeof value.filePresent === 'boolean' &&
    typeof value.serviceInstalled === 'boolean' &&
    typeof value.deviceAccessible === 'boolean'
  )
}

function isFpsState(value: unknown): value is FpsState {
  return value === 'off' || value === 'starting' || value === 'running' || value === 'error'
}

/** O renderer não confia no IPC: valida forma e faixas antes de renderizar. */
function isFpsUpdate(value: unknown): value is FpsUpdate {
  if (!isRecord(value)) return false
  if (!isFpsState(value.state)) return false
  if (typeof value.active !== 'boolean') return false
  if (!(
    value.pid === null ||
    (typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0)
  )) {
    return false
  }
  if (!(
    value.processName === null ||
    (typeof value.processName === 'string' && value.processName.length <= 260)
  )) {
    return false
  }
  const optionalNumber = (candidate: unknown): boolean =>
    candidate === null ||
    (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0)
  if (!optionalNumber(value.fps) || !optionalNumber(value.frametimeMs)) return false
  if (typeof value.capturedAt !== 'string') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return true
}

function isFpsStatusInfo(value: unknown): value is FpsStatusInfo {
  if (!isRecord(value)) return false
  if (!isFpsState(value.state)) return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  return value.last === null || isFpsUpdate(value.last)
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

/** O renderer valida o estado do FPS automático antes de exibir botões/valores. */
function isFpsAutoStatus(value: unknown): value is FpsAutoStatus {
  if (!isRecord(value)) return false
  if (
    value.state !== 'off' &&
    value.state !== 'installing' &&
    value.state !== 'running' &&
    value.state !== 'stale' &&
    value.state !== 'error'
  ) {
    return false
  }
  if (typeof value.installed !== 'boolean' || typeof value.sinkDir !== 'string') return false
  if (value.error !== undefined && typeof value.error !== 'string') return false
  if (value.sample === null) return true
  if (!isRecord(value.sample)) return false
  const sample = value.sample
  return (
    typeof sample.pid === 'number' &&
    Number.isSafeInteger(sample.pid) &&
    sample.pid > 0 &&
    typeof sample.name === 'string' &&
    typeof sample.fps === 'number' &&
    Number.isFinite(sample.fps) &&
    typeof sample.frametimeMs === 'number' &&
    Number.isFinite(sample.frametimeMs) &&
    typeof sample.timestamp === 'string'
  )
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
  const [fps, setFps] = useState<FpsUpdate | null>(null)
  const [fpsStatus, setFpsStatus] = useState<FpsStatusInfo | null>(null)
  const [fpsBusy, setFpsBusy] = useState(false)
  const [fpsNotice, setFpsNotice] = useState<string | null>(null)
  const [fpsError, setFpsError] = useState<string | null>(null)
  // Sobreposição (HUD): estado do atalho global + visibilidade persistida.
  const [hud, setHud] = useState<HudStatus | null>(null)
  const [hudRecording, setHudRecording] = useState(false)
  const [hudBusy, setHudBusy] = useState(false)
  const [hudNotice, setHudNotice] = useState<string | null>(null)
  const [hudError, setHudError] = useState<string | null>(null)
  const [hudSizeBusy, setHudSizeBusy] = useState(false)
  // FPS automático (tarefa agendada no logon): status passivo + instalar/remover.
  const [autoFps, setAutoFps] = useState<FpsAutoStatus | null>(null)
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoNotice, setAutoNotice] = useState<string | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

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
    void window.api
      .hudGet()
      .then((status) => {
        if (mountedRef.current && isHudStatus(status)) setHud(status)
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

  useEffect(() => {
    mountedRef.current = true

    const unsubscribe = window.api.onFpsUpdate((value) => {
      if (!mountedRef.current || !isFpsUpdate(value)) return
      setFps(value)
      setFpsStatus({ state: value.state, last: value, error: value.error })
    })

    void window.api
      .fpsStatus()
      .then((info) => {
        if (!mountedRef.current || !isFpsStatusInfo(info)) return
        setFpsStatus(info)
        if (info.last) setFps(info.last)
      })
      .catch(() => undefined)

    // FPS automático: o main publica a cada mudança de amostra (1 Hz), então a
    // UI reflete o agent sem polling próprio.
    const unsubscribeAuto = window.api.onFpsAutoUpdate((value) => {
      if (mountedRef.current && isFpsAutoStatus(value)) setAutoFps(value)
    })
    void window.api
      .fpsAutoStatus()
      .then((status) => {
        if (mountedRef.current && isFpsAutoStatus(status)) setAutoFps(status)
      })
      .catch(() => undefined)

    // Não paramos a medição no unmount: ela é opt-in e explícita. O usuário
    // pode voltar à aba sem um novo UAC; o helper é encerrado por "Parar
    // medição" ou no will-quit, com heartbeat impedindo órfãos.
    return () => {
      unsubscribe()
      unsubscribeAuto()
    }
  }, [])

  const startFps = async (): Promise<void> => {
    if (fpsBusy) return
    setFpsBusy(true)
    setFpsError(null)
    setFpsNotice(null)
    try {
      const result = await window.api.fpsStart()
      if (!mountedRef.current) return
      if (isFpsStatusInfo(result.status)) setFpsStatus(result.status)
      if (result.cancelled) {
        setFpsNotice('Permissão de administrador não concedida. Nada foi alterado no sistema.')
        return
      }
      if (!result.ok) {
        setFpsError(result.error ?? 'Não foi possível iniciar a medição de FPS.')
        return
      }
      setFps({
        state: 'starting',
        active: false,
        pid: null,
        processName: null,
        fps: null,
        frametimeMs: null,
        capturedAt: new Date().toISOString(),
        reason: 'not-started'
      })
      setFpsNotice('Aguardando o helper de eventos abrir a sessão do Windows…')
    } catch {
      if (mountedRef.current) {
        setFpsError('Não foi possível iniciar a medição de FPS. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setFpsBusy(false)
    }
  }

  const stopFps = async (): Promise<void> => {
    if (fpsBusy) return
    setFpsBusy(true)
    setFpsError(null)
    try {
      await window.api.fpsStop()
      if (!mountedRef.current) return
      setFps({
        state: 'off',
        active: false,
        pid: null,
        processName: null,
        fps: null,
        frametimeMs: null,
        capturedAt: new Date().toISOString(),
        reason: 'helper-stopped'
      })
      setFpsNotice('Medição de FPS parada.')
    } catch {
      if (mountedRef.current) setFpsError('Não foi possível parar a medição de FPS.')
    } finally {
      if (mountedRef.current) setFpsBusy(false)
    }
  }

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

  // FPS automático: instalar/remover sempre pede confirmação do Windows (UAC).
  const installAutoFps = async (): Promise<void> => {
    if (autoBusy) return
    setAutoBusy(true)
    setAutoError(null)
    setAutoNotice(null)
    try {
      const result = await window.api.fpsAutoInstall()
      if (!mountedRef.current) return
      if (isFpsAutoStatus(result.status)) setAutoFps(result.status)
      if (result.cancelled) {
        setAutoNotice('Permissão do Windows não concedida. Nada foi alterado.')
        return
      }
      if (!result.ok) {
        setAutoError(result.error ?? 'Não foi possível ativar o FPS automático.')
        return
      }
      setAutoNotice(
        'FPS automático ativado. Ao apertar Shift+Insert no jogo, o FPS já aparece sem pedir nada.'
      )
    } catch {
      if (mountedRef.current) {
        setAutoError('Não foi possível ativar o FPS automático. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setAutoBusy(false)
    }
  }

  const removeAutoFps = async (): Promise<void> => {
    if (autoBusy) return
    setAutoBusy(true)
    setAutoError(null)
    setAutoNotice(null)
    try {
      const result = await window.api.fpsAutoRemove()
      if (!mountedRef.current) return
      if (isFpsAutoStatus(result.status)) setAutoFps(result.status)
      if (result.cancelled) {
        setAutoNotice('Permissão do Windows não concedida. Nada foi alterado.')
        return
      }
      if (!result.ok) {
        setAutoError(result.error ?? 'Não foi possível desativar o FPS automático.')
        return
      }
      setAutoNotice('FPS automático desativado. A tarefa e a amostra foram removidas.')
    } catch {
      if (mountedRef.current) {
        setAutoError('Não foi possível desativar o FPS automático. Tente novamente.')
      }
    } finally {
      if (mountedRef.current) setAutoBusy(false)
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

  const power = snapshot?.power ?? null
  const cpu = snapshot?.cpu ?? null
  const ram = snapshot?.ram ?? null
  const gpu = snapshot?.gpu ?? null
  const specs = snapshot?.specs ?? null

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

  // ── Desempenho (FPS por ETW) ───────────────────────
  const fpsState: FpsState = fps?.state ?? fpsStatus?.state ?? 'off'
  const fpsActive = fpsState === 'running' && fps?.active === true
  const fpsValue = fpsActive ? (fps?.fps ?? null) : null
  const fpsFrametime = fpsActive ? (fps?.frametimeMs ?? null) : null
  const fpsProcessName = fpsActive ? (fps?.processName ?? null) : null
  const fpsBadgeLabel = fpsActive
    ? 'ao vivo'
    : fpsState === 'starting'
      ? 'iniciando…'
      : fpsState === 'error'
        ? 'erro'
        : '—'
  // Verde só com número na tela; rodando sem alvo continua "—" neutro.
  const fpsBadgeTone = fpsActive
    ? 'success'
    : fpsState === 'starting'
      ? 'accent'
      : fpsState === 'error'
        ? 'danger'
        : 'neutral'
  const fpsErrorText = fpsError ?? fps?.error ?? fpsStatus?.error ?? null
  const fpsReason: FpsInactiveReason =
    fps?.reason ?? (fpsState === 'off' && !fps ? 'not-started' : 'helper-stopped')
  const fpsReasonText = fpsActive
    ? 'Medindo a janela em primeiro plano agora.'
    : fpsState === 'starting'
      ? 'Abrindo a sessão de eventos com permissão de administrador…'
      : fpsState === 'error'
        ? 'A medição parou. Veja o erro acima e tente ativar de novo.'
        : FPS_REASON_TEXT[fpsReason]
  const canStartFps = fpsState === 'off' || fpsState === 'error'

  // ── FPS automático (tarefa no logon) ──────────────
  const autoInstalled = autoFps?.installed === true
  const autoActive = autoFps?.state === 'running' && autoFps?.sample !== null
  const autoBadgeLabel =
    autoFps === null
      ? 'carregando…'
      : autoFps.state === 'installing'
        ? 'ativando…'
        : autoFps.state === 'running'
          ? autoActive
            ? 'ao vivo'
            : 'sem alvo'
          : autoFps.state === 'stale'
            ? 'agent parado'
            : autoFps.state === 'error'
              ? 'erro'
              : 'desligado'
  const autoBadgeTone: BadgeTone =
    autoFps?.state === 'running' && autoActive
      ? 'success'
      : autoFps?.state === 'installing'
        ? 'accent'
        : autoFps?.state === 'error'
          ? 'danger'
          : autoFps?.state === 'stale'
            ? 'warning'
            : 'neutral'
  const autoErrorText = autoError ?? autoFps?.error ?? null

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
                Leitura ao vivo dos sensores desta máquina a cada segundo. Tudo é lido localmente —
                nada sai daqui.
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
          </div>
        </Card>
      </motion.div>

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
              title={DASH_TITLE.cpuPower}
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
            GPU medida pelo nvidia-smi. CPU e plataforma são <strong>estimadas</strong> pelo modelo
            fixo: classe térmica de 35 W + 4,5 W por núcleo (limitada a 45–150 W), proporcional ao
            uso da CPU
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
                title="Requer a identificação da CPU."
              />
            </Stat>
            <Stat label="Temperatura (Tctl)">
              <span data-testid="hw-cpu-temp">
                <Value
                  value={cpu?.tempC ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="°C"
                  title={DASH_TITLE.cpuTemp}
                />
              </span>
            </Stat>
            <Stat label="Potência">
              <span data-testid="hw-cpu-power">
                <Value
                  value={cpu?.watts ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="W"
                  title={DASH_TITLE.cpuPower}
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
              <Value value={ram?.speedMhz ?? null} unit="MHz" />
            </Stat>
            <Stat label="Tensão">
              <Value
                value={ram?.voltageV ?? null}
                format={(value) => formatDecimal(value, 2)}
                unit="V"
              />
            </Stat>
            <Stat label="Módulos">
              {specs?.ram ?? <span className="text-ink-tertiary">{DASH}</span>}
            </Stat>
          </Card>
        </motion.div>

        <motion.div {...entranceProps(reduced, { y: 10 })}>
          <Card className="space-y-3 p-5">
            <CardTitle icon={Gauge} title="GPU" />
            <p
              className="truncate text-[12px] font-semibold text-ink-primary"
              title={gpu?.model ?? 'Nenhuma GPU NVIDIA respondeu'}
              data-testid="hw-gpu-model"
            >
              {gpu?.model ?? 'GPU não detectada'}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                  Uso
                </span>
                <Value
                  value={gpu?.usagePercent ?? null}
                  format={(value) => formatInt(value)}
                  unit="%"
                  title={DASH_TITLE.gpu}
                />
              </div>
              <UsageBar percent={gpu?.usagePercent ?? null} />
            </div>
            <Stat label="Clock do núcleo">
              <Value value={gpu?.coreClockMhz ?? null} unit="MHz" title={DASH_TITLE.gpu} />
            </Stat>
            <Stat label="Clock da memória">
              <Value value={gpu?.memClockMhz ?? null} unit="MHz" title={DASH_TITLE.gpu} />
            </Stat>
            <Stat label="VRAM">
              <span className="font-mono text-[12px] text-ink-primary">
                <Value value={gpu?.vramUsedMb ?? null} title={DASH_TITLE.gpu} />
                <span className="mx-1 text-ink-tertiary">/</span>
                <Value value={gpu?.vramTotalMb ?? null} unit="MB" title={DASH_TITLE.gpu} />
              </span>
            </Stat>
            <Stat label="Memória compartilhada">
              <Value
                value={gpu?.sharedMb ?? null}
                format={(value) => formatDecimal(value, 0)}
                unit="MB"
              />
            </Stat>
            <Stat label="Temperatura">
              <Value
                value={gpu?.tempC ?? null}
                format={(value) => formatDecimal(value, 1)}
                unit="°C"
                title={DASH_TITLE.gpu}
              />
            </Stat>
            <Stat label="Ventoinha (%)">
              <Value
                value={gpu?.fanPercent ?? null}
                format={(value) => formatInt(value)}
                unit="%"
                title={DASH_TITLE.gpu}
              />
            </Stat>
            <Stat label="Ventoinha (RPM)">
              <span title={DASH_TITLE.rpm} className="text-ink-tertiary">
                {DASH}
              </span>
            </Stat>
            <Stat label="Potência">
              <span>
                <Value
                  value={gpu?.watts ?? null}
                  format={(value) => formatDecimal(value, 1)}
                  unit="W"
                  title={DASH_TITLE.gpu}
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

      {/* ── Desempenho: FPS/frametime por ETW ────────────── */}
      <motion.div {...entranceProps(reduced, { y: 10 })}>
        <Card className="space-y-4 p-5 md:p-6" data-testid="fps-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle icon={Gauge} title="Desempenho" />
            <Badge tone={fpsBadgeTone} data-testid="fps-badge">
              {fpsBadgeLabel}
            </Badge>
          </div>

          <div className="flex flex-wrap items-end gap-6">
            <p className="flex items-baseline gap-2">
              <span
                className="text-[40px] font-bold leading-none tracking-tight text-ink-primary"
                data-testid="fps-value"
              >
                {fpsValue === null ? (
                  <span className="text-ink-tertiary">{DASH}</span>
                ) : (
                  formatInt(fpsValue)
                )}
              </span>
              <span className="text-[11px] text-ink-tertiary">FPS</span>
            </p>
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Frametime
              </p>
              <p className="font-mono text-[16px] text-ink-primary" data-testid="fps-frametime">
                {fpsFrametime === null ? (
                  <span className="text-ink-tertiary">{DASH}</span>
                ) : (
                  <>
                    {formatDecimal(fpsFrametime, 1)}
                    <span className="ml-1 text-[10px] font-normal text-ink-tertiary">ms</span>
                  </>
                )}
              </p>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Processo
              </p>
              <p
                className="max-w-[240px] truncate font-mono text-[13px] text-ink-primary"
                title={fpsProcessName ?? undefined}
                data-testid="fps-process"
              >
                {fpsProcessName ?? <span className="text-ink-tertiary">{DASH}</span>}
              </p>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-ink-secondary" data-testid="fps-reason">
            {fpsReasonText}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            {canStartFps ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void startFps()}
                disabled={fpsBusy}
                data-testid="fps-start"
              >
                {fpsBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Play size={14} aria-hidden="true" />
                )}
                Ativar medição de FPS (pede permissão de administrador)
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void stopFps()}
                disabled={fpsBusy}
                data-testid="fps-stop"
              >
                {fpsBusy ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Square size={14} aria-hidden="true" />
                )}
                Parar medição
              </Button>
            )}
            <span className="text-[10px] text-ink-tertiary">Sem injeção · ETW do Windows</span>
          </div>

          {fpsErrorText && (
            <p role="alert" className="text-[11px] text-danger">
              {fpsErrorText}
            </p>
          )}
          {fpsNotice && (
            <p role="status" className="text-[11px] text-ink-tertiary">
              {fpsNotice}
            </p>
          )}

          <div
            className="space-y-3 rounded-control border border-[var(--border-subtle)] bg-surface-2 p-3.5"
            data-testid="fps-auto"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-ink-primary">FPS automático (recomendado)</h4>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">
                  Instala <strong>uma tarefa no logon do Windows</strong> que mede o FPS desde o
                  início da sessão. Assim o HUD mostra FPS ao apertar{' '}
                  <strong>{formatAcceleratorLabel(HUD_DEFAULT_SHORTCUT)}</strong> dentro do jogo,
                  sem pedir permissão a cada uso. A instalação pede{' '}
                  <strong>1 confirmação de administrador</strong>; a remoção também é manual.
                </p>
              </div>
              <Badge tone={autoBadgeTone} data-testid="fps-auto-badge">
                {autoBadgeLabel}
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {autoInstalled ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => void removeAutoFps()}
                  disabled={autoBusy || autoFps?.state === 'installing'}
                  data-testid="fps-auto-remove"
                >
                  {autoBusy ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldAlert size={14} aria-hidden="true" />
                  )}
                  Desativar FPS automático
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => void installAutoFps()}
                  disabled={autoBusy || autoFps?.state === 'installing'}
                  data-testid="fps-auto-install"
                >
                  {autoBusy ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck size={14} aria-hidden="true" />
                  )}
                  Ativar FPS automático (1 confirmação do Windows)
                </Button>
              )}
              <span className="text-[10px] leading-relaxed text-ink-tertiary">
                Amostra velha (mais de 3 s) mostra “{DASH}”. Nada é injetado no jogo.
              </span>
            </div>

            {autoActive && autoFps?.sample && (
              <p className="text-[11px] text-ink-secondary" data-testid="fps-auto-sample">
                Agora: {formatInt(autoFps.sample.fps)} FPS ·{' '}
                {formatDecimal(autoFps.sample.frametimeMs, 1)} ms · {autoFps.sample.name ?? DASH}
              </p>
            )}
            {autoErrorText && (
              <p role="alert" className="text-[11px] text-danger" data-testid="fps-auto-error">
                {autoErrorText}
              </p>
            )}
            {autoNotice && (
              <p role="status" className="text-[11px] text-ink-tertiary">
                {autoNotice}
              </p>
            )}
            {autoFps && (
              <p className="break-all text-[10px] text-ink-tertiary" data-testid="fps-auto-sink">
                Agent: {autoFps.sinkDir}
              </p>
            )}
          </div>

          <p className="max-w-3xl text-[10px] leading-relaxed text-ink-tertiary">
            A medição lê os eventos de apresentação do Windows (ETW). Nada é injetado no jogo e
            nenhuma DLL é carregada nele. A sessão de eventos é do sistema, por isso o Windows exige
            permissão de administrador — nada é alterado no PC. Alvo: a janela em primeiro plano; o
            próprio Hub, o Explorer e o DWM ficam de fora.
          </p>
        </Card>
      </motion.div>

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
            Uma janela compacta sempre no topo com FPS/frametime, CPU, GPU, RAM e energia. Ela não
            aparece na barra de tarefas, não rouba o foco e os cliques atravessam para o que estiver
            atrás. O atalho funciona mesmo com o Hub em segundo plano.
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
                  {row.value ?? <span className="text-ink-tertiary">{DASH}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </motion.div>

      {/* ── Erro amigável ────────────────────────────────── */}
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

      {/* ── Sensores avançados (driver opcional) ─────────── */}
      <motion.div {...entranceProps(reduced, { y: 10 })}>
        <Card className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-warn-border bg-warn-bg">
              <ShieldAlert size={20} className="text-warn" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold tracking-tight text-ink-primary">
                Sensores avançados (opcional)
              </h3>
              <p className="max-w-2xl text-[12px] leading-relaxed text-ink-secondary">
                Habilita temperatura e potência da CPU e a energia total medida. Isso requer
                instalar um driver de terceiro (WinRing0) com permissão de administrador.
              </p>
              <p className="max-w-2xl text-[11px] leading-relaxed text-warn">
                Risco: driver de terceiro, pode ser sinalizado por antivírus e exige a Memória
                Integrity (HVCI) desligada. Instale apenas se quiser esses campos.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {!driverReady && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void installSensors()}
                disabled={installing}
                data-testid="hw-install-driver"
              >
                {installing ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck size={14} aria-hidden="true" />
                )}
                Instalar sensores avançados (pede permissão de administrador)
              </Button>
            )}
            <Badge tone={DRIVER_TONE[driverState]}>Driver: {DRIVER_LABEL[driverState]}</Badge>
            {driver?.deviceAccessible && <Badge tone="success">Device acessível</Badge>}
          </div>

          {driver?.error && <p className="text-[11px] text-warn">{driver.error}</p>}
          {driverReady && (
            <p className="text-[11px] text-ink-tertiary">
              Sensores avançados ativos. Temperatura e potência da CPU são lidas localmente pelo
              driver.
            </p>
          )}
        </Card>
      </motion.div>
    </div>
  )
}
