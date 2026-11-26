// Tipos canônicos do monitor de hardware (Fase A).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `gamepad.ts`). Tipos puros, sem runtime de plataforma.

export type DriverStatus = 'absent' | 'present' | 'ready'

// ── Intervalo do polling (aba Monitor + HUD) ───────────────────
// O renderer monta as opções do seletor a partir destas constantes e o main
// aplica o mesmo clamp: uma única fonte evita o seletor oferecer um valor que
// o timer recusa. Abaixo de ~0,6 s a coleta completa não cabe no período — o
// polling simplesmente repete o mais rápido que consegue (o guard `polling`
// impede sobreposição), por isso o piso baixo continua válido na UI.
export const HWMON_INTERVAL_MIN_MS = 100
export const HWMON_INTERVAL_MAX_MS = 2000
export const HWMON_INTERVAL_STEP_MS = 100
export const HWMON_INTERVAL_DEFAULT_MS = 500

/**
 * Intervalo mínimo entre pushes ao HUD (1 Hz) e piso do timer quando só ele
 * consome o polling.
 *
 * A sobreposição é passiva: 2 Hz não entrega informação útil e dobra o custo da
 * coleta. Um único botão para reverter (aqui) mantém a decisão documentada e
 * fora da arquitetura — a aba Monitor aberta continua no intervalo escolhido.
 */
export const HUD_PUSH_MIN_INTERVAL_MS = 1000

/**
 * Normaliza o intervalo do polling para um múltiplo do passo dentro da faixa.
 *
 * Qualquer coisa que não seja número finito (ausente, `null`, string, objeto,
 * `NaN`, `Infinity`) volta ao default em vez de virar erro: o valor também
 * chega de um arquivo de config editado à mão, e uma leitura inválida não pode
 * impedir o monitor de funcionar.
 */
export function normalizeHwmonIntervalMs(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return HWMON_INTERVAL_DEFAULT_MS
  const stepped = Math.round(input / HWMON_INTERVAL_STEP_MS) * HWMON_INTERVAL_STEP_MS
  return Math.min(HWMON_INTERVAL_MAX_MS, Math.max(HWMON_INTERVAL_MIN_MS, stepped))
}

/** Fabricante do adaptador de vídeo escolhido (Fase A: detectado sem driver). */
export type HwGpuVendor = 'nvidia' | 'amd' | 'intel' | 'other'

/** Origem de cada parcela de energia — a UI nunca mostra estimativa como medida. */
export type HwPowerSourceCpu = 'measured' | 'estimated' | 'unavailable'
export type HwPowerSourceGpu = 'measured' | 'unavailable'

/** Temperatura da CPU: driver (ring0) > ACPI (aproximada) > indisponível. */
export type HwCpuTempSource = 'measured' | 'acpi' | 'unavailable'
/** Uso da GPU: `nvidia-smi` ou contador CIM (qualquer fabricante). */
export type HwGpuUsageSource = 'measured' | 'unavailable'
export type HwGpuTempSource = 'measured' | 'unavailable'

export interface HwPower {
  cpuW: number | null
  gpuW: number | null
  /** Soma medida de CPU + GPU; null quando falta qualquer uma das duas. */
  totalMeasuredW: number | null
  /** Estimativa da CPU (classe térmica × carga); null sem núcleos/uso — nunca medida. */
  cpuEstimatedW: number | null
  /** Estimativa fixa da plataforma (placa, RAM, SSDs, ventoinhas, USB). */
  platformEstimatedW: number | null
  /** CPU estimada + GPU medida + plataforma; null quando a GPU não foi medida. */
  totalEstimatedW: number | null
}

export interface HwCpu {
  model: string | null
  usagePercent: number | null
  clockMhz: number | null
  tempC: number | null
  watts: number | null
  /**
   * Tensão do núcleo (Vcore) medida pelo agente elevado — SVI2 no AMD,
   * `IA32_PERF_STATUS` no Intel. Opcional para manter payloads de versões
   * anteriores válidos; `null` = sem leitura (a UI mostra "—", nunca estima).
   */
  voltageV?: number | null
}

export interface HwRam {
  installedGb: number | null
  speedMhz: number | null
  voltageV: number | null
  usedGb: number
  usedPercent: number
}

export interface HwGpu {
  model: string | null
  /** Fabricante detectado (CIM/PNP); `null` enquanto nenhum adaptador responde. */
  vendor: HwGpuVendor | null
  /** Versão do driver de vídeo do adaptador primário (sem `nvidia-smi` também vem). */
  driverVersion: string | null
  /** `YYYY-MM-DD` do driver de vídeo do adaptador primário. */
  driverDate: string | null
  usagePercent: number | null
  coreClockMhz: number | null
  memClockMhz: number | null
  vramUsedMb: number | null
  /** VRAM total REAL (registro `qwMemorySize`), não o `AdapterRAM` saturado. */
  vramTotalMb: number | null
  sharedMb: number | null
  tempC: number | null
  /** Percentual — `nvidia-smi`. */
  fanPercent: number | null
  /** RPM da ventoinha pela NVML (NVIDIA). `0` é válido: modo zero-fan. */
  fanRpm: number | null
  watts: number | null
  powerLimitW: number | null
}

export interface HwSpecs {
  cpu: string | null
  gpu: string | null
  ram: string | null
  board: string | null
}

export interface HwSources {
  driver: DriverStatus
  /** Precedência: `measured` (driver) > `estimated` > `unavailable`. */
  cpu: HwPowerSourceCpu
  gpu: HwPowerSourceGpu
  /** A plataforma não tem fonte mensurável sem driver: sempre estimada. */
  platform: 'estimated'
  /** Origem da temperatura da CPU mostrada em `cpu.tempC`. */
  cpuTemp: HwCpuTempSource
  /** Origem do uso da GPU mostrado em `gpu.usagePercent`. */
  gpuUsage: HwGpuUsageSource
  /** Origem da temperatura da GPU mostrada em `gpu.tempC`. */
  gpuTemp: HwGpuTempSource
}

export interface HwSnapshot {
  power: HwPower
  cpu: HwCpu
  ram: HwRam
  gpu: HwGpu
  specs: HwSpecs
  sources: HwSources
  capturedAt: string
}

export interface DriverStatusInfo {
  state: DriverStatus
  /** O `.sys` de origem existe e confere com o SHA-256 pinado. */
  filePresent: boolean
  serviceInstalled: boolean
  deviceAccessible: boolean
  /**
   * O agente está ativo (sink fresco), mas não lê todos os registradores que
   * esta versão do Hub espera — o script assado no install é antigo. Opcional
   * para manter payloads de versões anteriores válidos.
   */
  outdated?: boolean
  sourcePath: string
  installedPath: string
  error?: string
}

export interface InstallDriverResult {
  ok: boolean
  cancelled?: boolean
  state?: DriverStatus
  error?: string
}
