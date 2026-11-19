import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Check,
  CircleAlert,
  DoorOpen,
  Loader2,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Wand2
} from 'lucide-react'
import type {
  OfficeAgent,
  OfficeAgentOption,
  OfficeDepartmentApplyResult,
  OfficeModelOption,
  OfficeRoom,
  OfficeSnapshot
} from '../../../../shared/office'
import { STATUS_META } from './format'
import { Badge, Button, Input, Modal, Select } from '../ui'

/**
 * Painel de salas (departamentos) do OpenOffice e o modal de configurações.
 *
 * A sala É o departamento: nome + função (agente) + funcionários designados.
 * "Aplicar função" age no OpenCode de verdade e SEMPRE pede confirmação;
 * quem está `working` fica pendente (badge) em vez de ser interrompido.
 */

export interface OfficeDepartmentsProps {
  snapshot: OfficeSnapshot
  onChanged: () => void
  onOpenRoom: (roomID: string) => void
}

interface RoleOptions {
  agents: OfficeAgentOption[]
  models: OfficeModelOption[]
  loading: boolean
  error: string | null
}

function fallbackAgents(ids: readonly string[]): OfficeAgentOption[] {
  return [...new Set(ids.filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map((id) => ({ id, name: id, mode: 'all' }))
}

/** Opções de função da sala: `GET /api/agent` quando há pasta; senão, o snapshot. */
function useRoleOptions(directory: string, fallbackIDs: readonly string[]): RoleOptions {
  const [state, setState] = useState<RoleOptions>(() => ({
    agents: fallbackAgents(fallbackIDs),
    models: [],
    loading: directory.length > 0,
    error: null
  }))

  useEffect(() => {
    if (!directory) return
    let alive = true
    window.api
      .officeRosterOptions({ directory })
      .then((result) => {
        if (!alive) return
        if (!result.ok) {
          setState({
            agents: fallbackAgents(fallbackIDs),
            models: [],
            loading: false,
            error: result.error ?? 'Não consegui consultar as funções da sala.'
          })
          return
        }
        setState({ agents: result.agents, models: result.models, loading: false, error: null })
      })
      .catch(() => {
        if (!alive) return
        setState({
          agents: fallbackAgents(fallbackIDs),
          models: [],
          loading: false,
          error: 'Não consegui falar com o processo principal.'
        })
      })
    return () => {
      alive = false
    }
    // `fallbackIDs` é derivado do snapshot; comparar por conteúdo evita refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, fallbackIDs.join('|')])

  return state
}

function roomMembers(room: OfficeRoom, agents: readonly OfficeAgent[]): OfficeAgent[] {
  const byID = new Map(agents.map((agent) => [agent.sessionID, agent]))
  return room.agentIDs
    .map((sessionID) => byID.get(sessionID))
    .filter((agent): agent is OfficeAgent => Boolean(agent))
}

function pendingCount(agents: readonly OfficeAgent[]): number {
  return agents.filter((agent) => agent.rolePending).length
}

export function OfficeDepartments({
  snapshot,
  onChanged,
  onOpenRoom
}: OfficeDepartmentsProps): JSX.Element {
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <section
      aria-label="Salas"
      data-testid="office-departments"
      className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          <Users size={11} aria-hidden="true" />
          Salas
        </h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCreateOpen(true)}
          data-testid="office-department-create"
        >
          <Plus size={12} aria-hidden="true" />
          Nova sala
        </Button>
      </header>

      {snapshot.rooms.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] text-ink-tertiary">
          Nenhuma sala ainda. Crie uma para agrupar funcionários com a mesma função.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {snapshot.rooms.map((room) => {
            const members = roomMembers(room, snapshot.agents)
            const pending = pendingCount(members)
            return (
              <li
                key={room.id}
                data-testid="office-department-row"
                data-room-id={room.id}
                className="flex items-center gap-2 px-2.5 py-1.5"
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-ink-primary">
                    {room.name}
                  </span>
                  <span className="block truncate text-[10px] text-ink-tertiary">
                    {room.unassigned ? 'sem função definida' : `função ${room.agent ?? '—'}`} ·{' '}
                    {members.length} {members.length === 1 ? 'funcionário' : 'funcionários'}
                  </span>
                </span>
                {pending > 0 && <Badge tone="warning">{pending} pendente(s)</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenRoom(room.id)}
                  aria-label={`Abrir sala ${room.name}`}
                  data-testid="office-department-open"
                >
                  Abrir
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      {createOpen && (
        <CreateRoomDialog
          snapshot={snapshot}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

interface CreateRoomDialogProps {
  snapshot: OfficeSnapshot
  onClose: () => void
  onCreated: () => void
}

function CreateRoomDialog({ snapshot, onClose, onCreated }: CreateRoomDialogProps): JSX.Element {
  const directory = (snapshot.agents.find((agent) => agent.directory)?.directory ?? '').trim()
  const roles = useRoleOptions(
    directory,
    snapshot.agents.map((agent) => agent.agent)
  )
  const [name, setName] = useState('')
  const [agentID, setAgentID] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedAgentID = agentID || roles.agents[0]?.id || ''
  const canSubmit = !submitting && name.trim().length > 0 && selectedAgentID.length > 0

  function submit(): void {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    void window.api
      .officeDepartmentCreate({ name: name.trim(), agentID: selectedAgentID })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui criar a sala.')
          return
        }
        onCreated()
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSubmitting(false))
  }

  return (
    <Modal
      title="Nova sala"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="office-department-submit"
          >
            {submitting ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={13} aria-hidden="true" />
            )}
            Criar sala
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="office-department-dialog">
        <p className="text-[12px] leading-5 text-ink-secondary">
          A sala agrupa funcionários com a mesma função. A função é aplicada no OpenCode com
          confirmação e quem estiver trabalhando fica pendente.
        </p>

        <div>
          <label
            htmlFor="office-department-name"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Nome da sala
          </label>
          <Input
            id="office-department-name"
            data-testid="office-department-name"
            className="mt-1.5"
            value={name}
            maxLength={24}
            placeholder="Ex.: Gerentes"
            onChange={(event) => setName(event.target.value)}
          />
          <p className="mt-1 text-[10px] text-ink-tertiary">{name.length}/24 caracteres</p>
        </div>

        <div>
          <label
            htmlFor="office-department-agent"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Função da sala
          </label>
          <Select
            id="office-department-agent"
            data-testid="office-department-agent"
            className="mt-1.5"
            value={selectedAgentID}
            disabled={roles.loading || roles.agents.length === 0}
            onChange={(event) => setAgentID(event.target.value)}
          >
            {roles.agents.length === 0 && <option value="">Nenhuma função disponível</option>}
            {roles.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
          {roles.loading && (
            <p className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-tertiary">
              <Loader2 size={10} className="animate-spin" aria-hidden="true" />
              consultando funções…
            </p>
          )}
          {roles.error && (
            <p className="mt-1 flex items-start gap-1.5 text-[10px] leading-snug text-danger">
              <CircleAlert size={10} className="mt-px shrink-0" aria-hidden="true" />
              {roles.error}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

export interface RoomDialogProps {
  room: OfficeRoom
  agents: readonly OfficeAgent[]
  onClose: () => void
  onChanged: () => void
}

/**
 * Configurações de UMA sala. Aberto pelo chip/piso no canvas, pela lista de
 * salas ou pela sidebar; o mesmo modal serve todas as vias.
 */
export function RoomDialog({ room, agents, onClose, onChanged }: RoomDialogProps): JSX.Element {
  const members = useMemo(() => roomMembers(room, agents), [room, agents])
  const directory = (
    room.path ??
    members.find((agent) => agent.directory)?.directory ??
    agents.find((agent) => agent.directory)?.directory ??
    ''
  ).trim()
  const roles = useRoleOptions(
    directory,
    agents.map((agent) => agent.agent)
  )

  const [name, setName] = useState(room.name)
  const [agentID, setAgentID] = useState(room.agent ?? '')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDesignate, setConfirmDesignate] = useState(false)
  const [designateID, setDesignateID] = useState('')
  const [designateApply, setDesignateApply] = useState(true)

  const selectedAgentID = agentID || roles.agents[0]?.id || ''
  const memberIDs = new Set(room.agentIDs)
  const candidates = agents.filter((agent) => !memberIDs.has(agent.sessionID))
  const canSave =
    !room.unassigned && !saving && name.trim().length > 0 && selectedAgentID.length > 0
  const canDesignate = !room.unassigned && designateID.length > 0 && !saving

  /** Persiste a função antes de uma ação que a aplica no OpenCode. */
  async function persistRole(): Promise<string | null> {
    if (!selectedAgentID || selectedAgentID === (room.agent ?? '')) return null
    try {
      const result = await window.api.officeDepartmentUpdate({
        id: room.id,
        agentID: selectedAgentID
      })
      return result.ok ? null : (result.error ?? 'Não consegui salvar a função da sala.')
    } catch {
      return 'Não consegui falar com o processo principal.'
    }
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string): void {
    setSaving(true)
    setError(null)
    setNotice(null)
    void action()
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui concluir a operação.')
          return
        }
        setNotice(success)
        onChanged()
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  function saveRoom(): void {
    if (!canSave) return
    run(
      () =>
        window.api.officeDepartmentUpdate({
          id: room.id,
          name: name.trim(),
          agentID: selectedAgentID
        }),
      'Sala atualizada. Use "Aplicar função" para enviar a função ao OpenCode.'
    )
  }

  function applyAll(): void {
    setConfirmApply(false)
    setSaving(true)
    setError(null)
    setNotice(null)
    void (async () => {
      const roleError = await persistRole()
      if (roleError) {
        setError(roleError)
        return
      }
      const result: OfficeDepartmentApplyResult = await window.api.officeDepartmentApplyRole({
        id: room.id
      })
      if (!result.ok) {
        setError(result.error ?? 'Não consegui aplicar a função.')
        return
      }
      setNotice(
        `${result.applied} função(ões) aplicada(s)` +
          (result.pending > 0 ? ` · ${result.pending} pendente(s) (trabalhando).` : '.')
      )
      onChanged()
    })()
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  function designate(): void {
    if (!canDesignate) return
    setConfirmDesignate(false)
    setSaving(true)
    setError(null)
    setNotice(null)
    void (async () => {
      const roleError = await persistRole()
      if (roleError) {
        setError(roleError)
        return
      }
      const result = await window.api.officeDepartmentAssign({
        sessionID: designateID,
        departmentID: room.id,
        applyRole: designateApply
      })
      if (!result.ok) {
        setError(result.error ?? 'Não consegui designar o funcionário.')
        return
      }
      setNotice(
        designateApply
          ? 'Funcionário designado; a função foi aplicada (ou ficou pendente se estiver trabalhando).'
          : 'Funcionário designado. A função será aplicada quando você pedir.'
      )
      onChanged()
    })()
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  function exclude(): void {
    setConfirmDelete(false)
    setSaving(true)
    setError(null)
    void window.api
      .officeDepartmentDelete({ id: room.id })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui excluir a sala.')
          return
        }
        onChanged()
        onClose()
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  return (
    <Modal
      title={room.unassigned ? 'Sem sala' : `Sala: ${room.name}`}
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          {!room.unassigned && (
            <Button
              variant="subtle-danger"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
              data-testid="office-room-delete"
            >
              <Trash2 size={13} aria-hidden="true" />
              Excluir sala
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Fechar
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="office-room-dialog" data-room-id={room.id}>
        {room.unassigned ? (
          <p className="text-[12px] leading-5 text-ink-secondary">
            Estes funcionários ainda não foram designados. Abra uma sala e use{' '}
            <strong className="text-ink-primary">Designar funcionário</strong> para levá-los.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`room-name-${room.id}`}
                className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
              >
                Nome da sala
              </label>
              <Input
                id={`room-name-${room.id}`}
                data-testid="office-room-name"
                className="mt-1.5"
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor={`room-agent-${room.id}`}
                className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
              >
                Função da sala
              </label>
              <Select
                id={`room-agent-${room.id}`}
                data-testid="office-room-agent"
                className="mt-1.5"
                value={selectedAgentID}
                disabled={roles.loading || roles.agents.length === 0}
                onChange={(event) => setAgentID(event.target.value)}
              >
                {roles.agents.length === 0 && <option value="">Nenhuma função disponível</option>}
                {roles.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {!room.unassigned && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={saveRoom}
              disabled={!canSave}
              data-testid="office-room-save"
            >
              {saving ? (
                <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Check size={12} aria-hidden="true" />
              )}
              Salvar sala
            </Button>

            <Button
              size="sm"
              variant="primary"
              onClick={() => setConfirmApply(true)}
              disabled={saving || members.length === 0 || roles.loading}
              data-testid="office-room-apply-all"
            >
              <Wand2 size={12} aria-hidden="true" />
              Aplicar função a todos
            </Button>

            {confirmApply && (
              <span className="flex flex-wrap items-center gap-1.5 rounded-control border border-accent-border bg-accent-muted px-2 py-1 text-[10.5px] text-ink-primary">
                Aplicar a função <strong>{selectedAgentID}</strong> em {members.length}{' '}
                funcionário(s)?
                <Button
                  size="sm"
                  variant="primary"
                  onClick={applyAll}
                  data-testid="office-room-apply-confirm"
                >
                  Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmApply(false)}>
                  Cancelar
                </Button>
              </span>
            )}
          </div>
        )}

        <div aria-live="polite" className="min-h-[16px]">
          {notice && (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-success">
              <Check size={12} className="mt-px shrink-0" aria-hidden="true" />
              {notice}
            </p>
          )}
          {error && (
            <p
              data-testid="office-room-error"
              className="flex items-start gap-1.5 text-[11px] leading-snug text-danger"
            >
              <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
          {roles.loading && (
            <p className="flex items-center gap-1.5 text-[10px] text-ink-tertiary">
              <Loader2 size={10} className="animate-spin" aria-hidden="true" />
              consultando funções…
            </p>
          )}
        </div>

        <section aria-label="Funcionários da sala" className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
              Funcionários ({members.length})
            </h3>
            {directory && (
              <span
                className="max-w-[220px] truncate text-[9.5px] text-ink-tertiary"
                title={directory}
              >
                {directory}
              </span>
            )}
          </div>

          {members.length === 0 ? (
            <p className="text-[11.5px] text-ink-tertiary">Nenhum funcionário nesta sala.</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)] rounded-control border border-[var(--border-subtle)]">
              {members.map((agent) => {
                const memberStatus = STATUS_META[agent.status]
                return (
                  <li
                    key={agent.sessionID}
                    data-testid="office-room-member"
                    data-session-id={agent.sessionID}
                    className="flex flex-wrap items-center gap-2 px-2.5 py-1.5"
                  >
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 shrink-0 rounded-pill ${memberStatus.dot}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-ink-primary">
                        {agent.name}
                      </span>
                      <span className="block truncate text-[10px] text-ink-tertiary">
                        {agent.agent} · {memberStatus.label}
                      </span>
                    </span>

                    {agent.rolePending && (
                      <Badge tone="warning" data-testid="office-room-pending">
                        pendente: {agent.rolePending}
                      </Badge>
                    )}

                    {agent.rolePending && !room.unassigned && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          run(
                            () =>
                              window.api.officeDepartmentAssign({
                                sessionID: agent.sessionID,
                                departmentID: room.id,
                                applyRole: true
                              }),
                            agent.status === 'working'
                              ? 'Sessão trabalhando — a função continua pendente.'
                              : 'Função aplicada nesta sessão.'
                          )
                        }
                        disabled={saving}
                        data-testid="office-room-apply-one"
                      >
                        Aplicar agora
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remover ${agent.name} da sala`}
                      onClick={() =>
                        run(
                          () => window.api.officeDepartmentUnassign({ sessionID: agent.sessionID }),
                          'Funcionário devolvido para "Sem sala".'
                        )
                      }
                      disabled={saving}
                      data-testid="office-room-unassign"
                    >
                      <UserMinus size={12} aria-hidden="true" />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {!room.unassigned && (
          <section aria-label="Designar funcionário" className="space-y-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
              Designar funcionário
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Select
                data-testid="office-room-designate-select"
                aria-label="Funcionário para designar"
                className="!w-auto min-w-[180px] flex-1 !py-1.5 text-[12px]"
                value={designateID}
                onChange={(event) => {
                  setDesignateID(event.target.value)
                  setConfirmDesignate(false)
                }}
                disabled={saving || candidates.length === 0}
              >
                <option value="">
                  {candidates.length === 0 ? 'Nenhum funcionário fora da sala' : 'Escolher…'}
                </option>
                {candidates.map((agent) => (
                  <option key={agent.sessionID} value={agent.sessionID}>
                    {agent.name} — {agent.agent}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-[10.5px] text-ink-secondary">
                <input
                  type="checkbox"
                  checked={designateApply}
                  onChange={(event) => setDesignateApply(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                aplicar função
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmDesignate(true)}
                disabled={!canDesignate}
                data-testid="office-room-designate"
              >
                <UserPlus size={12} aria-hidden="true" />
                Designar
              </Button>
            </div>

            {confirmDesignate && (
              <div className="flex flex-wrap items-center gap-1.5 rounded-control border border-accent-border bg-accent-muted px-2 py-1.5 text-[10.5px] text-ink-primary">
                <ArrowRightLeft size={12} aria-hidden="true" />
                Designar{' '}
                {agents.find((agent) => agent.sessionID === designateID)?.name ?? 'funcionário'}
                {designateApply ? ` e aplicar a função ${selectedAgentID}` : ' sem aplicar função'}?
                <Button
                  size="sm"
                  variant="primary"
                  onClick={designate}
                  data-testid="office-room-designate-confirm"
                >
                  Confirmar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDesignate(false)}>
                  Cancelar
                </Button>
              </div>
            )}
          </section>
        )}

        {confirmDelete && !room.unassigned && (
          <div className="rounded-control border border-danger-border bg-danger-bg px-2.5 py-2">
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-danger">
              <DoorOpen size={12} className="mt-px shrink-0" aria-hidden="true" />
              Excluir a sala devolve {members.length} funcionário(s) para "Sem sala". Nenhuma sessão
              é apagada do OpenCode.
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                variant="danger"
                onClick={exclude}
                data-testid="office-room-delete-confirm"
              >
                Excluir sala
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
