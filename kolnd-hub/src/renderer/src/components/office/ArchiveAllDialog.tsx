import { useState } from 'react'
import { Archive, CircleAlert, Loader2 } from 'lucide-react'
import type { OfficeAgent } from '../../../../shared/office'
import { Button, Input, Modal } from '../ui'

/**
 * "Apagar todos" = ARQUIVAR todas as sessões (reversível). É o texto que o
 * usuário pediu, mas o efeito real é reversível em "Arquivados".
 *
 * Sessões `working` NUNCA são arquivadas por aqui: o diálogo conta quantas
 * serão mantidas e o main repete a regra. Exigir digitar APAGAR evita o clique
 * acidental num lote que afeta o OpenCode de verdade.
 */

const CONFIRM_WORD = 'APAGAR'

export interface ArchiveAllDialogProps {
  agents: readonly OfficeAgent[]
  onClose: () => void
  /** Chamado quando o lote terminou (mesmo parcial); o pai atualiza a lista. */
  onArchived: () => void
}

export function ArchiveAllDialog({
  agents,
  onClose,
  onArchived
}: ArchiveAllDialogProps): JSX.Element {
  const targets = agents.filter((agent) => agent.status !== 'working')
  const skipped = agents.length - targets.length
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ archived: number; skipped: number } | null>(null)

  const confirmed = confirmText.trim() === CONFIRM_WORD
  const canArchive = confirmed && !submitting && targets.length > 0 && !result

  function archive(): void {
    if (!canArchive) return
    setSubmitting(true)
    setError(null)

    void window.api
      .officeArchiveAll({})
      .then((outcome) => {
        if (outcome.archived > 0 || outcome.skipped > 0) {
          setResult({ archived: outcome.archived, skipped: outcome.skipped })
          onArchived()
        }
        if (!outcome.ok) {
          setError(outcome.error ?? 'Não consegui arquivar todos os funcionários.')
          return
        }
        if (outcome.archived === 0 && outcome.skipped === 0) {
          setResult({ archived: 0, skipped: 0 })
        }
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSubmitting(false))
  }

  return (
    <Modal
      title="Apagar todos os funcionários"
      ariaLabel="Apagar todos os funcionários"
      disableClose
      onClose={onClose}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose} data-testid="office-archive-close">
            Fechar
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={archive}
              disabled={!canArchive}
              data-testid="office-archive-confirm"
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Archive size={14} aria-hidden="true" />
              )}
              Arquivar {targets.length}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4" data-testid="office-archive-dialog">
        <p className="text-[12px] leading-5 text-ink-secondary">
          Isto <strong className="text-ink-primary">arquiva</strong> as sessões, não as exclui. O
          histórico continua no OpenCode e você pode restaurar depois em{' '}
          <strong className="text-ink-primary">Arquivados</strong>.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-3 py-2">
            <span
              className="tnum block text-xl font-bold leading-6 text-ink-primary"
              data-testid="office-archive-targets"
            >
              {targets.length}
            </span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
              serão arquivados
            </span>
          </div>
          <div className="rounded-control border border-warn-border bg-warn-bg px-3 py-2">
            <span
              className="tnum block text-xl font-bold leading-6 text-warn"
              data-testid="office-archive-skipped"
            >
              {skipped}
            </span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
              trabalhando — mantidos
            </span>
          </div>
        </div>

        {targets.length === 0 && (
          <p className="text-[11.5px] leading-snug text-ink-secondary">
            Todos os funcionários estão trabalhando agora. Nada será arquivado; tente de novo quando
            as tarefas terminarem.
          </p>
        )}

        {!result && (
          <div>
            <label
              htmlFor="office-archive-confirm-input"
              className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
            >
              Digite {CONFIRM_WORD} para confirmar
            </label>
            <Input
              id="office-archive-confirm-input"
              data-testid="office-archive-confirm-input"
              className="mt-1.5"
              value={confirmText}
              autoComplete="off"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
              onChange={(event) => setConfirmText(event.target.value)}
              disabled={submitting}
            />
          </div>
        )}

        {result && (
          <p
            role="status"
            data-testid="office-archive-result"
            className="rounded-control border border-success-border bg-success-bg px-3 py-2 text-[12px] text-success"
          >
            {result.archived} arquivado(s) · {result.skipped} mantido(s) por estar trabalhando.
          </p>
        )}

        {error && (
          <p
            role="alert"
            data-testid="office-archive-error"
            className="flex items-start gap-1.5 rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
          >
            <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
