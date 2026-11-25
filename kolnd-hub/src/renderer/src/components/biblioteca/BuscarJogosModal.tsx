import { memo } from 'react'
import { AlertTriangle, Info, Search } from 'lucide-react'
import type { GameImportReport, GameSourceImportReport } from '../../types'
import { Button, Modal, Spinner } from '../ui'

/** Estado do fluxo "Buscar jogos" (menu Adicionar Games → modal). */
export type BuscarJogosState =
  { phase: 'idle' } | { phase: 'importing' } | { phase: 'done'; result: GameImportReport }

export interface BuscarJogosModalProps {
  state: BuscarJogosState
  onClose: () => void
}

/** Linha de uma fonte detectada: "N novos · M já na biblioteca". */
function SourceRow({ source }: { source: GameSourceImportReport }): JSX.Element {
  const empty =
    source.imported === 0 &&
    source.alreadyInLibrary === 0 &&
    source.noExe === 0 &&
    source.errors.length === 0

  return (
    <li className="space-y-1 border-b border-[var(--border-subtle)] pb-2 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium text-ink-primary">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-pill ${
              source.detected ? 'bg-accent' : 'bg-ink-tertiary'
            }`}
          />
          {source.label}
        </span>
        {source.detected ? (
          <span className="shrink-0 text-[13px] tabular-nums text-ink-secondary">
            {source.imported} novos · {source.alreadyInLibrary} já na biblioteca
          </span>
        ) : (
          <span className="shrink-0 text-[13px] text-ink-tertiary">Não encontrado neste PC</span>
        )}
      </div>

      {!source.detected && source.message && (
        <p className="pl-3.5 text-[11px] leading-snug text-ink-tertiary">{source.message}</p>
      )}

      {source.detected && empty && (
        <p className="pl-3.5 text-[11px] leading-snug text-ink-tertiary">Nenhum jogo encontrado</p>
      )}

      {source.detected && source.noExe > 0 && (
        <p className="pl-3.5 text-[11px] leading-snug text-warn">
          {source.noExe === 1
            ? '1 jogo sem executável localizado'
            : `${source.noExe} jogos sem executável localizados`}
        </p>
      )}

      {source.errors.length > 0 && (
        <div className="ml-3.5 mt-1 max-h-24 space-y-1 overflow-y-auto rounded-control border border-danger-border bg-danger-bg px-3 py-2">
          {source.errors.slice(0, 5).map((message, index) => (
            <p key={index} className="font-mono text-[11px] leading-snug text-danger/90">
              {message}
            </p>
          ))}
          {source.errors.length > 5 && (
            <p className="font-mono text-[11px] text-danger/60">
              +{source.errors.length - 5} erro(s) — veja o log do app
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** Modal "Buscar jogos" — apresentação pura; o fluxo vive no pai. */
export const BuscarJogosModal = memo(function BuscarJogosModal({
  state,
  onClose
}: BuscarJogosModalProps): JSX.Element | null {
  // idle desmonta como antes (o pai sempre renderiza este componente).
  if (state.phase === 'idle') return null

  // ── Fase importing: bloqueio total (a varredura do main não é cancelável) ──
  // disableClose desliga Esc, backdrop e o X; o pai também ignora o fechamento.
  if (state.phase === 'importing') {
    return (
      <Modal disableClose ariaLabel="Buscar jogos" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Spinner size={32} label="Procurando jogos instalados…" />
          <div>
            <h3 className="text-base font-bold text-ink-primary">Procurando jogos instalados…</h3>
            <p className="mt-1 text-xs text-ink-secondary">Isso pode levar alguns segundos.</p>
          </div>
        </div>
      </Modal>
    )
  }

  const { result } = state

  // ── Fase done, erro global (falha inesperada no orquestrador) ──
  if (!result.ok) {
    return (
      <Modal
        ariaLabel="Buscar jogos"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose} data-autofocus>
            Fechar
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
            <AlertTriangle size={24} aria-hidden="true" className="text-danger" />
          </div>
          <h3 className="text-base font-bold text-ink-primary">Não foi possível buscar os jogos</h3>
          <p className="text-sm text-ink-secondary">
            {result.error ?? 'Ocorreu um erro inesperado.'}
          </p>
        </div>
      </Modal>
    )
  }

  // ── Fase done, resumo por fonte ──
  const totalText =
    result.imported > 0
      ? `${result.imported} ${result.imported === 1 ? 'jogo adicionado' : 'jogos adicionados'} à sua biblioteca`
      : 'Nenhum jogo novo encontrado'

  return (
    <Modal
      ariaLabel="Buscar jogos"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} data-autofocus>
          Fechar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-muted">
            <Search size={18} aria-hidden="true" className="text-accent" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink-primary">Busca concluída</h3>
            <p className="text-[11px] text-ink-secondary">{totalText}</p>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-ink-secondary">
          {result.sources.map((source) => (
            <SourceRow key={source.source} source={source} />
          ))}
        </ul>

        <div className="flex items-start gap-2 rounded-control bg-surface-2 px-3 py-2 text-[11px] text-ink-tertiary">
          <Info size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            A busca procura jogos já instalados na Steam, Epic Games e Minecraft Launcher. Nada é
            baixado ou alterado nos launchers.
          </span>
        </div>
      </div>
    </Modal>
  )
})
