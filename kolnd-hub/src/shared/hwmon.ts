// Tipos canônicos do monitor de hardware (Fase A).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `gamepad.ts`). Tipos puros, sem runtime de plataforma.

export type DriverStatus = 'absent' | 'present' | 'ready'

/** Origem de cada parcela de energia — a UI nunca mostra estimativa como medida. */
export type HwPowerSourceCpu = 'measured' | 'estimated' | 'unavailable'
export type HwPowerSourceGpu = 'measured' | 'unavailable'

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
  usagePercent: number | null
  coreClockMhz: number | null
  memClockMhz: number | null
  vramUsedMb: number | null
  vramTotalMb: number | null
  sharedMb: number | null
  tempC: number | null
  /** Percentual — o `nvidia-smi` não expõe RPM. */
  fanPercent: number | null
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
