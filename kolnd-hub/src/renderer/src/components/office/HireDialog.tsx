import { useEffect, useState } from 'react'
import { CircleAlert, Loader2, UserPlus } from 'lucide-react'
import type { OfficeAgentOption, OfficeModelOption, OfficeRoom } from '../../../../shared/office'
import { Button, Input, Modal, Select } from '../ui'

/**
 * Contratar um funcionário = criar uma sessão real do OpenCode, sem prompt,
 * numa sala que já existe no snapshot. A função é o agente; o modelo é
 * opcional (vazio = padrão da função). O main valida tudo de novo — aqui só
 * montamos o pedido e mostramos o erro legível que ele devolver.
 */

const TITLE_MAX = 80

function modelKey(model: OfficeModelOption): string {
  return `${model.providerID}/${model.id}`
}

export interface HireDialogProps {
  rooms: readonly OfficeRoom[]
  onClose: () => void
  /** Chamado após a criação; o pai fecha e atualiza o snapshot. */
  onHired: () => void
}

export function HireDialog({ rooms, onClose, onHired }: HireDialogProps): JSX.Element {
  const hireableRooms = rooms.filter((room) => (room.path ?? '').trim().length > 0)
  const [roomID, setRoomID] = useState(() => hireableRooms[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [agentID, setAgentID] = useState('')
  const [modelKeyValue, setModelKeyValue] = useState('')
  const [agents, setAgents] = useState<OfficeAgentOption[]>([])
  const [models, setModels] = useState<OfficeModelOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(hireableRooms.length > 0)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const room = hireableRooms.find((item) => item.id === roomID) ?? null
  const roomPath = (room?.path ?? '').trim()
  const optionsError = room
    ? fetchError
    : hireableRooms.length === 0
      ? 'Nenhuma sala disponível. Abra uma sessão no OpenCode para criar uma sala.'
      : 'Escolha uma sala com pasta válida.'

  useEffect(() => {
    if (!roomPath) return

    let alive = true
    window.api
      .officeRosterOptions({ directory: roomPath })
      .then((result) => {
        if (!alive) return
        if (!result.ok) {
          setAgents([])
          setModels([])
          setFetchError(result.error ?? 'Não consegui consultar as funções desta sala.')
          return
        }
        setFetchError(null)
        setAgents(result.agents)
        setModels(result.models)
        setAgentID(result.agents[0]?.id ?? '')
      })
      .catch(() => {
        if (!alive) return
        setAgents([])
        setModels([])
        setFetchError('Não consegui falar com o processo principal.')
      })
      .finally(() => {
        if (alive) setLoadingOptions(false)
      })

    return () => {
      alive = false
    }
  }, [roomPath])

  function changeRoom(nextRoomID: string): void {
    setRoomID(nextRoomID)
    setAgents([])
    setModels([])
    setAgentID('')
    setModelKeyValue('')
    setFetchError(null)
    setLoadingOptions(true)
  }

  const enableModels = models.filter((model) => model.enabled)
  const titleInvalid = title.length > 0 && title.trim().length === 0
  const canSubmit =
    !submitting &&
    !loadingOptions &&
    Boolean(room) &&
    title.trim().length > 0 &&
    title.trim().length <= TITLE_MAX &&
    agentID.length > 0 &&
    agents.length > 0

  function submit(): void {
    if (!room || !canSubmit) return
    const chosenModel = enableModels.find((model) => modelKey(model) === modelKeyValue) ?? null
    setSubmitting(true)
    setSubmitError(null)

    void window.api
      .officeHire({
        title: title.trim(),
        agentID,
        model: chosenModel,
        directory: (room.path ?? '').trim()
      })
      .then((result) => {
        if (!result.ok) {
          setSubmitError(result.error ?? 'Não consegui contratar o funcionário.')
          return
        }
        onHired()
      })
      .catch(() => setSubmitError('Não consegui falar com o processo principal.'))
      .finally(() => setSubmitting(false))
  }

  return (
    <Modal
      title="Contratar funcionário"
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
            data-testid="office-hire-submit"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus size={14} aria-hidden="true" />
            )}
            Contratar
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="office-hire-dialog">
        <p className="text-[12px] leading-5 text-ink-secondary">
          O funcionário é uma sessão real do OpenCode. Nada é enviado ao modelo: a sessão nasce
          vazia, pronta para receber trabalho.
        </p>

        <div>
          <label
            htmlFor="office-hire-title"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Nome
          </label>
          <Input
            id="office-hire-title"
            data-testid="office-hire-title"
            className="mt-1.5"
            value={title}
            maxLength={TITLE_MAX}
            placeholder="Ex.: Revisar contrato de pagamento"
            onChange={(event) => setTitle(event.target.value)}
            error={titleInvalid}
            errorMessage={titleInvalid ? 'Informe um nome para o funcionário.' : undefined}
          />
          <p className="mt-1 text-[10px] text-ink-tertiary">
            {title.length}/{TITLE_MAX} caracteres
          </p>
        </div>

        <div>
          <label
            htmlFor="office-hire-room"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Sala
          </label>
          <Select
            id="office-hire-room"
            data-testid="office-hire-room"
            className="mt-1.5"
            value={roomID}
            onChange={(event) => changeRoom(event.target.value)}
            disabled={submitting || hireableRooms.length === 0}
          >
            {hireableRooms.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} — {option.path}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor="office-hire-agent"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Função
          </label>
          <Select
            id="office-hire-agent"
            data-testid="office-hire-agent"
            className="mt-1.5"
            value={agentID}
            onChange={(event) => setAgentID(event.target.value)}
            disabled={submitting || loadingOptions || agents.length === 0}
          >
            {agents.length === 0 && <option value="">Nenhuma função disponível</option>}
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.description ? ` — ${agent.description}` : ''}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor="office-hire-model"
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary"
          >
            Modelo
          </label>
          <Select
            id="office-hire-model"
            data-testid="office-hire-model"
            className="mt-1.5"
            value={modelKeyValue}
            onChange={(event) => setModelKeyValue(event.target.value)}
            disabled={submitting || loadingOptions}
          >
            <option value="">Padrão da função</option>
            {enableModels.map((model) => (
              <option key={modelKey(model)} value={modelKey(model)}>
                {model.name} ({model.providerID})
              </option>
            ))}
          </Select>
        </div>

        {loadingOptions && (
          <p role="status" className="flex items-center gap-2 text-[11px] text-ink-secondary">
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
            Consultando as funções da sala…
          </p>
        )}

        {optionsError && (
          <p
            role="alert"
            data-testid="office-hire-options-error"
            className="flex items-start gap-1.5 rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
          >
            <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
            {optionsError}
          </p>
        )}

        {submitError && (
          <p
            role="alert"
            data-testid="office-hire-error"
            className="flex items-start gap-1.5 rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
          >
            <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
            {submitError}
          </p>
        )}
      </div>
    </Modal>
  )
}
