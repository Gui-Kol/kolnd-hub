import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import type {
  OfficeActivity,
  OfficeAgent,
  OfficeRoom,
  OfficeSnapshot
} from '../../../../shared/office'
import { defaultLookFor } from '../../../../shared/officeAvatar'
import { Badge, Button, Switch } from '../ui'
import { AgentPopover } from './AgentPopover'
import { AvatarEditor } from './AvatarEditor'
import { OfficeCanvas, type OfficeAgentAnchor } from './OfficeCanvas'
import { CreateRoomDialog, OfficeDepartments, RoomDialog } from './OfficeDepartments'
import { OfficeDetails } from './OfficeDetails'
import { OfficeEmpty } from './OfficeEmpty'
import { OfficeRoster } from './OfficeRoster'
import { OfficeSidebar } from './OfficeSidebar'
import { ACTIVITY_META, STATUS_META, formatClock } from './format'

/**
 * Página OpenOffice: um escritório vivo das sessões do OpenCode.
 *
 * Assina o IPC no mount (`officeSubscribe` + `onOfficeSnapshot`) e desassina no
 * unmount — o refcount do main desliga o poller quando ninguém está olhando.
 * A lista da sidebar é a via acessível; o canvas é a representação visual.
 */

const LEGEND: Array<{ status: keyof typeof STATUS_META; label: string }> = [
  { status: 'working', label: 'Trabalhando' },
  { status: 'needsYou', label: 'Precisa de você' },
  { status: 'idle', label: 'Ocioso' },
  { status: 'ended', label: 'Encerrado' }
]

function Counter({
  label,
  value,
  tone = 'text-ink-primary'
}: {
  label: string
  value: number
  tone?: string
}): JSX.Element {
  return (
    <div className="rounded-control border border-[var(--border-subtle)] bg-surface-1 px-3 py-2">
      <span className={`tnum block text-xl font-bold leading-6 ${tone}`}>{value}</span>
      <span className="mt-0.5 block truncate text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
        {label}
      </span>
    </div>
  )
}

