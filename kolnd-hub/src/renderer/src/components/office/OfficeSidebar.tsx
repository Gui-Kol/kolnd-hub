import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { OfficeAgent, OfficeRoom, OfficeSnapshot } from '../../../../shared/office'
import { OfficeEmpty } from './OfficeEmpty'
import { STATUS_META, formatCost, formatTokens, totalsByModel, type ModelTotals } from './format'

/**
 * Sidebar do Escritório — a via **acessível** da página.
 *
 * A busca filtra salas/agentes, cada sessão é um botão de verdade (foco
 * visível, `aria-pressed`) e a tabela agrega custo/tokens por modelo. O canvas
 * é apenas a representação visual; tudo o que ele mostra existe aqui em texto.
 */

export interface OfficeSidebarProps {
  snapshot: OfficeSnapshot
  selectedID: string | null
  onSelect: (sessionID: string) => void
  /** Repete a assinatura do snapshot (usado no aviso de plugin ausente). */
  onRetry: () => void
  /** Abre as configurações da sala (mesmo modal do canvas). */
  onOpenRoom?: (roomID: string) => void
}

function Panel({
  title,
  aside,
  children
}: {
  title: string
  aside?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          {title}
        </h3>
        {aside && <span className="tnum text-[10px] text-ink-tertiary">{aside}</span>}
      </header>
      {children}
    </section>
  )
}

function roomMatches(room: OfficeRoom, agents: OfficeAgent[], query: string): boolean {
  if (!query) return true
  if (room.name.toLowerCase().includes(query)) return true
  return agents.some((agent) => agentMatches(agent, query))
}

function agentMatches(agent: OfficeAgent, query: string): boolean {
  if (!query) return true
  return (
    agent.name.toLowerCase().includes(query) ||
    agent.title.toLowerCase().includes(query) ||
    agent.agent.toLowerCase().includes(query) ||
    agent.model.id.toLowerCase().includes(query) ||
    agent.model.providerID.toLowerCase().includes(query)
  )
}

