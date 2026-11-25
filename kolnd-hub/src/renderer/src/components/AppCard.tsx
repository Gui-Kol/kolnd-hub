import { motion } from 'framer-motion'
import {
  Play,
  Square,
  ExternalLink,
  Globe2,
  HelpCircle,
  Loader2,
  ClipboardCopy
} from 'lucide-react'
import { AppConfig, AppState } from '../types'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { zeroTierBadge } from '../lib/remoteAccess'
import type { ZeroTierInfo } from '../../../shared/remote'
import { Badge, Button, IconButton } from './ui'

/** Controles de modo remoto injetados apenas no card do Kloud Games. */
export interface RemoteControls {
  enabled: boolean
  /** true enquanto o estado (modo/endereço) está sendo lido do main. */
  loading: boolean
  /** true durante o toggle (desabilita os botões). */
  busy: boolean
  /** true enquanto instala o ZeroTier automaticamente (D3). */
  installing: boolean
  /** IP atribuído pela rede ZeroTier para o Moonlight; null quando não conectado. */
  address: string | null
  /** Estado do serviço/GUI para o selo Aberto/Fechado. */
  zerotier: ZeroTierInfo | null
  onToggle: () => void
  onCopyAddress: () => void
  onHelp: () => void
}

// API pública IDÊNTICA (AppCardProps) — Dashboard não muda.
interface AppCardProps {
  app: AppConfig
  state?: AppState
  onLaunch: () => void
  onStop: () => void
  onClick: () => void
  delay: number
  remote?: RemoteControls
}

// Categorias mapeadas para tons do Badge (13-13.8): ai→accent, demais→neutro.
// Nada de cor por marca (neon/playstation/kloud saíram na 13.4/13.6).
const categoryBadge: Record<string, { label: string; tone: 'accent' | 'neutral' }> = {
  ai: { label: 'IA', tone: 'accent' },
  gaming: { label: 'JOGO', tone: 'neutral' },
  streaming: { label: 'STREAM', tone: 'neutral' },
  dev: { label: 'DEV', tone: 'neutral' }
}

