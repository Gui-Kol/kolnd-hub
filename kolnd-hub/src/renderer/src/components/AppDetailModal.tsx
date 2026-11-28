import { useState, useEffect } from 'react'
import {
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
import { Button, IconButton, Modal } from './ui'

// API pública IDÊNTICA (AppDetailModalProps) — Dashboard não muda.
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

  const statusLabel = isBackground
    ? 'Ativo'
    : isRunning
      ? 'Executando'
      : isError
        ? 'Erro'
        : 'Parado'

  const statusDot = isRunning
    ? 'bg-success animate-pulse motion-reduce:animate-none'
    : isError
      ? 'bg-danger'
      : 'bg-ink-tertiary'
  const statusText = isRunning ? 'text-success' : isError ? 'text-danger' : 'text-ink-tertiary'

  return (
    <Modal
      ariaLabel={app.name}
      onClose={onClose}
      closeLabel="Fechar detalhes do app"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            Fechar
          </Button>
          <Button
            variant={isRunning ? 'danger' : 'primary'}
            size="md"
            onClick={isRunning ? onStop : onLaunch}
          >
            {isRunning ? (
              <>
                <Square size={16} aria-hidden="true" /> Parar
              </>
            ) : (
              <>
                <Play size={16} aria-hidden="true" /> Iniciar
              </>
            )}
          </Button>
        </>
      }
    >
      {/* data-testid no miolo: o primitivo Modal não repassa props ao painel */}
      <div data-testid="app-detail-modal">
        {/* ── Info do app ───────────────────────────── */}
        <div className="relative z-10 mb-6 flex items-center gap-4">
          <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-4xl">
            {app.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-2xl font-bold tracking-tight text-ink-primary">{app.name}</h3>
            <div className="mt-2 flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-pill ${statusDot}`} />
              <span
                className={`text-xs font-bold uppercase tracking-wider ${statusText}`}
                title={isBackground ? 'Rodando em segundo plano' : undefined}
                role="status"
                aria-live="polite"
              >
                {statusLabel}
              </span>
            </div>
          </div>
        </div>

        {/* ── Descrição ────────────────────────────── */}
        <p className="mb-6 text-sm leading-relaxed text-ink-secondary">{app.description}</p>

        {/* ── Detalhes ─────────────────────────────── */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
            <div className="mb-1 flex items-center gap-2">
              <Terminal size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                Comando
              </span>
            </div>
            <code className="block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-secondary">
              {app.command}
            </code>
          </div>
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
            <div className="mb-1 flex items-center gap-2">
              <FolderOpen size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                Diretório
              </span>
            </div>
            <code className="block break-all rounded-sm border border-[var(--border-subtle)] bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-secondary">
              {app.cwd}
            </code>
          </div>
          {state?.startedAt && isRunning && (
            <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
              <div className="mb-1 flex items-center gap-2">
                <Clock size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                  Iniciado em
                </span>
              </div>
              <span className="block text-xs text-ink-secondary">
                {new Date(state.startedAt).toLocaleString('pt-BR')}
              </span>
            </div>
          )}
          {app.url && isRunning && (
            <div className="rounded-control border border-[var(--border-subtle)] bg-surface-2 p-4">
              <div className="mb-1 flex items-center gap-2">
                <ExternalLink size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                  Link web
                </span>
              </div>
              <button
                onClick={() => window.api.openExternal(app.url!)}
                className="text-xs font-bold text-accent underline underline-offset-4 transition-colors duration-2 hover:text-accent-hover"
              >
                Abrir no navegador →
              </button>
            </div>
          )}
        </div>

        {/* ── Tags (neutras, tokenizadas) ────────────── */}
        <div className="mb-6 flex flex-wrap gap-2">
          {app.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-pill border border-[var(--border-subtle)] px-3 py-1 text-[10px] font-semibold text-ink-secondary"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* ── Logs ─────────────────────────────────── */}
        {showLogs && (
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-secondary">
                <ScrollText size={12} aria-hidden="true" /> Saída do processo
              </span>
              <span className="text-[10px] text-ink-tertiary">
                {cleanLogs ? 'ao vivo' : 'sem saída'}
              </span>
            </div>
            <pre
              className="max-h-48 overflow-auto rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-4 font-mono text-[10px] leading-relaxed text-ink-secondary whitespace-pre-wrap break-all"
              aria-live="polite"
            >
              {cleanLogs || 'Nenhuma saída capturada ainda. Inicie o programa para ver os logs.'}
            </pre>
          </div>
        )}

        {/* ── Ações secundárias ─────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          {app.url && isRunning && (
            <Button variant="secondary" size="sm" onClick={() => window.api.openExternal(app.url!)}>
              <ExternalLink size={14} aria-hidden="true" /> Abrir
            </Button>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => setShowLogs((prev) => !prev)}
            className={showLogs ? 'text-accent' : undefined}
            title="Mostrar logs"
            aria-label="Mostrar logs"
            aria-pressed={showLogs}
          >
            <ScrollText size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => window.api.openPath(app.cwd)}
            title="Abrir pasta"
            aria-label="Abrir pasta"
          >
            <FolderOpen size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={() => void window.api.openLogsFolder()}
            title="Abrir pasta de logs"
            aria-label="Abrir pasta de logs"
          >
            <FileText size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </Modal>
  )
}
