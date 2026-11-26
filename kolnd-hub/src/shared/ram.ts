// Tipos canônicos do monitor de memória (aba Memória em Meu PC).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `hwmon.ts`). Tipos puros, sem runtime de plataforma.

/** Processo que mais consome memória física (working set). */
export interface RamProcessInfo {
  pid: number
  name: string
  workingSetBytes: number
}

/** Leitura pontual da memória do PC. */
export interface RamSnapshot {
  ok: boolean
  totalBytes: number
  usedBytes: number
  usedPercent: number
  freeBytes: number
  /** Disponível para novos processos (inclui standby reaproveitável). */
  availableBytes: number | null
  /** Cache do sistema (arquivos e metadados em memória). */
  cacheBytes: number | null
  /** Soma das listas standby (normal + reserva + núcleo). */
  standbyBytes: number | null
  /** Commit total (memória comprometida, física + pagefile). */
  committedBytes: number | null
  topProcesses: RamProcessInfo[]
  /** `cim` = leitura detalhada do Windows; `os` = fallback básico do Node. */
  source: 'cim' | 'os'
  error?: string
}

/** Resultado das duas otimizações (working sets ou standby list). */
export interface RamOptimizeResult {
  ok: boolean
  /** true quando o usuário recusou o UAC (só no modo `purge`). */
  cancelled?: boolean
  mode: 'trim' | 'purge'
  freedBytes: number
  /** Só no modo `trim`: quantos processos tiveram o working set liberado. */
  trimmedProcesses?: number
  skipped: number
  errors: number
  error?: string
}
