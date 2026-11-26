export interface AppConfig {
  id: string
  name: string
  description: string
  icon: string
  color: string
  gradient: string
  command: string
  cwd: string
  category: 'ai' | 'gaming' | 'streaming' | 'dev'
  tags: string[]
  url?: string
  /**
   * Como o comando é executado no main process.
   * true/ausente (padrão): via shell (cmd.exe) — preserva aspas e argumentos.
   * false: spawn com argv separado e shell desligado — sem interpretação de
   * shell (resistente a metacaracteres), recomendado para comandos simples.
   */
  useShell?: boolean
  /**
   * Reinício automático OPT-IN (task 06-6.4): se o processo cai sozinho, o Hub
   * relança com backoff 2s/5s/10s, até 3 tentativas a cada 10 minutos.
   * Ausente/false = comportamento padrão (sem reinício).
   */
  autoRestart?: boolean
  /**
   * Log persistente OPT-IN (task 05-5.7): grava stdout/stderr do processo em
   * `%APPDATA%\kolnd-hub\logs\<appId>.log` (rotação 1 MB → `<appId>.log.1`,
   * máx. 2 arquivos por app). Ausente/false = nada muda (ring buffer em RAM).
   */
  persistLogs?: boolean
}

export type AppStatus = 'running' | 'stopped' | 'error'

export interface AppState {
  status: AppStatus
  startedAt?: string
  source?: 'hub' | 'background'
}

export type Page = 'dashboard' | 'settings' | 'inicializacao' | 'biblioteca'

// Tipos do modo Big Picture (lib/gamepad, T1) re-exportados para consumo único.
export type {
  GamepadProfile,
  GamepadAction,
  GamepadButtonMapping,
  GamepadConfig
} from './lib/gamepad'

// Tipos do monitor de hardware (Fase A) — fonte única em `src/shared/hwmon.ts`.
export type {
  DriverStatus,
  DriverStatusInfo,
  HwCpu,
  HwCpuTempSource,
  HwGpu,
  HwGpuTempSource,
  HwGpuUsageSource,
  HwGpuVendor,
  HwPower,
  HwPowerSourceCpu,
  HwPowerSourceGpu,
  HwRam,
  HwSnapshot,
  HwSources,
  HwSpecs,
  InstallDriverResult
} from '../../shared/hwmon'

// Tipos de escala/resolução de tela (aba Tela em Meu PC) — `src/shared/display.ts`.
export type {
  DisplayChangeTicket,
  DisplayConfirmResult,
  DisplayDescriptor,
  DisplayInfo,
  DisplayMode,
  DisplayResolution,
  DisplayRevertedEvent,
  DisplayScaleInfo,
  DisplaySetResult
} from '../../shared/display'

// Tipos da sobreposição (HUD) — fonte única em `src/shared/hud.ts`.
export type { HudConfig, HudScale, HudSize, HudStatus, HudUpdate } from '../../shared/hud'

export type GameOrigin = 'steam' | 'epic' | 'minecraft' | 'custom'

// Contratos da busca de jogos (Steam + Epic Games + Minecraft Launcher).
// Fonte única em `src/shared/gameImport.ts` — não duplicar aqui.
export type {
  GameImportReport,
  GameImportSourceId,
  GameSourceImportReport
} from '../../shared/gameImport'

/** Resultado da adição de um jogo personalizado (IPC `games:add-custom`). */
export interface AddCustomGameResult {
  success: boolean
  /** id determinístico (`custom-<hash>`) do jogo adicionado. */
  id?: string
  /** Nome formatado gravado na biblioteca (usado no aviso de confirmação). */
  name?: string
  /** Mensagem amigável em caso de falha. */
  error?: string
}

/** Jogo persistido na Biblioteca (electron-store, chave `games`). */
export interface Game {
  id: string
  name: string
  exePath: string
  /** Caminho absoluto do ícone cacheado; null = sem ícone (fallback visual). */
  iconPath: string | null
  origin: GameOrigin
  steamAppId?: number
  addedAt: string
  /** Marcado como favorito na Biblioteca/Big Picture. */
  favorite?: boolean
  /** Coleções do jogo (máx. 8 nomes, 1–24 chars cada). */
  collections?: string[]
  /** Total acumulado de tempo de jogo, em segundos. */
  playtimeSeconds?: number
  /** Segundos por dia local (`YYYY-MM-DD`), até 60 dias. */
  playtimeDays?: Record<string, number>
  /** ISO da última vez que o jogo foi aberto pelo Hub. */
  lastPlayedAt?: string
  /** Caminho absoluto da capa escolhida (dentro de `game-covers/`); null = sem capa. */
  coverPath?: string | null
}

export interface SystemProcess {
  name: string
  id: number
  path: string
}

export type ImportanceLevel = 'critico' | 'recomendado' | 'opcional' | 'inutil'

export interface StartupItem {
  id: string
  name: string
  path: string
  location: 'registro' | 'pasta-inicializacao'
  scope: 'usuario' | 'sistema'
}

export interface WingetUpgradeItem {
  name: string
  id: string
  currentVersion: string
  availableVersion: string
}

export interface WingetListResult {
  ok: boolean
  items?: WingetUpgradeItem[]
  error?: string
  /** Primeiras linhas da saída do winget — diagnóstico de falha de parse. */
  rawLog?: string
  /** true quando o winget não está disponível/instalado no sistema. */
  wingetMissing?: boolean
}