export function AppCard({
  app,
  state,
  onLaunch,
  onStop,
  onClick,
  delay,
  remote
}: AppCardProps): JSX.Element {
  const isRunning = state?.status === 'running'
  const isError = state?.status === 'error'
  const isBackground = state?.source === 'background'
  // Movimento decorativo (entrada com stagger, tap) some com reduce.
  const reduced = useReducedMotion()

  const badge = categoryBadge[app.category] ?? {
    label: app.category.toUpperCase(),
    tone: 'neutral' as const
  }

  const statusLabel = isBackground
    ? 'Ativo'
    : isRunning
      ? 'Executando'
      : isError
        ? 'Erro'
        : 'Parado'

  const statusDot = isRunning
    ? 'bg-success animate-pulse'
    : isError
      ? 'bg-danger'
      : 'bg-ink-tertiary'
  const statusText = isRunning ? 'text-success' : isError ? 'text-danger' : 'text-ink-tertiary'
  const powerBadge = remote?.zerotier ? zeroTierBadge(remote.zerotier) : null

  return (
    <motion.div
      {...entranceProps(reduced, { y: 20, scale: 0.95 }, { delay, duration: 0.5, ease: 'easeOut' })}
      whileTap={reduced ? undefined : { scale: 0.99 }}
      role="button"
      tabIndex={0}
      aria-label={`${app.name} — ${
        isRunning ? 'em execução' : isError ? 'com erro' : 'parado'
      }. Abrir detalhes`}
      onKeyDown={(e) => {
        // Só ativa o card quando o foco está nele — Enter/Espaço em botões internos
        // aciona o próprio botão (e o clique já para propagação).
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="group relative flex cursor-pointer flex-col rounded-card border border-[var(--border-subtle)] bg-surface-1 p-5 pt-11 text-left shadow-elevation-1 transition-all duration-2 ease-standard hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2"
      onClick={onClick}
      data-testid="app-card"
    >
      {/* Tag da categoria (canto superior-esquerdo) */}
      <div className="absolute left-4 top-4 z-10">
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>

      {/* Pill Online (discreta, só quando rodando) */}
      {isRunning && (
        <div className="absolute right-4 top-4 z-10">
          <Badge tone="success" role="status">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-pill bg-success animate-pulse"
            />
            Online
          </Badge>
        </div>
      )}

      {/* Conteúdo do card */}
      <div className="flex grow flex-col">
        {/* Cabeçalho com ícone e nome */}
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-xl transition-transform duration-2 ease-standard group-hover:scale-105">
              {app.icon}
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-ink-primary">
                {app.name}
              </h3>
              <div className="mt-1 flex items-center gap-1.5">
                <div className={`h-2 w-2 rounded-pill transition-colors ${statusDot}`} />
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${statusText}`}
                  title={isBackground ? 'Rodando em segundo plano' : undefined}
                >
                  {statusLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Atalho URL */}
          {app.url && isRunning && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                window.api.openExternal(app.url!)
              }}
              className="opacity-0 transition-opacity duration-2 focus-visible:opacity-100 group-hover:opacity-100"
              title="Abrir no navegador"
              aria-label="Abrir no navegador"
            >
              <ExternalLink size={14} aria-hidden="true" />
            </IconButton>
          )}
        </div>

        {/* Descrição */}
        <p className="mb-5 line-clamp-2 text-[11px] font-medium leading-relaxed text-ink-secondary">
          {app.description}
        </p>

        {/* Tags (neutras, tokenizadas) */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {app.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-pill border border-[var(--border-subtle)] px-2 py-0.5 text-[9px] font-semibold text-ink-secondary"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Barra de ação — margin-top auto empurra para o rodapé do card */}
        <div className="mt-auto">
          {/* Modo remoto (só Kloud Games): toggle + ajuda de pareamento. */}
          {remote && (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Button
                  variant={remote.enabled ? 'primary' : 'secondary'}
                  size="sm"
                  className="flex-1"
                  aria-pressed={remote.enabled}
                  disabled={remote.busy || remote.loading || remote.installing}
                  title={
                    remote.installing
                      ? 'Instalando o ZeroTier — aguarde…'
                      : remote.enabled
                        ? 'Desativar o modo remoto do Hub (não desliga o ZeroTier)'
                        : 'Ativar o modo remoto (requer ZeroTier conectado)'
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    remote.onToggle()
                  }}
                >
                  {remote.busy || remote.installing ? (
                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Globe2 size={12} aria-hidden="true" />
                  )}
                  {remote.installing
                    ? 'Instalando ZeroTier…'
                    : remote.enabled
                      ? 'Remoto ativo'
                      : 'Modo remoto'}
                </Button>
                <IconButton
                  variant="ghost"
                  size="sm"
                  title="Como conectar no Moonlight (local e remoto)"
                  aria-label="Como conectar no Moonlight (local e remoto)"
                  onClick={(e) => {
                    e.stopPropagation()
                    remote.onHelp()
                  }}
                >
                  <HelpCircle size={15} aria-hidden="true" />
                </IconButton>
              </div>

              {remote.enabled && (powerBadge || remote.address) && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  {powerBadge ? <Badge tone={powerBadge.tone}>{powerBadge.label}</Badge> : <span />}
                  {remote.address && (
                    <IconButton
                      variant="ghost"
                      size="sm"
                      title="Copiar IP do ZeroTier"
                      aria-label="Copiar IP do ZeroTier"
                      onClick={(e) => {
                        e.stopPropagation()
                        remote.onCopyAddress()
                      }}
                    >
                      <ClipboardCopy size={14} aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              )}
              {remote.enabled && remote.address && (
                <p
                  className="mb-2 flex items-center gap-1.5 truncate text-[10px] text-ink-tertiary"
                  title={remote.address}
                >
                  Moonlight:
                  <code className="truncate font-mono text-[11px] font-semibold text-accent">
                    {remote.address}
                  </code>
                </p>
              )}
              {remote.enabled && !remote.address && !remote.loading && (
                <p className="mb-2 text-[10px] leading-snug text-warn">
                  ZeroTier desconectado — abra o ZeroTier para receber conexões.
                </p>
              )}
            </>
          )}

          <Button
            variant={isRunning ? 'danger' : 'primary'}
            size="md"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation()
              if (isRunning) {
                onStop()
              } else {
                onLaunch()
              }
            }}
          >
            {isRunning ? (
              <>
                <Square size={14} aria-hidden="true" /> Parar
              </>
            ) : (
              <>
                <Play size={14} aria-hidden="true" /> Iniciar
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
