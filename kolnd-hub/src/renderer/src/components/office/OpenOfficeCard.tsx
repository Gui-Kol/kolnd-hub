import { motion } from 'framer-motion'
import { ArrowUpRight, Building2 } from 'lucide-react'
import { entranceProps, useReducedMotion } from '../../lib/motion'
import { Badge, Button } from '../ui'

/**
 * Card do OpenOffice no grupo "Inteligência Artificial" da página Ferramentas.
 *
 * Visual coerente com o AppCard, mas sem Iniciar/Parar: não existe processo para
 * controlar — é uma página do Hub. O selo "Ao vivo" é a promessa da página; o
 * estado real (poller/plugin) aparece dentro dela.
 */

export interface OpenOfficeCardProps {
  onOpen: () => void
  delay?: number
}

const TAGS = ['OpenCode', 'Sessões', 'Somente leitura']

export function OpenOfficeCard({ onOpen, delay = 0.2 }: OpenOfficeCardProps): JSX.Element {
  const reduced = useReducedMotion()

  return (
    <motion.div
      {...entranceProps(reduced, { y: 20, scale: 0.95 }, { delay, duration: 0.5, ease: 'easeOut' })}
      whileTap={reduced ? undefined : { scale: 0.99 }}
      role="button"
      tabIndex={0}
      aria-label="OpenOffice — abrir o escritório das sessões do OpenCode"
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      onClick={onOpen}
      className="group relative flex cursor-pointer flex-col rounded-card border border-[var(--border-subtle)] bg-surface-1 p-5 pt-11 text-left shadow-elevation-1 transition-all duration-2 ease-standard hover:border-[var(--accent-border)] hover:bg-surface-2 hover:shadow-elevation-2"
      data-testid="openoffice-card"
    >
      <div className="absolute left-4 top-4 z-10">
        <Badge tone="accent">IA</Badge>
      </div>

      <div className="absolute right-4 top-4 z-10">
        <Badge tone="success" role="status">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-pill bg-success animate-pulse" />
          Ao vivo
        </Badge>
      </div>

      <div className="flex grow flex-col">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-accent transition-transform duration-2 ease-standard group-hover:scale-105">
              <Building2 size={22} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight text-ink-primary">
                OpenOffice
              </h3>
              <div className="mt-1 flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-pill bg-success" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-success">
                  Escritório
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="mb-5 text-[11px] font-medium leading-relaxed text-ink-secondary">
          Escritório das sessões do OpenCode
        </p>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {TAGS.map((tag) => (
            <span
              key={tag}
              className="rounded-pill border border-[var(--border-subtle)] px-2 py-0.5 text-[9px] font-semibold text-ink-secondary"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto">
          <p className="mb-2 text-[10px] text-ink-tertiary">
            Salas, personagens e métricas ao vivo — sem sair do Hub.
          </p>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
          >
            Abrir <ArrowUpRight size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
