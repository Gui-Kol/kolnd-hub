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
}

export type AppStatus = 'running' | 'stopped' | 'error'

export interface AppState {
  status: AppStatus
  startedAt?: string
  source?: 'hub' | 'background'
}

export type Page = 'dashboard' | 'settings' | 'inicializacao'

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
