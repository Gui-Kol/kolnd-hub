import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import type { Game } from '../../types'
import { Button, Modal } from '../ui'

export interface RemoveGamesModalProps {
  /** Jogos selecionados para remover (já filtrados pelo pai). */
  games: Game[]
  /** Ids com processo aberto — aviso de que remover não encerra o jogo. */
  runningIds: ReadonlySet<string>
  /** Requisição em andamento: desabilita o fechamento e mostra spinner. */
  removing: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Quantos nomes aparecem antes do resumo "e mais N". */
const MAX_LISTED = 8

/**
 * Confirmação destrutiva da remoção em lote. Mesmo tom do "Editar Game":
 * deixa explícito que os jogos saem da biblioteca, mas os arquivos continuam
 * no computador (e que remover não encerra um processo em execução).
 */
export function RemoveGamesModal({
  games,
  runningIds,
  removing,
  onCancel,
  onConfirm
}: RemoveGamesModalProps): JSX.Element {
  const count = games.length
  const listed = games.slice(0, MAX_LISTED)
  const extra = count - listed.length
  const runningCount = games.filter((game) => runningIds.has(game.id)).length

  return (
    <Modal
      title={
        count === 1 ? 'Remover 1 jogo da biblioteca?' : `Remover ${count} jogos da biblioteca?`
      }
      onClose={onCancel}
      disableClose={removing}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={removing}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={removing}
            data-testid="biblioteca-remove-confirm"
          >
            {removing ? (
              <>
                <Loader2 size={14} aria-hidden="true" className="animate-spin" />
                Removendo…
              </>
            ) : (
              <>
                <Trash2 size={14} aria-hidden="true" />
                {count === 1 ? 'Remover 1 jogo' : `Remover ${count} jogos`}
              </>
            )}
          </Button>
        </>
      }
    >
      {/* O primitivo Modal não repassa props ao painel: o testid fica no miolo. */}
      <div data-testid="biblioteca-remove-modal" className="space-y-4">
        <ul className="space-y-1.5">
          {listed.map((game) => (
            <li key={game.id} className="truncate text-sm font-semibold text-ink-primary">
              {game.name}
            </li>
          ))}
        </ul>
        {extra > 0 && <p className="text-xs text-ink-tertiary">e mais {extra}</p>}

        <p className="flex items-start gap-2 rounded-control border border-danger-border bg-danger-bg px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
          <AlertTriangle size={15} aria-hidden="true" className="mt-px shrink-0 text-danger" />
          <span>Os arquivos dos jogos NÃO serão apagados do computador.</span>
        </p>

        {runningCount > 0 && (
          <p className="rounded-control border border-warn-border bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-warn">
            {count === 1
              ? 'Este jogo está em execução. Remover da biblioteca não encerra o processo.'
              : 'Um ou mais jogos selecionados estão em execução. Remover da biblioteca não encerra os processos.'}
          </p>
        )}
      </div>
    </Modal>
  )
}
