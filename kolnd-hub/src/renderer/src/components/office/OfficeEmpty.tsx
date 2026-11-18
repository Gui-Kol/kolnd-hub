import { FolderOpen, MonitorX, PlugZap, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge, Button } from '../ui'

/**
 * Estado vazio do Escritório — degradação explícita (D9).
 *
 * Três recortes: CLI ausente, nenhuma sessão aberta e plugin de tempo real
 * ausente. Todos explicam em pt-BR o que aconteceu e oferecem "Tentar
 * novamente", que reassina o snapshot no main.
 */

export type OfficeEmptyKind = 'cli' | 'empty' | 'plugin'

export interface OfficeEmptyProps {
  kind: OfficeEmptyKind
  onRetry: () => void
  /** Desabilita o botão enquanto a nova assinatura está em andamento. */
  busy?: boolean
  /** Versão enxuta para a sidebar (aviso de plugin, por exemplo). */
  compact?: boolean
}

interface EmptyVariant {
  title: string
  badge: string
  icon: LucideIcon
  iconClass: string
  body: string
  detail: string
}

const VARIANTS: Record<OfficeEmptyKind, EmptyVariant> = {
  cli: {
    title: 'OpenCode não encontrado',
    badge: 'CLI ausente',
    icon: MonitorX,
    iconClass: 'text-danger',
    body: 'O Escritório não achou o CLI do OpenCode nesta máquina. Sem ele não há como listar sessões com segurança — o servidor local exige autenticação e o Hub nunca lê credenciais.',
    detail:
      'Esperado em %LOCALAPPDATA%\\Programs\\ai.opencode.desktop\\resources\\opencode-cli.exe ou defina KOLDND_HUB_OPENCODE_CLI.'
  },
  empty: {
    title: 'Nenhuma sessão aberta',
    badge: 'Tudo vazio',
    icon: FolderOpen,
    iconClass: 'text-accent',
    body: 'O CLI respondeu, mas não há sessões do OpenCode agora. Abra uma sessão em qualquer projeto e o personagem aparece na sala daquela pasta em até 2 segundos.',
    detail:
      'Cada pasta de projeto vira uma sala; cada sessão vira um personagem com nome e visual determinísticos.'
  },
  plugin: {
    title: 'Plugin de tempo real não instalado',
    badge: 'Modo somente leitura',
    icon: PlugZap,
    iconClass: 'text-warn',
    body: 'O poller do CLI já mostra salas, atividade, custo e tokens. O plugin de tempo real é a próxima etapa do projeto e trará eventos ao vivo e ações.',
    detail: 'O plugin rodará dentro do OpenCode e falará apenas com 127.0.0.1.'
  }
}

export function OfficeEmpty({
  kind,
  onRetry,
  busy = false,
  compact = false
}: OfficeEmptyProps): JSX.Element {
  const variant = VARIANTS[kind]
  const Icon = variant.icon

  return (
    <section
      aria-label={variant.title}
      className={`rounded-card border border-[var(--border-subtle)] bg-surface-1 ${
        compact ? 'p-3' : 'p-5'
      }`}
      data-testid="office-empty"
    >
      <div className={`flex ${compact ? 'items-start gap-2.5' : 'flex-col gap-3'}`}>
        <div className="flex items-center gap-2">
          <span
            className={`flex shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 ${
              compact ? 'h-7 w-7' : 'h-9 w-9'
            } ${variant.iconClass}`}
          >
            <Icon size={compact ? 15 : 18} aria-hidden="true" />
          </span>
          <Badge tone={kind === 'cli' ? 'danger' : kind === 'plugin' ? 'warning' : 'accent'}>
            {variant.badge}
          </Badge>
        </div>

        <div className="min-w-0 flex-1">
          <h3
            className={`font-semibold text-ink-primary ${
              compact ? 'text-[12.5px]' : 'text-[15px]'
            }`}
          >
            {variant.title}
          </h3>
          <p
            className={`mt-1 leading-snug text-ink-secondary ${
              compact ? 'text-[10.5px]' : 'text-[12px]'
            }`}
          >
            {variant.body}
          </p>
          {!compact && (
            <p className="mt-2 break-words rounded-control bg-surface-sunken px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-ink-tertiary">
              {variant.detail}
            </p>
          )}
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 ${compact ? 'mt-2.5' : 'mt-4'}`}>
        <Button variant="secondary" size="sm" onClick={onRetry} disabled={busy}>
          <RefreshCw size={12} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          Tentar novamente
        </Button>
      </div>
    </section>
  )
}
