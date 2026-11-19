import { useCallback, useEffect, useState } from 'react'
import { Archive, ArchiveRestore, CircleAlert, Loader2, RotateCcw, UserPlus } from 'lucide-react'
import type { OfficeArchivedEmployee, OfficeSnapshot } from '../../../../shared/office'
import { Button, Modal } from '../ui'
import { ArchiveAllDialog } from './ArchiveAllDialog'
import { HireDialog } from './HireDialog'

/**
 * Painel "Funcionários" do OpenOffice.
 *
 * Contratar cria uma sessão real no OpenCode; "Apagar todos" ARQUIVA (nunca
 * exclui) e "Arquivados" é a via de restauração. O painel aparece mesmo com
 * zero funcionários — senão não daria para restaurar depois de apagar todos.
 * Toda escrita vai para o main, que valida de novo.
 */

export interface OfficeRosterProps {
  snapshot: OfficeSnapshot
  /** Pull imediato do snapshot após uma mutação (a UI reflete sem esperar o tick). */
  onChanged: () => void
}

export function OfficeRoster({ snapshot, onChanged }: OfficeRosterProps): JSX.Element {
  const [hireOpen, setHireOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archived, setArchived] = useState<OfficeArchivedEmployee[]>([])
  const [archivedLoading, setArchivedLoading] = useState(true)
  const [archivedError, setArchivedError] = useState<string | null>(null)
  const [restoringID, setRestoringID] = useState<string | null>(null)
  const [restoringAll, setRestoringAll] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadArchived = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.officeArchivedList({})
      if (!result.ok) {
        setArchivedError(result.error ?? 'Não consegui listar os funcionários arquivados.')
        return
      }
      setArchivedError(null)
      setArchived(result.items)
    } catch {
      setArchivedError('Não consegui falar com o processo principal.')
    } finally {
      setArchivedLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void window.api
      .officeArchivedList({})
      .then((result) => {
        if (!alive) return
        if (!result.ok) {
          setArchivedError(result.error ?? 'Não consegui listar os funcionários arquivados.')
          return
        }
        setArchivedError(null)
        setArchived(result.items)
      })
      .catch(() => {
        if (alive) setArchivedError('Não consegui falar com o processo principal.')
      })
      .finally(() => {
        if (alive) setArchivedLoading(false)
      })

    return () => {
      alive = false
    }
  }, [])

  async function restoreOne(sessionID: string): Promise<void> {
    setRestoringID(sessionID)
    setArchivedError(null)
    try {
      const result = await window.api.officeRestore({ sessionID })
      if (!result.ok) {
        setArchivedError(result.error ?? 'Não consegui restaurar o funcionário.')
        return
      }
      setNotice('Funcionário restaurado.')
      setArchivedLoading(true)
      void loadArchived()
      onChanged()
    } catch {
      setArchivedError('Não consegui falar com o processo principal.')
    } finally {
      setRestoringID(null)
    }
  }

  async function restoreAll(): Promise<void> {
    if (archived.length === 0 || restoringAll) return
    setRestoringAll(true)
    setArchivedError(null)
    let restored = 0

    try {
      for (const employee of [...archived]) {
        const result = await window.api.officeRestore({ sessionID: employee.sessionID })
        if (!result.ok) {
          setArchivedError(result.error ?? 'Não consegui restaurar todos os funcionários.')
          break
        }
        restored += 1
      }
    } catch {
      setArchivedError('Não consegui falar com o processo principal.')
    } finally {
      setRestoringAll(false)
      if (restored > 0) {
        setNotice(`${restored} funcionário(s) restaurado(s).`)
        setArchivedLoading(true)
        void loadArchived()
        onChanged()
      }
    }
  }

  return (
    <section
      aria-label="Funcionários"
      data-testid="office-roster"
      className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          Funcionários
        </h3>
        <span className="tnum text-[10px] text-ink-tertiary">
          {snapshot.agents.length} ativo(s)
        </span>
      </header>

      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button
          size="sm"
          variant="primary"
          onClick={() => setHireOpen(true)}
          data-testid="office-roster-hire"
        >
          <UserPlus size={13} aria-hidden="true" />
          Contratar
        </Button>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => setArchiveOpen(true)}
          disabled={snapshot.agents.length === 0}
          data-testid="office-roster-archive-all"
        >
          <Archive size={13} aria-hidden="true" />
          Apagar todos
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setArchivedOpen(true)
            setArchivedLoading(true)
            void loadArchived()
          }}
          data-testid="office-roster-archived"
        >
          {archivedLoading ? (
            <Loader2 size={13} className="animate-spin" aria-hidden="true" />
          ) : (
            <ArchiveRestore size={13} aria-hidden="true" />
          )}
          Arquivados ({archived.length})
        </Button>

        {notice && (
          <span role="status" className="text-[10.5px] text-success">
            {notice}
          </span>
        )}
      </div>

      <p className="px-3 pb-3 text-[10.5px] leading-snug text-ink-tertiary">
        Apagar todos arquiva as sessões (reversível); quem está trabalhando é mantido.
      </p>

      {hireOpen && (
        <HireDialog
          rooms={snapshot.rooms}
          onClose={() => setHireOpen(false)}
          onHired={() => {
            setHireOpen(false)
            setNotice('Funcionário contratado.')
            onChanged()
            setArchivedLoading(true)
            void loadArchived()
          }}
        />
      )}

      {archiveOpen && (
        <ArchiveAllDialog
          agents={snapshot.agents}
          onClose={() => setArchiveOpen(false)}
          onArchived={() => {
            onChanged()
            setArchivedLoading(true)
            void loadArchived()
          }}
        />
      )}

      {archivedOpen && (
        <Modal
          title="Funcionários arquivados"
          onClose={() => setArchivedOpen(false)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => void restoreAll()}
                disabled={archived.length === 0 || restoringAll}
                data-testid="office-archived-restore-all"
              >
                {restoringAll ? (
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw size={13} aria-hidden="true" />
                )}
                Restaurar todos
              </Button>
              <Button
                variant="ghost"
                onClick={() => setArchivedOpen(false)}
                data-testid="office-archived-close"
              >
                Fechar
              </Button>
            </>
          }
        >
          <div className="space-y-3" data-testid="office-archived-dialog">
            <p className="text-[12px] leading-5 text-ink-secondary">
              Restaurar devolve a sessão ao escritório sem apagar nada. O histórico e o custo
              continuam no OpenCode.
            </p>

            {archivedError && (
              <p
                role="alert"
                className="flex items-start gap-1.5 rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
              >
                <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
                {archivedError}
              </p>
            )}

            {archived.length === 0 ? (
              <p className="text-[12px] text-ink-tertiary">Nenhum funcionário arquivado.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]" aria-label="Arquivados">
                {archived.map((employee) => (
                  <li
                    key={employee.sessionID}
                    data-testid="office-archived-row"
                    className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-ink-primary">
                        {employee.title}
                      </p>
                      <p className="truncate text-[10px] text-ink-tertiary">
                        {employee.agent} · {employee.model.id || 'modelo desconhecido'}
                        {employee.directory ? ` · ${employee.directory}` : ''}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void restoreOne(employee.sessionID)}
                      disabled={restoringAll || restoringID === employee.sessionID}
                      data-testid="office-archived-restore"
                    >
                      {restoringID === employee.sessionID ? (
                        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                      ) : (
                        'Restaurar'
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}
