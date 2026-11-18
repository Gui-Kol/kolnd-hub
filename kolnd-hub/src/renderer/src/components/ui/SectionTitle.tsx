import type { ReactNode } from 'react'

/** Rótulo de seção da tela (uppercase + hairline), coerente com os grupos da Dashboard. */
export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="mx-2 flex items-center gap-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {children}
      </h3>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
    </div>
  )
}