function Legend(): JSX.Element {
  return (
    <div aria-label="Legenda de estados" className="flex flex-wrap items-center gap-3">
      {LEGEND.map((entry) => {
        const meta = STATUS_META[entry.status]
        return (
          <span
            key={entry.status}
            className="flex items-center gap-1.5 text-[10px] text-ink-tertiary"
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-sm ${meta.dot}`} />
            {entry.label}
          </span>
        )
      })}
    </div>
  )
}

function OfficeFeed({ feed }: { feed: readonly OfficeActivity[] }): JSX.Element {
  return (
    <section
      aria-label="Feed de atividades"
      className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          Atividade recente
        </h3>
        <span className="tnum text-[10px] text-ink-tertiary">{feed.length} eventos</span>
      </header>
      {feed.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] text-ink-tertiary">
          Nenhuma atividade registrada ainda nesta janela.
        </p>
      ) : (
        <ul className="max-h-[220px] divide-y divide-[var(--border-subtle)] overflow-y-auto">
          {feed.map((activity, index) => {
            const meta = ACTIVITY_META[activity.kind]
            return (
              <li
                key={`${activity.at}-${index}`}
                className="flex items-center gap-2.5 px-3 py-1.5 text-[11.5px]"
                data-testid="office-activity"
              >
                <span className="tnum w-10 shrink-0 text-[10px] text-ink-tertiary">
                  {formatClock(activity.at)}
                </span>
                <span
                  className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${meta.className}`}
                >
                  {meta.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-secondary" title={activity.label}>
                  {activity.label}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function OfficeView(): JSX.Element {
  const [snapshot, setSnapshot] = useState<OfficeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [selectedRoomID, setSelectedRoomID] = useState<string | null>(null)
  const [popover, setPopover] = useState<{ sessionID: string; anchor: OfficeAgentAnchor } | null>(
    null
  )
  const [avatarID, setAvatarID] = useState<string | null>(null)
  const [roomDialogID, setRoomDialogID] = useState<string | null>(null)
  const [createRoomOpen, setCreateRoomOpen] = useState(false)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const anchorsRef = useRef(new Map<string, OfficeAgentAnchor>())
  const [attempt, setAttempt] = useState(0)
  // Chave de ações: nasce DESLIGADA (o IPC também abre em somente leitura).
  const [actionsEnabled, setActionsEnabled] = useState(false)
  const [modeBusy, setModeBusy] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    const cleanup = window.api.onOfficeSnapshot((next) => {
      if (!alive) return
      setSnapshot(next)
      setLoading(false)
    })

    window.api
      .officeSubscribe()
      .then((initial) => {
        if (!alive) return
        if (initial) setSnapshot(initial)
        setLoading(false)
      })
      .catch(() => {
        if (!alive) return
        setError('Não consegui falar com o processo principal. Tente novamente.')
        setLoading(false)
      })

    return () => {
      alive = false
      cleanup()
      void window.api.officeUnsubscribe()
    }
  }, [attempt])

  const retry = useCallback(() => {
    setSnapshot(null)
    setSelectedID(null)
    setLoading(true)
    setError(null)
    setAttempt((current) => current + 1)
  }, [])

  /** Leitura pontual após contratar/arquivar/restaurar; o push do main vem logo atrás. */
  const refreshSnapshot = useCallback(() => {
    void window.api
      .officeSnapshot()
      .then((next) => {
        if (next) setSnapshot(next)
      })
      .catch(() => {
        // O push do poller continua sendo a fonte; falha de pull não trava a tela.
      })
  }, [])

  /** Liga/desliga o modo de ações no main; o retorno é a fonte da verdade. */
  const toggleActions = useCallback((next: boolean) => {
    setModeBusy(true)
    setModeError(null)
    void window.api
      .officeSetActionMode({ enabled: next })
      .then((result) => setActionsEnabled(result.enabled))
      .catch(() => setModeError('Não consegui mudar o modo de ações.'))
      .finally(() => setModeBusy(false))
  }, [])

  const selectedAgent: OfficeAgent | null = useMemo(() => {
    if (!snapshot || !selectedID) return null
    return snapshot.agents.find((agent) => agent.sessionID === selectedID) ?? null
  }, [snapshot, selectedID])

  const selectedRoom: OfficeRoom | null = useMemo(() => {
    if (!snapshot || !selectedAgent) return null
    return snapshot.rooms.find((room) => room.id === selectedAgent.roomID) ?? null
  }, [snapshot, selectedAgent])

  const selectedRequests = useMemo(() => {
    if (!selectedAgent) return []
    return (snapshot?.requests ?? []).filter(
      (request) => request.sessionID === selectedAgent.sessionID
    )
  }, [snapshot, selectedAgent])

  const handleLayout = useCallback(
    (anchors: ReadonlyMap<string, OfficeAgentAnchor>, size: { width: number; height: number }) => {
      anchorsRef.current = new Map(anchors)
      setCanvasSize((current) =>
        current.width === size.width && current.height === size.height ? current : size
      )
    },
    []
  )

  const openAgent = useCallback((sessionID: string, anchor: OfficeAgentAnchor) => {
    setSelectedRoomID(null)
    setSelectedID(sessionID)
    setPopover({ sessionID, anchor })
  }, [])

  const openAgentFromList = useCallback(
    (sessionID: string) => {
      const anchor = anchorsRef.current.get(sessionID) ?? {
        x: canvasSize.width / 2,
        y: canvasSize.height / 2
      }
      openAgent(sessionID, anchor)
    },
    [canvasSize.height, canvasSize.width, openAgent]
  )

  const openRoom = useCallback((roomID: string) => {
    setSelectedID(null)
    setPopover(null)
    setSelectedRoomID(roomID)
    setRoomDialogID(roomID)
  }, [])

  const closeRoom = useCallback(() => {
    setRoomDialogID(null)
    setSelectedRoomID(null)
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedID(null)
    setSelectedRoomID(null)
    setPopover(null)
  }, [])

  const assignRoom = useCallback(
    (sessionID: string, roomID: string | null) => {
      const call = roomID
        ? window.api.officeDepartmentAssign({ sessionID, departmentID: roomID, applyRole: false })
        : window.api.officeDepartmentUnassign({ sessionID })
      void call
        .then(() => refreshSnapshot())
        .catch(() => {
          // O erro aparece no painel da sala; aqui só evitamos estado travado.
        })
    },
    [refreshSnapshot]
  )

  const popoverAgent = useMemo(() => {
    if (!snapshot || !popover) return null
    return snapshot.agents.find((agent) => agent.sessionID === popover.sessionID) ?? null
  }, [snapshot, popover])

  const popoverRoom = useMemo(() => {
    if (!snapshot || !popoverAgent) return null
    return snapshot.rooms.find((room) => room.id === popoverAgent.roomID) ?? null
  }, [snapshot, popoverAgent])

  const roomDialogRoom = useMemo(() => {
    if (!snapshot || !roomDialogID) return null
    return snapshot.rooms.find((room) => room.id === roomDialogID) ?? null
  }, [snapshot, roomDialogID])

  const avatarAgent = useMemo(() => {
    if (!snapshot || !avatarID) return null
    return snapshot.agents.find((agent) => agent.sessionID === avatarID) ?? null
  }, [snapshot, avatarID])

  const avatarLook = useMemo(() => {
    if (!avatarAgent) return null
    return snapshot?.avatars[avatarAgent.sessionID] ?? defaultLookFor(avatarAgent.seed)
  }, [avatarAgent, snapshot])

  // Sessão/sala que sumiu do snapshot simplesmente deixa de renderizar; o
  // estado antigo é sobrescrito na próxima seleção (sem efeitos de "limpeza").
  const selectedLook = selectedAgent
    ? (snapshot?.avatars[selectedAgent.sessionID] ?? defaultLookFor(selectedAgent.seed))
    : null

  const totals = snapshot?.totals
  const live = snapshot?.health.pluginConnected ?? false
  const hasOffice = Boolean(snapshot && snapshot.health.cliFound && snapshot.agents.length > 0)

  return (
    <div className="mx-auto max-w-[1520px] space-y-4" data-testid="openoffice-page">
      {/* Aviso permanente (por isso sem botão de fechar): o OpenOffice ainda está
          incompleto e vai evoluir; o usuário precisa saber antes de confiar na tela. */}
      <div
        role="status"
        aria-label="Aviso: o OpenOffice ainda está incompleto e receberá melhorias em updates futuros"
        data-testid="openoffice-notice"
        className="flex flex-wrap items-start gap-3 rounded-card border border-warn-border bg-warn-bg px-4 py-3"
      >
        <Sparkles size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-ink-primary">
              Melhorias em updates futuros
            </p>
            <Badge tone="warning">ainda incompleto</Badge>
          </div>
          <p className="text-[12px] leading-5 text-ink-secondary">
            O OpenOffice ainda está incompleto e vai ganhar melhorias nas próximas atualizações.
          </p>
        </div>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
            Sessões do OpenCode
          </p>
          <h2 className="mt-1 text-[28px] font-bold leading-9 tracking-tight text-ink-primary">
            OpenOffice
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">
            Cada sessão do OpenCode é um personagem. Crie salas-departamento com uma função e clique
            em um personagem (ou na lista) para trocar função, designar sala ou editar a aparência.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={live ? 'success' : 'neutral'} role="status">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-pill ${live ? 'bg-success' : 'bg-ink-tertiary'}`}
            />
            {live ? 'Ao vivo' : 'Somente leitura'}
          </Badge>

          <div
            className="flex h-8 items-center gap-2 rounded-control border border-[var(--border-subtle)] bg-surface-1 px-2.5"
            title={
              live ? 'Permite responder pedidos e enviar mensagens pelo Hub' : 'Plugin ausente'
            }
          >
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
              Ações:
            </span>
            <Switch
              checked={actionsEnabled && live}
              onCheckedChange={toggleActions}
              disabled={!live || modeBusy}
              aria-label="Permitir ações no OpenCode"
              data-testid="office-action-mode"
              className="h-8"
            />
            <span
              data-testid="office-action-mode-label"
              className={`text-[10px] font-medium ${
                actionsEnabled && live ? 'text-success' : 'text-ink-tertiary'
              }`}
            >
              {actionsEnabled && live ? 'habilitadas' : 'somente leitura'}
            </span>
          </div>

          {modeError && (
            <span role="alert" className="text-[10px] text-danger">
              {modeError}
            </span>
          )}

          {snapshot && (
            <span className="text-[10px] text-ink-tertiary">
              Atualizado às {formatClock(snapshot.generatedAt)}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={retry} disabled={loading}>
            <RefreshCw
              size={12}
              className={loading ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            Atualizar
          </Button>
        </div>
      </header>

      <section
        aria-label="Contadores do escritório"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
      >
        <Counter label="Salas" value={snapshot?.rooms.length ?? 0} />
        <Counter label="Sessões" value={snapshot?.agents.length ?? 0} />
        <Counter label="Trabalhando" value={totals?.working ?? 0} tone="text-success" />
        <Counter label="Precisam de você" value={totals?.needsYou ?? 0} tone="text-warn" />
        <Counter label="Subagentes" value={totals?.subagents ?? 0} />
      </section>

      {snapshot && snapshot.health.cliFound && (
        <OfficeRoster snapshot={snapshot} onChanged={refreshSnapshot} />
      )}

      {!snapshot && loading && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-card border border-[var(--border-subtle)] bg-surface-1 px-4 py-6 text-[12px] text-ink-secondary"
        >
          <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
          Consultando as sessões do OpenCode…
        </div>
      )}

      {!snapshot && !loading && error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-[12px] text-danger"
        >
          <TriangleAlert size={16} aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="secondary" size="sm" onClick={retry}>
            Tentar novamente
          </Button>
        </div>
      )}

      {snapshot && !snapshot.health.cliFound && (
        <OfficeEmpty kind="cli" onRetry={retry} busy={loading} />
      )}

      {snapshot && snapshot.health.cliFound && snapshot.agents.length === 0 && (
        <div className="space-y-3">
          <OfficeEmpty
            kind={snapshot.unassignedCount > 0 ? 'unassigned' : 'empty'}
            unassignedCount={snapshot.unassignedCount}
            onCreateRoom={() => setCreateRoomOpen(true)}
            onRetry={retry}
            busy={loading}
          />
          {/* Sem ninguém visível, a gestão de salas continua na página para
              designar as sessões que ficaram fora (nunca no canvas/sidebar). */}
          <OfficeDepartments
            snapshot={snapshot}
            onChanged={refreshSnapshot}
            onOpenRoom={openRoom}
          />
        </div>
      )}

      {snapshot && hasOffice && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 space-y-3">
            <div className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3.5 py-2">
                <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
                  <Building2 size={14} className="text-accent" aria-hidden="true" />
                  <span>
                    <span className="tnum font-semibold text-ink-primary">
                      {snapshot.rooms.length}
                    </span>{' '}
                    salas ·{' '}
                    <span className="tnum font-semibold text-ink-primary">
                      {snapshot.agents.length}
                    </span>{' '}
                    sessões
                  </span>
                </div>
                <Legend />
              </div>
              <div className="relative h-[min(62vh,560px)] min-h-[380px]">
                <OfficeCanvas
                  snapshot={snapshot}
                  selectedID={selectedID}
                  selectedRoomID={selectedRoomID}
                  onLayout={handleLayout}
                  onSelectAgent={openAgent}
                  onSelectRoom={openRoom}
                  onSelectEmpty={clearSelection}
                />
                {popover && popoverAgent && (
                  <AgentPopover
                    agent={popoverAgent}
                    room={popoverRoom}
                    bounds={canvasSize}
                    anchor={popover.anchor}
                    onClose={() => setPopover(null)}
                    onAppearance={() => {
                      setAvatarID(popoverAgent.sessionID)
                      setPopover(null)
                    }}
                    onSaved={refreshSnapshot}
                  />
                )}
              </div>
            </div>

            <OfficeFeed feed={snapshot.feed} />
          </div>

          <aside aria-label="Painel do escritório" className="min-w-0 space-y-3">
            <OfficeDepartments
              snapshot={snapshot}
              onChanged={refreshSnapshot}
              onOpenRoom={openRoom}
            />
            <OfficeDetails
              key={selectedID ?? 'sem-selecao'}
              agent={selectedAgent}
              room={selectedRoom}
              now={snapshot.generatedAt}
              requests={selectedRequests}
              actionsEnabled={actionsEnabled && live}
              pluginConnected={live}
              onRoleSaved={refreshSnapshot}
              rooms={snapshot.rooms.filter((room) => !room.unassigned)}
              look={selectedLook}
              onEditAppearance={() => setAvatarID(selectedAgent?.sessionID ?? null)}
              onRoomChange={(roomID) => {
                if (selectedAgent) assignRoom(selectedAgent.sessionID, roomID)
              }}
            />
            <OfficeSidebar
              snapshot={snapshot}
              selectedID={selectedID}
              onSelect={openAgentFromList}
              onRetry={retry}
              onOpenRoom={openRoom}
            />
          </aside>
        </div>
      )}

      {roomDialogRoom && snapshot && (
        <RoomDialog
          room={roomDialogRoom}
          agents={snapshot.agents}
          onClose={closeRoom}
          onChanged={refreshSnapshot}
        />
      )}

      {createRoomOpen && snapshot && (
        <CreateRoomDialog
          snapshot={snapshot}
          onClose={() => setCreateRoomOpen(false)}
          onCreated={() => {
            setCreateRoomOpen(false)
            refreshSnapshot()
          }}
        />
      )}

      {avatarAgent && avatarLook && (
        <AvatarEditor
          agent={avatarAgent}
          look={avatarLook}
          onClose={() => setAvatarID(null)}
          onSaved={() => {
            setAvatarID(null)
            refreshSnapshot()
          }}
        />
      )}
    </div>
  )
}