export function OfficeSidebar({
  snapshot,
  selectedID,
  onSelect,
  onRetry,
  onOpenRoom
}: OfficeSidebarProps): JSX.Element {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLowerCase()

  const agentByID = useMemo(() => {
    const map = new Map<string, OfficeAgent>()
    for (const agent of snapshot.agents) map.set(agent.sessionID, agent)
    return map
  }, [snapshot.agents])

  const agentsByRoom = useMemo(() => {
    const map = new Map<string, OfficeAgent[]>()
    for (const room of snapshot.rooms) {
      const agents = room.agentIDs
        .map((sessionID) => agentByID.get(sessionID))
        .filter((agent): agent is OfficeAgent => Boolean(agent))
      map.set(room.id, agents)
    }
    return map
  }, [snapshot.rooms, agentByID])

  const filteredRooms = useMemo(
    () =>
      snapshot.rooms.filter((room) =>
        roomMatches(room, agentsByRoom.get(room.id) ?? [], normalized)
      ),
    [snapshot.rooms, agentsByRoom, normalized]
  )

  const models: ModelTotals[] = useMemo(() => totalsByModel(snapshot.agents), [snapshot.agents])

  return (
    <div className="space-y-3">
      <Panel title="Salas e sessões" aside={`${snapshot.rooms.length} salas`}>
        <div className="space-y-2 p-2.5">
          <div>
            <label htmlFor="office-search" className="sr-only">
              Buscar sala ou agente
            </label>
            <div className="relative">
              <Search
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
              />
              <input
                id="office-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar sala ou agente…"
                className="h-8 w-full rounded-control border border-[var(--border-subtle)] bg-surface-sunken pl-8 pr-2.5 text-[12px] text-ink-primary placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none"
              />
            </div>
          </div>

          {filteredRooms.length === 0 && (
            <p className="px-1 py-2 text-[11.5px] text-ink-tertiary">
              Nenhuma sala ou agente corresponde à busca.
            </p>
          )}

          {filteredRooms.map((room) => {
            const agents = (agentsByRoom.get(room.id) ?? []).filter((agent) =>
              // Sala encontrada pelo nome mostra todos; senão, só os agentes que batem.
              room.name.toLowerCase().includes(normalized) ? true : agentMatches(agent, normalized)
            )
            return (
              <div
                key={room.id}
                className="overflow-hidden rounded-control border border-[var(--border-subtle)]"
                data-testid="office-room"
              >
                <div className="flex items-center gap-2 bg-surface-2 px-2.5 py-1.5">
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
                  <span
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-primary"
                    title={room.id}
                  >
                    {room.name}
                  </span>
                  <span className="tnum rounded-pill bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-tertiary">
                    {room.agentIDs.length}
                  </span>
                  {onOpenRoom && (
                    <button
                      type="button"
                      onClick={() => onOpenRoom(room.id)}
                      aria-label={`Abrir sala ${room.name}`}
                      data-testid="office-room-open"
                      className="rounded-control px-1.5 py-0.5 text-[10px] font-medium text-ink-tertiary hover:bg-surface-3 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      Abrir
                    </button>
                  )}
                </div>

                {agents.length === 0 ? (
                  <p className="px-2.5 py-1.5 text-[11px] text-ink-tertiary">Sem sessões aqui.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {agents.map((agent) => {
                      const status = STATUS_META[agent.status]
                      const selected = selectedID === agent.sessionID
                      return (
                        <li key={agent.sessionID}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            data-testid="office-agent"
                            onClick={() => onSelect(agent.sessionID)}
                            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                              selected
                                ? 'bg-accent-muted text-ink-primary'
                                : 'text-ink-secondary hover:bg-surface-2 hover:text-ink-primary'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`h-2 w-2 shrink-0 rounded-pill ${status.dot}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12px] font-medium">
                                {agent.name}
                                {agent.parentID ? ' · sub' : ''}
                              </span>
                              <span className="block truncate text-[10px] text-ink-tertiary">
                                {agent.agent} · {status.label}
                              </span>
                            </span>
                            {agent.rolePending && (
                              <span
                                data-testid="office-agent-pending"
                                className="shrink-0 rounded-pill border border-warn-border bg-warn-bg px-1.5 py-0.5 text-[9px] font-semibold text-warn"
                              >
                                pendente
                              </span>
                            )}
                            <span className="max-w-[88px] shrink-0 truncate text-[10px] text-ink-tertiary">
                              {agent.model.id}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Custo e tokens por modelo" aside={`${models.length}`}>
        {models.length === 0 ? (
          <p className="px-3 py-2 text-[11.5px] text-ink-tertiary">Sem sessões para agregar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <caption className="sr-only">Custo e tokens agregados por modelo</caption>
              <thead>
                <tr className="text-[9.5px] uppercase tracking-[0.08em] text-ink-tertiary">
                  <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                    Modelo
                  </th>
                  <th scope="col" className="px-1 py-1.5 text-right font-medium">
                    Sess.
                  </th>
                  <th scope="col" className="px-1 py-1.5 text-right font-medium">
                    Custo
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                    Tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.key} className="border-t border-[var(--border-subtle)]">
                    <th scope="row" className="px-2.5 py-1.5 text-left font-normal">
                      <span className="block truncate text-ink-primary">{model.id}</span>
                      <span className="block truncate text-[9.5px] text-ink-tertiary">
                        {model.providerID}
                      </span>
                    </th>
                    <td className="tnum px-1 py-1.5 text-right text-ink-secondary">
                      {model.sessions}
                    </td>
                    <td className="tnum px-1 py-1.5 text-right text-ink-secondary">
                      {formatCost(model.cost)}
                    </td>
                    <td className="tnum px-2.5 py-1.5 text-right text-ink-secondary">
                      {formatTokens(model.tokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-control border border-[var(--border-subtle)] bg-surface-1 px-3 py-2">
          <span className="block text-[9.5px] uppercase tracking-[0.12em] text-ink-tertiary">
            Custo total
          </span>
          <span className="tnum mt-0.5 block text-[15px] font-semibold text-ink-primary">
            {formatCost(snapshot.totals.cost)}
          </span>
        </div>
        <div className="rounded-control border border-[var(--border-subtle)] bg-surface-1 px-3 py-2">
          <span className="block text-[9.5px] uppercase tracking-[0.12em] text-ink-tertiary">
            Tokens totais
          </span>
          <span className="tnum mt-0.5 block text-[15px] font-semibold text-ink-primary">
            {formatTokens(snapshot.totals.tokens)}
          </span>
        </div>
      </div>

      {snapshot.health.lastError && (
        <p
          role="status"
          className="rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
        >
          {snapshot.health.lastError}
        </p>
      )}

      {!snapshot.health.pluginConnected && <OfficeEmpty kind="plugin" compact onRetry={onRetry} />}
    </div>
  )
}