export interface WingetUpgradeResult {
  ok: boolean
  /** Código de saída; null quando o processo não pôde iniciar ou foi interrompido. */
  exitCode: number | null
  /** Últimas ~50 linhas da saída (stdout+stderr), para exibição como detalhe. */
  log: string
}

export interface WingetKillResult {
  ok: boolean
  error?: string
}

export interface CleanResult {
  ok: boolean
  /** Quantos arquivos foram removidos (pastas vazias antigas não entram na conta). */
  filesRemoved: number
  /** Espaço liberado em bytes (soma dos tamanhos dos arquivos removidos). */
  bytesFreed: number
  /** Itens ignorados por estarem em uso ou sem permissão (EPERM/EACCES/EBUSY). */
  skippedLocked: number
  /** Falhas inesperadas — nunca interrompem a limpeza. */
  errors: number
  /** Pastas efetivamente varridas (exibição opcional na interface). */
  paths?: string[]
  /** Mensagem amigável em caso de falha global (nunca um stack trace). */
  error?: string
}

/** Processo que mais consome memória física (working set). */
export interface RamProcessInfo {
  pid: number
  name: string
  workingSetBytes: number
}

/** Leitura pontual da memória do PC (aba Memória em Meu PC). */
export interface RamSnapshot {
  ok: boolean
  totalBytes: number
  usedBytes: number
  usedPercent: number
  freeBytes: number
  /** Disponível para novos processos; null na leitura básica do Node. */
  availableBytes: number | null
  /** Cache do sistema; null na leitura básica do Node. */
  cacheBytes: number | null
  /** Soma das listas standby; null na leitura básica do Node. */
  standbyBytes: number | null
  /** Commit total; null na leitura básica do Node. */
  committedBytes: number | null
  topProcesses: RamProcessInfo[]
  source: 'cim' | 'os'
  error?: string
}

/** Resultado das otimizações de memória (working sets ou standby list). */
export interface RamOptimizeResult {
  ok: boolean
  cancelled?: boolean
  mode: 'trim' | 'purge'
  freedBytes: number
  trimmedProcesses?: number
  skipped: number
  errors: number
  error?: string
}

/** Preferências da otimização automática de RAM (somente trim, sem UAC). */
export interface RamAutoPrefs {
  enabled: boolean
  /** Intervalo entre execuções, em minutos (1–60). */
  intervalMinutes: number
}

/** Nota de uma carga do benchmark (MOps/s em cada fase). */
export interface BenchmarkTestScore {
  id: string
  label: string
  single: number
  multi: number
}

/** Resultado do benchmark de CPU (IPC `benchmark:run`). */
export type BenchmarkResult =
  | {
      ok: true
      cancelled?: boolean
      single: number
      multi: number
      ratio: number
      cores: number
      model: string
      threads: number
      durationMs: number
      tests: BenchmarkTestScore[]
      /** Alguma carga continuou com spread > 25 % mesmo após a repetição. */
      unstable: boolean
    }
  | { ok: false; cancelled?: boolean; error: string }

/** Progresso do run: percentual global (0–100) considerando as duas fases. */
export interface BenchmarkProgress {
  phase: 'single' | 'multi'
  testId: string
  testLabel: string
  testIndex: number
  testCount: number
  percent: number
}

/** Execução persistida no histórico local (electron-store). */
export interface BenchmarkHistoryEntry {
  id: string
  at: string
  single: number
  multi: number
  ratio: number
  cores: number
  model: string
  tests: BenchmarkTestScore[]
}

/** Progresso do teste de estresse (evento `benchmark:stress-progress`). */
export interface StressProgress {
  elapsedMs: number
  threads: number
  checksumOk: boolean
}

/** Resultado da parada do teste de estresse (IPC `benchmark:stress-stop`). */
export interface StressResult {
  ok: boolean
  elapsedMs?: number
  checksumOk?: boolean
  error?: string
}

export const STARTUP_LOCATION_LABEL: Record<StartupItem['location'], string> = {
  registro: 'Registro',
  'pasta-inicializacao': 'Pasta de inicialização'
}

export const STARTUP_SCOPE_LABEL: Record<StartupItem['scope'], string> = {
  usuario: 'Usuário',
  sistema: 'Sistema'
}

export const IMPORTANCE_LEVELS: ImportanceLevel[] = ['critico', 'recomendado', 'opcional', 'inutil']

export const IMPORTANCE_LABELS: Record<
  ImportanceLevel,
  { label: string; subtitle: string; color: string; badge: string }
> = {
  critico: {
    label: 'CRITICO',
    subtitle: 'Sistema que precisa iniciar com o PC',
    color: '#EF4444',
    badge: 'bg-red-500/10 border-red-500/20 text-red-400'
  },
  recomendado: {
    label: 'Recomendado',
    subtitle: 'Ideal iniciar com o PC',
    color: '#F59E0B',
    badge: 'bg-amber-500/10 border-amber-500/20 text-amber-400'
  },
  opcional: {
    label: 'Opcional',
    subtitle: 'Sem grande diferença',
    color: '#3B82F6',
    badge: 'bg-blue-500/10 border-blue-500/20 text-blue-400'
  },
  inutil: {
    label: 'Inutil',
    subtitle: 'Melhor não iniciar com o PC',
    color: '#6B7280',
    badge: 'bg-slate-500/10 border-slate-500/20 text-slate-400'
  }
}
