import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useReducedMotion, entranceProps, exitProps, fadeOnlyTransition } from '../lib/motion'
import {
  X,
  Play,
  Square,
  Clock,
  Terminal,
  ExternalLink,
  FolderOpen,
  ScrollText,
  FileText
} from 'lucide-react'
import { AppConfig, AppState } from '../types'
import { useFocusTrap } from '../lib/useFocusTrap'

interface AppDetailModalProps {
  app: AppConfig
  state?: AppState
  onLaunch: () => void
  onStop: () => void
  onClose: () => void
}

export function AppDetailModal({
  app,
  state,
  onLaunch,
  onStop,
  onClose
}: AppDetailModalProps): JSX.Element {
  const isRunning = state?.status === 'running'
  const isError = state?.status === 'error'
  const isBackground = state?.source === 'background'
  // Entradas decorativas do modal (scale/spring) viram fade curto com reduce.
  const reduced = useReducedMotion()

  // Fecha com Escape — mesmo padrão dos demais modais do Hub
  // (Biblioteca, UninstallKloudGamesModal, UninstallHubModal).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return (): void => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Prende o foco no modal (montado uma vez, sempre aberto enquanto montado).
  const trapRef = useFocusTrap({ active: true })

  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState('')

  // Carrega logs capturados e mantém escutando enquanto o modal está aberto.
  useEffect(() => {
    let active = true

    window.api.getAppLogs(app.id).then((text) => {
      if (active) setLogs(text)
    })

    const unsubscribe = window.api.onAppOutput((appId, data) => {
      if (appId !== app.id) return
      setLogs((prev) => (prev + data).slice(-20000))
    })

    return (): void => {
      active = false
      unsubscribe()
    }
  }, [app.id])

  // eslint-disable-next-line no-control-regex -- stripping ANSI color codes from process logs is intentional
  const cleanLogs = logs.replace(/\u001b\[[0-9;]*m/g, '').trim()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={reduced ? fadeOnlyTransition : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-xl" />

      {/* Modal */}
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={app.name}
        {...entranceProps(
          reduced,
          { y: 20, scale: 0.9 },
          { type: 'spring', damping: 25, stiffness: 400 }
        )}
        exit={exitProps(reduced, { y: 20, scale: 0.9 })}
        className="relative w-full max-w-2xl glass rounded-[2rem] overflow-hidden shadow-2xl shadow-black/60 border border-white/[0.08]"
        onClick={(e) => e.stopPropagation()}
        data-testid="app-detail-modal"
      >
        {/* Barra de cor no topo */}
        <div
          className="h-3 w-full"
          style={{
            background: isError
              ? 'linear-gradient(90deg, #EF4444, #EF444460)'
              : `linear-gradient(90deg, ${app.color}, ${app.color}60)`
          }}
        />

        <div className="p-7">
          {/* Botão fechar */}
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors z-20 focus-visible:ring-2 focus-visible:ring-neon-cyan/70"
            aria-label="Fechar detalhes do app"
          >
            <X size={18} aria-hidden="true" />
          </button>

          {/* ── Info do app ───────────────────────────── */}
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-2xl"
              style={{
                background: `linear-gradient(135deg, ${app.color}25, ${app.color}10)`,
                boxShadow: `0 0 30px ${app.color}40`
              }}
            >
              {app.icon}
            </div>
            <div className="flex-1">
              <h3 className="text-2xl font-bold text-white tracking-tight">{app.name}</h3>
              <div className="flex items-center gap-2 mt-2">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    isRunning
                      ? 'bg-emerald-400 animate-pulse'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-slate-700'
                  }`}
                />
                <span
                  className={`text-xs font-bold ${
                    isRunning ? 'text-emerald-400' : isError ? 'text-red-400' : 'text-slate-400'
                  }`}
                  title={isBackground ? 'Rodando em segundo plano' : undefined}
                  role="status"
                  aria-live="polite"
                >
                  {isBackground ? 'Ativo' : isRunning ? 'Executando' : isError ? 'Erro' : 'Parado'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Descrição ────────────────────────────── */}
          <p className="text-sm text-slate-400 leading-relaxed mb-7">{app.description}</p>

          {/* ── Detalhes ─────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-7">
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Terminal size={14} className="text-slate-400 shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase">Comando</span>
              </div>
              <code className="text-xs text-slate-300 bg-white/5 px-3 py-2 rounded-lg font-mono block break-all">
                {app.command}
              </code>
            </div>
            <div className="glass rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <FolderOpen size={14} className="text-slate-400 shrink-0" />
                <span className="text-[10px] font-bold text-slate-400 uppercase">Diretório</span>
              </div>
              <code className="text-xs text-slate-300 bg-white/5 px-3 py-2 rounded-lg font-mono block break-all">
                {app.cwd}
              </code>
            </div>
            {state?.startedAt && isRunning && (
              <div className="glass rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={14} className="text-slate-400 shrink-0" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase">
                    Iniciado em
                  </span>
                </div>
                <span className="text-xs text-slate-300 block">
                  {new Date(state.startedAt).toLocaleString('pt-BR')}
                </span>
              </div>
            )}
            {app.url && isRunning && (
              <div className="glass rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1">
                  <ExternalLink size={14} className="text-slate-400 shrink-0" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Link web</span>
                </div>
                <button
                  onClick={() => window.api.openExternal(app.url!)}
                  className="text-xs font-bold text-playstation-300 hover:text-playstation-400 underline underline-offset-4 transition-colors"
                >
                  Abrir no navegador →
                </button>
              </div>
            )}
          </div>

          {/* ── Tags ─────────────────────────────────── */}
          <div className="flex flex-wrap gap-2 mb-7">
            {app.tags.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-3 py-1 rounded-lg font-bold border bg-white/[0.03] border-white/[0.08] text-slate-300 hover:bg-white/[0.06] transition-colors"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* ── Logs ─────────────────────────────────── */}
          {showLogs && (
            <div className="mb-7">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                  <ScrollText size={12} /> Saída do processo
                </span>
                <span className="text-[10px] text-slate-400">
                  {cleanLogs ? 'ao vivo' : 'sem saída'}
                </span>
              </div>
              <pre
                className="max-h-48 overflow-auto rounded-xl border border-white/[0.06] bg-black/50 p-4 font-mono text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap break-all"
                aria-live="polite"
              >
                {cleanLogs || 'Nenhuma saída capturada ainda. Inicie o programa para ver os logs.'}
              </pre>
            </div>
          )}

          {/* ── Ações ────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Iniciar / Parar */}
            <button
              onClick={isRunning ? onStop : onLaunch}
              className={`flex items-center justify-center gap-2.5 py-4 rounded-xl text-sm font-bold uppercase tracking-wider transition-all shadow ${
                isRunning
                  ? 'bg-red-600/20 text-red-400 hover:bg-red-600/40 hover:text-red-300 border border-red-500/30 shadow-glow-red'
                  : `text-white bg-gradient-to-r from-${app.color}/20 to-${app.color}/10 border border-${app.color}/40 hover:from-${app.color}/40 hover:to-${app.color}/20 hover:border-${app.color}/60 shadow-glow-orange`
              }`}
            >
              {isRunning ? (
                <>
                  <Square size={16} /> Parar
                </>
              ) : (
                <>
                  <Play size={16} /> Iniciar
                </>
              )}
            </button>

            {/* Ações secundárias em linha */}
            <div className="flex items-center gap-2">
              {app.url && isRunning && (
                <button
                  onClick={() => window.api.openExternal(app.url!)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 glass glass-hover"
                >
                  <ExternalLink size={14} /> Abrir
                </button>
              )}
              <button
                onClick={() => setShowLogs((prev) => !prev)}
                className={`flex items-center justify-center px-3 py-2.5 rounded-xl glass glass-hover ${
                  showLogs ? 'text-kloud-500' : 'text-slate-400'
                }`}
                title="Mostrar logs"
                aria-label="Mostrar logs"
              >
                <ScrollText size={16} />
              </button>
              <button
                onClick={() => window.api.openPath(app.cwd)}
                className="flex items-center justify-center px-3 py-2.5 rounded-xl text-slate-400 glass glass-hover"
                title="Abrir pasta"
                aria-label="Abrir pasta"
              >
                <FolderOpen size={16} />
              </button>
              <button
                onClick={() => void window.api.openLogsFolder()}
                className="flex items-center justify-center px-3 py-2.5 rounded-xl text-slate-400 glass glass-hover"
                title="Abrir pasta de logs"
                aria-label="Abrir pasta de logs"
              >
                <FileText size={16} />
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
