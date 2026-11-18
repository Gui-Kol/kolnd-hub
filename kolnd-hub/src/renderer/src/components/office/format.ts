import type { OfficeActivityKind, OfficeAgent, OfficeAgentStatus } from '../../../../shared/office'

/**
 * Rótulos e formatadores da UI do Escritório.
 *
 * Tudo em pt-BR e derivado dos tokens do Hub (index.css). Nada aqui lê o
 * relógio: quem exibe duração passa `Date.now()` de fora, como no contrato.
 */

export interface StatusMeta {
  label: string
  /** Classe do ponto de status (tokens de cor). */
  dot: string
  text: string
  tone: 'success' | 'warn' | 'neutral' | 'danger'
}

export const STATUS_META: Record<OfficeAgentStatus, StatusMeta> = {
  working: {
    label: 'Trabalhando',
    dot: 'bg-success',
    text: 'text-success',
    tone: 'success'
  },
  needsYou: {
    label: 'Precisa de você',
    dot: 'bg-warn',
    text: 'text-warn',
    tone: 'warn'
  },
  idle: {
    label: 'Ocioso',
    dot: 'bg-ink-tertiary',
    text: 'text-ink-secondary',
    tone: 'neutral'
  },
  ended: {
    label: 'Encerrado',
    dot: 'bg-[#47525e]',
    text: 'text-ink-tertiary',
    tone: 'neutral'
  },
  unknown: {
    label: 'Sem dados',
    dot: 'bg-ink-tertiary',
    text: 'text-ink-tertiary',
    tone: 'neutral'
  }
}

export const ACTIVITY_META: Record<OfficeActivityKind, { label: string; className: string }> = {
  read: { label: 'Leitura', className: 'bg-[#7fb3e8]/10 text-[#7fb3e8]' },
  edit: { label: 'Edição', className: 'bg-accent-muted text-accent' },
  shell: { label: 'Comando', className: 'bg-success-bg text-success' },
  search: { label: 'Busca', className: 'bg-surface-3 text-ink-secondary' },
  web: { label: 'Web', className: 'bg-[#c79bf0]/10 text-[#c79bf0]' },
  think: { label: 'Plano', className: 'bg-warn-bg text-warn' },
  other: { label: 'Outro', className: 'bg-surface-3 text-ink-secondary' }
}

/** Rótulo da atividade atual (com fallback por status). */
export function activityLabel(agent: OfficeAgent): string {
  return agent.activity?.label ?? STATUS_META[agent.status].label
}

/** Custo em dólar no formato pt-BR (US$ 1,84 / US$ 0,0042). */
export function formatCost(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0
  if (safe > 0 && safe < 0.01) return `US$ ${safe.toFixed(4).replace('.', ',')}`
  return `US$ ${safe.toFixed(2).replace('.', ',')}`
}

/** Tokens compactos: 1,2 mi / 840 mil / 512. */
export function formatTokens(value: number): string {
  const safe = Number.isFinite(value) && value > 0 ? value : 0
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1).replace('.', ',')} mi`
  if (safe >= 1_000) return `${Math.round(safe / 1_000)} mil`
  return String(Math.round(safe))
}

/** Duração legível a partir de milissegundos. */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const minutes = Math.floor(safe / 60_000)
  if (minutes < 1) return 'menos de 1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours > 0 ? `${days} d ${restHours} h` : `${days} d`
}

/** Horário curto (HH:MM) para o feed. */
export function formatClock(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch <= 0) return '—'
  return new Date(epoch).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export interface ModelTotals {
  key: string
  providerID: string
  id: string
  sessions: number
  cost: number
  tokens: number
}

/** Agrega custo e tokens por modelo (provider/id) para a sidebar. */
export function totalsByModel(agents: readonly OfficeAgent[]): ModelTotals[] {
  const map = new Map<string, ModelTotals>()
  for (const agent of agents) {
    const key = `${agent.model.providerID}/${agent.model.id}`
    const existing = map.get(key)
    if (existing) {
      existing.sessions += 1
      existing.cost += agent.cost
      existing.tokens += agent.tokens.total
    } else {
      map.set(key, {
        key,
        providerID: agent.model.providerID,
        id: agent.model.id,
        sessions: 1,
        cost: agent.cost,
        tokens: agent.tokens.total
      })
    }
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id, 'pt-BR'))
}
