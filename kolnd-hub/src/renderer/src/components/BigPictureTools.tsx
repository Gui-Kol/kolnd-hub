import { Wrench } from 'lucide-react'
import { AppConfig, AppState } from '../types'
import { useFocusable } from './BigPictureFocus'

interface BigPictureToolsProps {
  apps: AppConfig[]
  appStates: Record<string, AppState>
  /** Mesmo handler de launch do Hub (App.tsx → handleLaunch). */
  onLaunch: (app: AppConfig) => void
}

const focusRing =
  'focus:outline-none focus-visible:ring-4 focus-visible:ring-neon-cyan/70'

const focusedCard =
  'ring-4 ring-neon-cyan shadow-glow-cyan scale-105 border-neon-cyan/40'

const categoryLabel: Record<AppConfig['category'], string> = {
  ai: 'IA',
  gaming: 'Gaming',
  streaming: 'Streaming',
  dev: 'Dev'
}

interface ToolCardProps {
  app: AppConfig
  isRunning: boolean
  onLaunch: (app: AppConfig) => void
}

function ToolCard({ app, isRunning, onLaunch }: ToolCardProps): JSX.Element {
  const { ref, focused, focus } = useFocusable(`tool:${app.id}`)

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onLaunch(app)}
      onMouseEnter={focus}
      onFocus={focus}
      title={`Abrir ${app.name}`}
      role="option"
      aria-selected={focused}
      aria-label={`Abrir ${app.name}`}
      className={`glass-card glass-hover group relative flex min-h-[15rem] flex-col items-center gap-5 p-6 pt-8 text-center transition-all duration-200 hover:scale-[1.03] ${focusRing} focus-visible:scale-[1.03] focus-visible:shadow-glow-cyan ${
        focused ? focusedCard : ''
      }`}
    >
      {isRunning && (
        <span className="absolute top-4 right-4 flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] 3xl:text-base font-bold uppercase tracking-wider text-emerald-400">
            Ativo
          </span>
        </span>
      )}
      <div
        className="flex h-32 w-32 2xl:h-36 2xl:w-36 items-center justify-center rounded-3xl border border-white/[0.08] text-6xl 2xl:text-7xl shrink-0 transition-transform duration-200 group-hover:scale-110"
        style={{
          background: `linear-gradient(135deg, ${app.color}30, ${app.color}10)`,
          boxShadow: `0 0 40px ${app.color}35`
        }}
      >
        <span aria-hidden="true">{app.icon}</span>
      </div>
      <p className="w-full text-2xl font-semibold leading-snug text-slate-100 line-clamp-2 min-h-[3.5rem]">
        {app.name}
      </p>
      <span className="badge-kloud">{categoryLabel[app.category] ?? app.category}</span>
    </button>
  )
}

/**
 * Seção "Ferramentas" do Big Picture — grade grande com os apps configurados
 * no Hub. O clique lança pela mesma função de launch do Dashboard; o spawn
 * acontece no processo principal, então o contador de apps ativos do shell
 * continua correto quando o usuário sai do Big Picture.
 */
export function BigPictureTools({
  apps,
  appStates,
  onLaunch
}: BigPictureToolsProps): JSX.Element {
  const runningCount = apps.filter((app) => appStates[app.id]?.status === 'running').length

  return (
    <section aria-label="Ferramentas" className="flex h-full flex-col">
      {/* ── Cabeçalho com contador ─────────────────────── */}
      <header className="flex items-end justify-between gap-6 pr-40">
        <div>
          <h2 className="text-5xl font-black tracking-tight text-white">Ferramentas</h2>
          <p className="mt-2 text-lg text-slate-400">
            Os programas do seu ecossistema, num clique
          </p>
        </div>
        <div className="glass rounded-2xl px-5 py-3 flex items-center gap-3">
          <Wrench size={18} className="text-neon-cyan" />
          <span className="text-xl font-bold text-slate-100 tabular-nums">
            {apps.length} {apps.length === 1 ? 'título' : 'títulos'}
            {runningCount > 0 && ` · ${runningCount} ativo${runningCount > 1 ? 's' : ''}`}
          </span>
        </div>
      </header>

      {/* ── Grade de ferramentas ───────────────────────── */}
      <div className="mt-8 min-h-0 flex-1">
        <div role="listbox" aria-label="Ferramentas configuradas" className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6 pb-8">
          {apps.map((app) => (
            <ToolCard
              key={app.id}
              app={app}
              isRunning={appStates[app.id]?.status === 'running'}
              onLaunch={onLaunch}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
