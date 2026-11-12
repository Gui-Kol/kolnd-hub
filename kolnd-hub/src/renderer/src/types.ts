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

/** Relatório da importação de jogos da Steam (IPC `steam:import`). */
export interface SteamImportResult {
  ok: boolean
  /** Jogos efetivamente adicionados nesta importação. */
  imported: number
  /** Jogos já presentes na biblioteca (mesmo `steamAppId`) — reimportar não duplica. */
  alreadyInLibrary: number
  /** Entradas descartadas por serem ferramentas/redistribuíveis ou inválidas. */
  ignoredTools: number
  /** Jogos válidos sem executável localizado na pasta de instalação. */
  noExe: number
  /** Falhas por jogo — nunca abortam a importação dos demais. */
  errors: string[]
  /** Mensagem de erro global (ex.: Steam não detectada). */
  error?: string
}

export type GameOrigin = 'steam' | 'custom'

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
