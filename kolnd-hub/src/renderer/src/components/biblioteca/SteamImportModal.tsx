import { memo } from 'react'
import { Download, Check, Info, AlertTriangle } from 'lucide-react'
import type { SteamImportResult } from '../../types'
import { Button, Modal, Spinner } from '../ui'

/** Estado do fluxo "Importar jogos da Steam" (menu Adicionar Games → modal). */
export type SteamImportState =
  { phase: 'idle' } | { phase: 'importing' } | { phase: 'done'; result: SteamImportResult }

export interface SteamImportModalProps {
  state: SteamImportState
  onClose: () => void
}

/** Linha do resumo: ícone à esquerda, rótulo, valor à direita. */
function SummaryRow({
  icon: Icon,
  tone,
  label,
  value
}: {
  icon: typeof Check
  tone: 'success' | 'neutral' | 'warn' | 'danger'
  label: string
  value: number
}): JSX.Element {
  const iconColor =
    tone === 'success'
      ? 'text-success'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-ink-tertiary'
  const valueColor =
    tone === 'success'
      ? 'text-accent'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-ink-primary'
  return (
    <li className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-2">
      <span className="flex items-center gap-2">
        <Icon size={14} aria-hidden="true" className={`shrink-0 ${iconColor}`} />
        {label}
      </span>
      <span className={`text-lg font-bold ${valueColor}`}>{value}</span>
    </li>
  )
}

/** Modal "Importar jogos da Steam" — apresentação pura; o fluxo vive no pai. */
export const SteamImportModal = memo(function SteamImportModal({
  state,
  onClose
}: SteamImportModalProps): JSX.Element | null {
  // idle desmonta como antes (o pai sempre renderiza este componente).
  if (state.phase === 'idle') return null

  // ── Fase importing: bloqueio total (o IPC não pode ser cancelado) ──
  // disableClose desliga Esc, backdrop e o X; o pai também ignora o fechamento.
  if (state.phase === 'importing') {
    return (
      <Modal disableClose ariaLabel="Importar jogos da Steam" onClose={onClose}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Spinner size={32} label="Importando jogos da Steam…" />
          <div>
            <h3 className="text-base font-bold text-ink-primary">Importando jogos da Steam…</h3>
            <p className="mt-1 text-xs text-ink-secondary">
              Detectando os jogos instalados. Isso pode levar alguns segundos.
            </p>
          </div>
        </div>
      </Modal>
    )
  }

  const { result } = state

  // ── Fase done, erro global (ex.: Steam não detectada) — mesmo texto/fluxo de hoje ──
  if (!result.ok) {
    return (
      <Modal
        ariaLabel="Importar jogos da Steam"
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
          <h3 className="text-base font-bold text-ink-primary">Não foi possível importar</h3>
          <p className="text-sm text-ink-secondary">
            {result.error ?? 'Ocorreu um erro inesperado.'}
          </p>
        </div>
      </Modal>
    )
  }

  // ── Fase done, resumo da importação ──
  return (
    <Modal
      ariaLabel="Importar jogos da Steam"
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
            <Download size={18} aria-hidden="true" className="text-accent" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink-primary">Importação concluída</h3>
            <p className="text-[11px] text-ink-secondary">
              Jogos detectados na sua instalação da Steam
            </p>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-ink-secondary">
          <SummaryRow
            icon={Check}
            tone="success"
            label="Jogos importados"
            value={result.imported}
          />
          <SummaryRow
            icon={Info}
            tone="neutral"
            label="Já estavam na biblioteca"
            value={result.alreadyInLibrary}
          />
          <SummaryRow
            icon={Info}
            tone="neutral"
            label="Itens ignorados (ferramentas)"
            value={result.ignoredTools}
          />
          {result.noExe > 0 && (
            <SummaryRow
              icon={AlertTriangle}
              tone="warn"
              label="Sem executável localizado"
              value={result.noExe}
            />
          )}
          {result.errors.length > 0 && (
            <SummaryRow
              icon={AlertTriangle}
              tone="danger"
              label="Com erro"
              value={result.errors.length}
            />
          )}
        </ul>

        {result.errors.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-control border border-danger-border bg-danger-bg px-3 py-2">
            {result.errors.slice(0, 5).map((message, index) => (
              <p key={index} className="font-mono text-[11px] leading-snug text-danger/90">
                {message}
              </p>
            ))}
            {result.errors.length > 5 && (
              <p className="font-mono text-[11px] text-danger/60">
                +{result.errors.length - 5} erro(s) — veja o log do app
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
})
