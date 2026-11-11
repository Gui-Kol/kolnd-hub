import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Play, Square, Clock, Terminal, ExternalLink, FolderOpen, ScrollText } from 'lucide-react'
import { AppConfig, AppState } from '../types'

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

  const [showLogs, setShowLogs] = useState(false)
  const [logs, setLogs] = useState('')

  // Load the captured output and keep listening while the modal is open.
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

  const cleanLogs = logs.replace(/\u001b\[[0-9;]*m/g, '').trim()

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-lg glass rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Color header bar */}
        <div
          className="h-2 w-full"
          style={{
            background: isError
              ? 'linear-gradient(90deg, #EF4444, #EF444460)'
              : `linear-gradient(90deg, ${app.color}, ${app.color}60)`
          }}
        />

        <div className="p-6">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>

          {/* ── App info ─────────────────────────────── */}
          <div className="flex items-center gap-4 mb-5">
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl shrink-0"
              style={{ background: `${app.color}15` }}
            >
              {app.icon}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{app.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isRunning
                      ? 'bg-emerald-400 animate-pulse'
                      : isError
                        ? 'bg-red-400'
                        : 'bg-slate-600'
                  }`}
                />
                <span
                  className={`text-xs font-medium ${
                    isRunning
                      ? 'text-emerald-400'
                      : isError
                        ? 'text-red-400'
                        : 'text-slate-500'
                  }`}
                  title={isBackground ? 'Rodando em segundo plano' : undefined}
                >
                  {isBackground ? 'Ativo' : isRunning ? 'Em execução' : isError ? 'Erro' : 'Parado'}
                </span>
              </div>
            </div>
          </div>

          {/* ── Description ──────────────────────────── */}
          <p className="text-sm text-slate-400 leading-relaxed mb-5">{app.description}</p>

          {/* ── Details ──────────────────────────────── */}
          <div className="space-y-2.5 mb-6">
            <div className="flex items-center gap-2.5 text-xs">
              <Terminal size={13} className="text-slate-500 shrink-0" />
              <span className="text-slate-500">Comando:</span>
              <code className="text-slate-300 bg-white/5 px-2 py-0.5 rounded font-mono text-[11px]">
                {app.command}
              </code>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <FolderOpen size={13} className="text-slate-500 shrink-0" />
              <span className="text-slate-500">Diretório:</span>
              <code className="text-slate-300 bg-white/5 px-2 py-0.5 rounded font-mono text-[11px]">
                {app.cwd}
              </code>
            </div>
            {state?.startedAt && isRunning && (
              <div className="flex items-center gap-2.5 text-xs">
                <Clock size={13} className="text-slate-500 shrink-0" />
                <span className="text-slate-500">Iniciado em:</span>
                <span className="text-slate-300">
                  {new Date(state.startedAt).toLocaleString('pt-BR')}
                </span>
              </div>
            )}
          </div>

          {/* ── Tags ─────────────────────────────────── */}
          <div className="flex items-center gap-1.5 mb-6">
            {app.tags.map((tag) => (
              <span
                key={tag}
                className="text-[11px] px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: `${app.color}10`,
                  color: `${app.color}cc`
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* ── Logs ─────────────────────────────────── */}
          {showLogs && (
            <div className="mb-6">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <ScrollText size={11} /> Saída do processo
                </span>
                <span className="text-[10px] text-slate-600">{cleanLogs ? 'ao vivo' : 'sem saída'}</span>
              </div>
              <pre className="max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-400 whitespace-pre-wrap break-all">
                {cleanLogs || 'Nenhuma saída capturada ainda. Inicie o programa para ver os logs.'}
              </pre>
            </div>
          )}

          {/* ── Actions ──────────────────────────────── */}
          <div className="flex items-center gap-3">
            {/* Launch / Stop */}
            <button
              onClick={isRunning ? onStop : onLaunch}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                isRunning
                  ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
                  : 'text-white hover:opacity-90'
              }`}
              style={
                !isRunning
                  ? {
                      background: `linear-gradient(135deg, ${app.color}30, ${app.color}15)`,
                      border: `1px solid ${app.color}30`
                    }
                  : undefined
              }
            >
              {isRunning ? (
                <>
                  <Square size={14} /> Parar
                </>
              ) : (
                <>
                  <Play size={14} /> Iniciar
                </>
              )}
            </button>

            {/* Open URL (only when running and has URL) */}
            {app.url && isRunning && (
              <button
                onClick={() => window.api.openExternal(app.url!)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-300 glass glass-hover"
              >
                <ExternalLink size={14} /> Abrir
              </button>
            )}

            {/* Toggle logs */}
            <button
              onClick={() => setShowLogs((prev) => !prev)}
              className={`flex items-center justify-center px-3 py-2.5 rounded-xl glass glass-hover ${
                showLogs ? 'text-indigo-300' : 'text-slate-400'
              }`}
              title="Mostrar logs"
            >
              <ScrollText size={14} />
            </button>

            {/* Open folder */}
            <button
              onClick={() => window.api.openPath(app.cwd)}
              className="flex items-center justify-center px-3 py-2.5 rounded-xl text-slate-400 glass glass-hover"
              title="Abrir pasta"
            >
              <FolderOpen size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
