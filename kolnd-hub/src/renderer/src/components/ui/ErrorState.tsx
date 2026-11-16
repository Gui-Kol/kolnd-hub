// ErrorState — estado de erro único do Hub (tarefa 2.0/13.19).
//
// Vocabulário visual único para falhas recuperáveis de tela: ícone danger +
// título + mensagem amigável pt-BR + (opcional) detalhe técnico mono em bloco
// colapsável ("Detalhes técnicos", padrão já usado no PcUpdates) + ação
// "Tentar novamente". Substitui os cartões de erro feitos à mão
// (Biblioteca, PcUpdates, ErrorBoundary…).
//
// `technical` é para err.message cru/log — NUNCA coloque a mensagem amigável
// lá (ela ficaria escondida atrás do colapsável). Sem `onRetry`, o botão de
// tentar novamente não renderiza.
//
// Uso: <ErrorState title="Não foi possível carregar sua biblioteca."
//        message={loadError} onRetry={() => void loadGames()} />
import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { Card } from './Card'

export interface ErrorStateProps {
  /** Título do erro. Padrão: 'Algo deu errado'. */
  title?: string
  /** Mensagem amigável pt-BR (obrigatória). */
  message: string
  /** Detalhe técnico opcional (mono, colapsável via "Detalhes técnicos"). */
  technical?: string
  /** Se definido, renderiza o botão de tentar novamente com este handler. */
  onRetry?: () => void
  /** Rótulo do botão de retry. Padrão: 'Tentar novamente'. */
  retryLabel?: string
  /** Classes extras do Card (ex.: padding). */
  className?: string
}

export function ErrorState({
  title = 'Algo deu errado',
  message,
  technical,
  onRetry,
  retryLabel = 'Tentar novamente',
  className = ''
}: ErrorStateProps): JSX.Element {
  const [showTechnical, setShowTechnical] = useState(false)

  return (
    <Card
      role="alert"
      className={`flex flex-col items-center gap-3 border-danger-border p-10 text-center ${className}`.trim()}
    >
      <AlertTriangle size={32} aria-hidden="true" className="text-danger" />
      <h3 className="text-sm font-semibold text-ink-primary">{title}</h3>
      <p className="max-w-lg text-xs leading-relaxed text-ink-secondary">{message}</p>

      {technical != null && technical !== '' && (
        <div className="w-full max-w-2xl text-left">
          <button
            type="button"
            onClick={() => setShowTechnical((v) => !v)}
            aria-expanded={showTechnical}
            className="mx-auto flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary transition-colors duration-2 hover:text-ink-primary"
          >
            {showTechnical ? (
              <ChevronDown size={12} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} aria-hidden="true" />
            )}
            Detalhes técnicos
          </button>
          {showTechnical && (
            <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-3 font-mono text-[10px] leading-relaxed text-ink-secondary">
              {technical}
            </pre>
          )}
        </div>
      )}

      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          {retryLabel}
        </Button>
      )}
    </Card>
  )
}
