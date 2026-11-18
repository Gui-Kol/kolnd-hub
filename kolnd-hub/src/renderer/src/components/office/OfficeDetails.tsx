import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, Ref } from 'react'
import {
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Coins,
  Cpu,
  FolderOpen,
  Hash,
  Info,
  Loader2,
  MessageSquare,
  MousePointerClick,
  Send,
  ShieldCheck,
  Timer,
  X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OfficeAgent, OfficePermissionRequest, OfficeRoom } from '../../../../shared/office'
import { truncateLabel } from '../../../../shared/office'
import { Badge, Button } from '../ui'
import {
  ACTIVITY_META,
  STATUS_META,
  activityLabel,
  formatClock,
  formatCost,
  formatDuration,
  formatTokens
} from './format'

/**
 * Detalhes do agente selecionado — agora com as AÇÕES da Fase 3.
 *
 * Fronteira de segurança: esta tela só monta pedidos (`sessionID` +
 * `requestID` + decisão). O main valida tudo de novo (AGENTS.md) e o modo
 * somente leitura é decidido lá; aqui a chave é apenas o portão visual. O texto
 * da mensagem nunca é persistido nem logado — ao ser entregue, ele sai também
 * do estado do componente.
 */

/** Teto do prompt (mesmo `ACTION_TEXT_MAX` do main — validado dos dois lados). */
const MESSAGE_MAX = 2000
/** Motivo da negação (mesmo `ACTION_MESSAGE_MAX` do main). */
const DENY_REASON_MAX = 500
/** A ponte descarta a ação em 30 s; a UI reflete o mesmo prazo. */
const REQUEST_EXPIRY_MS = 30_000
/** Recorte visual do recurso: o pedido já chega mascarado/truncado em 200. */
const RESOURCE_DISPLAY_MAX = 80

type RequestStatus = 'enviando' | 'ok' | 'erro' | 'expirado' | 'dispensado'
type PermissionDecision = 'once' | 'always' | 'reject'

interface RequestUiState {
  status: RequestStatus
  decision?: PermissionDecision
  actionID?: string
  error?: string
}

type SendStatus = 'idle' | 'fila' | 'entregue' | 'falhou'

interface SendUiState {
  status: SendStatus
  actionID?: string
  error?: string
}

export interface OfficeDetailsProps {
  agent: OfficeAgent | null
  room: OfficeRoom | null
  /** Epoch de referência (padrão: `lastSeenAt` do próprio agente — puro). */
  now?: number
  /** Pedidos pendentes da sessão selecionada (já filtrados pelo pai). */
  requests?: readonly OfficePermissionRequest[]
  /** Chave de ações do cabeçalho, já combinada com `pluginConnected`. */
  actionsEnabled?: boolean
  /** O plugin de tempo real está falando com a ponte. */
  pluginConnected?: boolean
}

function Field({
  icon: Icon,
  label,
  children
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="min-w-0">
      <span className="flex items-center gap-1 text-[9.5px] uppercase tracking-[0.1em] text-ink-tertiary">
        <Icon size={10} aria-hidden="true" />
        {label}
      </span>
      <div className="mt-0.5 min-w-0 text-[12px] text-ink-primary">{children}</div>
    </div>
  )
}

/** Nome da ação em pt-BR (o OpenCode manda o nome cru da ferramenta). */
function permissionActionLabel(action: string): string {
  const key = action.trim().toLowerCase()
  switch (key) {
    case 'shell':
    case 'bash':
    case 'command':
      return 'Executar comando'
    case 'edit':
    case 'write':
    case 'apply_patch':
      return 'Editar arquivo'
    case 'read':
    case 'glob':
      return 'Ler arquivo'
    case 'grep':
    case 'search':
      return 'Buscar no projeto'
    case 'webfetch':
    case 'websearch':
    case 'http':
      return 'Acessar a web'
    default:
      return action.trim() ? `Permissão: ${action.trim()}` : 'Permissão'
  }
}

/** Motivo de recusa do main em pt-BR (nunca vaza payload). */
function refusalLabel(reason: string): string {
  switch (reason) {
    case 'somente-leitura':
      return 'Ações estão em somente leitura — ligue a chave no topo.'
    case 'limite':
      return 'Muitas ações nesta sessão — espere um minuto.'
    case 'texto-longo':
      return `Texto longo demais (máx. ${MESSAGE_MAX.toLocaleString('pt-BR')}).`
    case 'fila-cheia':
      return 'A fila de ações do Escritório está cheia.'
    case 'invalido':
      return 'O pedido não é mais válido — responda no terminal.'
    default:
      return 'Não consegui enviar a ação.'
  }
}

function resourceText(resource: string): string {
  return truncateLabel(resource, RESOURCE_DISPLAY_MAX)
}

interface PermissionCardProps {
  request: OfficePermissionRequest
  state?: RequestUiState
  actionsEnabled: boolean
  pluginConnected: boolean
  cardRef?: Ref<HTMLDivElement>
  onApprove: (request: OfficePermissionRequest, decision: 'once' | 'always') => void
  onDeny: (request: OfficePermissionRequest, reason?: string) => void
  onDismiss: (request: OfficePermissionRequest) => void
}

/** Card "Precisa de você" de UM pedido: aprovar, aprovar sempre, negar, dispensar. */
function PermissionCard({
  request,
  state,
  actionsEnabled,
  pluginConnected,
  cardRef,
  onApprove,
  onDeny,
  onDismiss
}: PermissionCardProps): JSX.Element {
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [denyOpen, setDenyOpen] = useState(false)
  const [denyReason, setDenyReason] = useState('')

  const status = state?.status
  const busy = status === 'enviando'
  const resolved = status === 'ok' || status === 'dispensado'
  const expired = status === 'expirado'
  const canAct = actionsEnabled && pluginConnected && !busy && !resolved && !expired

  const rules = request.save.slice(0, 2)
  const extraRules = request.save.length - rules.length

  function handleApproveAlways(): void {
    if (!confirmAlways) {
      setConfirmAlways(true)
      return
    }
    setConfirmAlways(false)
    onApprove(request, 'always')
  }

  function handleDeny(): void {
    if (!denyOpen) {
      setDenyOpen(true)
      return
    }
    onDeny(request, denyReason.trim() || undefined)
    setDenyOpen(false)
    setDenyReason('')
  }

  return (
    // Esc dispensa o pedido: atalho do card focável (tabIndex -1) do painel.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={cardRef}
      tabIndex={-1}
      role="group"
      aria-label={`Pedido: ${permissionActionLabel(request.action)}`}
      data-testid="office-request"
      data-request-id={request.id}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onDismiss(request)
        }
      }}
      className="rounded-control border border-warn-border bg-warn-bg p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-warn-bg text-warn"
        >
          <ShieldCheck size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-warn">Precisa de você</p>
          <p className="truncate text-[12px] font-medium text-ink-primary">
            {permissionActionLabel(request.action)}
          </p>
        </div>
        <span className="tnum shrink-0 text-[10px] text-ink-tertiary">
          {formatClock(request.at)}
        </span>
      </div>

      {request.resources.length > 0 && (
        <ul className="mt-2 space-y-1" aria-label="Recursos do pedido">
          {request.resources.map((resource, index) => (
            <li key={`${request.id}-${index}`}>
              <code className="block rounded-sm bg-surface-sunken px-2 py-1 font-mono text-[10.5px] leading-snug text-ink-secondary">
                {resourceText(resource)}
              </code>
            </li>
          ))}
        </ul>
      )}

      {request.message && (
        <p className="mt-2 line-clamp-3 text-[10.5px] leading-snug text-ink-secondary">
          {request.message}
        </p>
      )}

      <div aria-live="polite" className="mt-2">
        {status === 'enviando' && (
          <p className="flex items-center gap-1.5 text-[10.5px] text-ink-secondary">
            <Loader2 size={11} className="animate-spin" aria-hidden="true" />
            enviando…
          </p>
        )}
        {status === 'ok' && (
          <p className="flex items-center gap-1.5 text-[10.5px] font-medium text-success">
            <Check size={12} aria-hidden="true" />
            {state?.decision === 'reject' ? 'Negado' : 'Aprovado'}
          </p>
        )}
        {status === 'erro' && (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-danger">
            <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
            {state?.error ?? 'A ação falhou no OpenCode.'}
          </p>
        )}
        {status === 'expirado' && (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-warn">
            <Timer size={12} className="mt-px shrink-0" aria-hidden="true" />
            expirou — responda no terminal
          </p>
        )}
        {status === 'dispensado' && (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-snug text-ink-secondary">
            <TerminalNote />
            Pedido dispensado — responda no terminal do OpenCode.
          </p>
        )}
      </div>

      {confirmAlways && canAct && request.save.length > 0 && (
        <div className="mt-2 rounded-control border border-warn-border bg-surface-1 px-2 py-1.5">
          <p className="text-[10.5px] leading-snug text-ink-secondary">
            Isso grava a regra <code className="font-mono text-ink-primary">{rules[0]}</code>
            {extraRules > 0 ? ` (+${extraRules})` : ''} no projeto.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="primary"
              data-testid="office-request-approve-always-confirm"
              onClick={handleApproveAlways}
            >
              Confirmar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAlways(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {denyOpen && canAct && (
        <div className="mt-2">
          <label
            htmlFor={`office-deny-${request.id}`}
            className="block text-[10px] uppercase tracking-[0.08em] text-ink-tertiary"
          >
            Motivo da negação (opcional)
          </label>
          <textarea
            id={`office-deny-${request.id}`}
            value={denyReason}
            onChange={(event) => setDenyReason(event.target.value.slice(0, DENY_REASON_MAX))}
            rows={2}
            maxLength={DENY_REASON_MAX}
            placeholder="Explique ao agente por que não pode…"
            className="mt-1 w-full rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-primary placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="tnum text-[9.5px] text-ink-tertiary">
              {denyReason.length}/{DENY_REASON_MAX}
            </span>
            <Button
              size="sm"
              variant="danger"
              data-testid="office-request-deny-confirm"
              onClick={handleDeny}
            >
              Negar pedido
            </Button>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="primary"
          data-testid="office-request-approve"
          disabled={!canAct}
          onClick={() => onApprove(request, 'once')}
        >
          <Check size={12} aria-hidden="true" />
          Aprovar
        </Button>

        {request.save.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            data-testid="office-request-approve-always"
            disabled={!canAct}
            onClick={handleApproveAlways}
          >
            Aprovar sempre
          </Button>
        )}

        <Button
          size="sm"
          variant="subtle-danger"
          data-testid="office-request-deny"
          disabled={!canAct}
          onClick={handleDeny}
        >
          <X size={12} aria-hidden="true" />
          Negar
        </Button>

        {status !== 'ok' && status !== 'dispensado' && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="office-request-dismiss"
            onClick={() => onDismiss(request)}
          >
            Responder no OpenCode
          </Button>
        )}
      </div>

      {status === 'expirado' && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDismiss(request)}
            data-testid="office-request-dismiss"
          >
            Dispensar
          </Button>
        </div>
      )}

      {!pluginConnected && (
        <p className="mt-2 text-[10px] leading-snug text-ink-tertiary">
          Instale o plugin em Configurações → OpenOffice para responder por aqui.
        </p>
      )}
      {pluginConnected && !actionsEnabled && (
        <p className="mt-2 text-[10px] leading-snug text-ink-tertiary">
          Ações em somente leitura — ligue a chave no topo para responder.
        </p>
      )}
    </div>
  )
}

/** Ícone textual usado no aviso "responda no terminal" (sem emoji). */
function TerminalNote(): JSX.Element {
  return <Info size={12} className="mt-px shrink-0" aria-hidden="true" />
}

export function OfficeDetails({
  agent,
  room,
  now,
  requests = [],
  actionsEnabled = false,
  pluginConnected = false
}: OfficeDetailsProps): JSX.Element {
  const [requestStates, setRequestStates] = useState<Record<string, RequestUiState>>({})
  const [sendState, setSendState] = useState<SendUiState>({ status: 'idle' })
  const [text, setText] = useState('')

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const messageActionID = useRef<string | null>(null)
  const firstCardRef = useRef<HTMLDivElement | null>(null)
  const seenRequests = useRef(new Set<string>())

  const clearExpiry = useCallback((requestID: string) => {
    const timer = timers.current.get(requestID)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(requestID)
    }
  }, [])

  const startExpiry = useCallback(
    (requestID: string) => {
      clearExpiry(requestID)
      const timer = setTimeout(() => {
        timers.current.delete(requestID)
        setRequestStates((current) => {
          const entry = current[requestID]
          if (!entry || entry.status !== 'enviando') return current
          return { ...current, [requestID]: { ...entry, status: 'expirado' } }
        })
      }, REQUEST_EXPIRY_MS)
      timers.current.set(requestID, timer)
    },
    [clearExpiry]
  )

  // Resultado vindo do main (`office:action-result`): casa pelo id da fila.
  useEffect(() => {
    const active = timers.current
    const cleanup = window.api.onOfficeActionResult((result) => {
      setRequestStates((current) => {
        let changed = false
        const next = { ...current }
        for (const [requestID, entry] of Object.entries(current)) {
          if (entry.actionID !== result.id) continue
          clearExpiry(requestID)
          next[requestID] = {
            ...entry,
            status: result.ok ? 'ok' : 'erro',
            ...(result.ok ? {} : { error: result.error ?? 'A ação falhou no OpenCode.' })
          }
          changed = true
        }
        return changed ? next : current
      })

      if (messageActionID.current === result.id) {
        messageActionID.current = null
        if (result.ok) {
          // Privacidade (D10): entregue ⇒ o texto sai também do estado da UI.
          setText('')
          setSendState({ status: 'entregue' })
        } else {
          setSendState({ status: 'falhou', error: result.error ?? 'A entrega falhou.' })
        }
      }
    })

    return () => {
      cleanup()
      for (const timer of active.values()) clearTimeout(timer)
      active.clear()
    }
  }, [clearExpiry])

  // Novo pedido: leva o foco ao card mais recente (o `aria-live` abaixo anuncia).
  useEffect(() => {
    const newest = requests[0]
    if (!newest || seenRequests.current.has(newest.id)) return
    seenRequests.current.add(newest.id)
    firstCardRef.current?.focus()
  }, [requests])

  function submitPermission(
    request: OfficePermissionRequest,
    decision: 'once' | 'always' | 'reject',
    reason?: string
  ): void {
    setRequestStates((current) => ({
      ...current,
      [request.id]: { status: 'enviando', decision }
    }))
    startExpiry(request.id)

    const call =
      decision === 'reject'
        ? window.api.officeDenyPermission({
            sessionID: request.sessionID,
            requestID: request.id,
            ...(reason ? { message: reason } : {})
          })
        : window.api.officeApprovePermission({
            sessionID: request.sessionID,
            requestID: request.id,
            decision,
            ...(reason ? { message: reason } : {})
          })

    void call
      .then((result) => {
        if (!result.ok) {
          clearExpiry(request.id)
          setRequestStates((current) => ({
            ...current,
            [request.id]: {
              status: 'erro',
              decision,
              error: refusalLabel(result.reason)
            }
          }))
          return
        }
        setRequestStates((current) => {
          const entry = current[request.id]
          if (!entry || entry.status !== 'enviando') return current
          return { ...current, [request.id]: { ...entry, actionID: result.id } }
        })
      })
      .catch(() => {
        clearExpiry(request.id)
        setRequestStates((current) => ({
          ...current,
          [request.id]: {
            status: 'erro',
            decision,
            error: 'Não consegui falar com o processo principal.'
          }
        }))
      })
  }

  function dismissRequest(request: OfficePermissionRequest): void {
    clearExpiry(request.id)
    setRequestStates((current) => ({
      ...current,
      [request.id]: { status: 'dispensado' }
    }))
  }

  function sendMessage(): void {
    if (!agent || !actionsEnabled || !pluginConnected) return
    const value = text.trim()
    if (!value || sendState.status === 'fila') return

    setSendState({ status: 'fila' })
    void window.api
      .officeSendMessage({ sessionID: agent.sessionID, text: value })
      .then((result) => {
        if (!result.ok) {
          setSendState({ status: 'falhou', error: refusalLabel(result.reason) })
          return
        }
        messageActionID.current = result.id
        setSendState({ status: 'fila', actionID: result.id })
      })
      .catch(() => {
        setSendState({
          status: 'falhou',
          error: 'Não consegui falar com o processo principal.'
        })
      })
  }

  function handleMessageKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  if (!agent) {
    return (
      <section
        aria-label="Detalhes do agente"
        className="rounded-card border border-[var(--border-subtle)] bg-surface-1"
        data-testid="office-details"
      >
        <header className="border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
            Detalhes
          </h3>
        </header>
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <MousePointerClick size={20} className="text-ink-tertiary" aria-hidden="true" />
          <p className="text-[12px] text-ink-secondary">
            Selecione um personagem no escritório ou na lista de salas.
          </p>
          <p className="text-[10.5px] text-ink-tertiary">
            Os detalhes mostram sessão, modelo, atividade, custo e tokens.
          </p>
        </div>
      </section>
    )
  }

  const status = STATUS_META[agent.status]
  const activity = ACTIVITY_META[agent.activity?.kind ?? 'other']
  // Sem relógio no render: usa o snapshot (ou o último contato) como referência.
  const reference = now ?? agent.lastSeenAt
  const canMessage =
    !agent.parentID && (agent.status === 'idle' || agent.status === 'working') && !requests.length
  const messageDisabled = !actionsEnabled || !pluginConnected || !canMessage
  const announcement = requests[0]
    ? `${requests.length} ${requests.length === 1 ? 'pedido' : 'pedidos'} aguardando você: ${permissionActionLabel(requests[0].action)}.`
    : ''

  return (
    <section
      aria-label={`Detalhes de ${agent.name}`}
      className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1"
      data-testid="office-details"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] bg-surface-2 px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
          Detalhes
        </h3>
        <span className={`flex items-center gap-1.5 text-[10px] font-medium ${status.text}`}>
          <span aria-hidden="true" className={`h-2 w-2 rounded-pill ${status.dot}`} />
          {status.label}
        </span>
      </header>

      <div className="space-y-3 p-3">
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>

        <div className="min-w-0">
          <h4 className="truncate text-[15px] font-semibold text-ink-primary">{agent.name}</h4>
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-secondary">
            {agent.title}
          </p>
          {agent.parentID && (
            <p className="mt-1 truncate text-[10px] text-ink-tertiary" title={agent.parentID}>
              Subagente de {agent.parentID}
            </p>
          )}
        </div>

        {requests.length > 0 && (
          <section aria-label="Precisa de você" className="space-y-2">
            <div className="flex items-center gap-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
                Precisa de você
              </h4>
              <Badge tone="warning">{requests.length}</Badge>
            </div>
            {requests.map((request, index) => (
              <PermissionCard
                key={request.id}
                request={request}
                state={requestStates[request.id]}
                actionsEnabled={actionsEnabled}
                pluginConnected={pluginConnected}
                cardRef={index === 0 ? firstCardRef : undefined}
                onApprove={(target, decision) => submitPermission(target, decision)}
                onDeny={(target, reason) => submitPermission(target, 'reject', reason)}
                onDismiss={dismissRequest}
              />
            ))}
          </section>
        )}

        <div className="rounded-control border border-[var(--border-subtle)] bg-surface-sunken px-2.5 py-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] ${activity.className}`}
            >
              {activity.label}
            </span>
            {agent.activity && (
              <span className="tnum text-[10px] text-ink-tertiary">
                {formatClock(agent.activity.at)}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-ink-secondary">
            {activityLabel(agent)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <Field icon={Bot} label="Agente">
            <span className="block truncate">{agent.agent}</span>
          </Field>
          <Field icon={FolderOpen} label="Sala">
            <span className="block truncate" title={room?.id ?? agent.roomID}>
              {room?.name ?? 'Sem projeto'}
            </span>
          </Field>
          <Field icon={Cpu} label="Modelo">
            <span className="block truncate" title={`${agent.model.providerID}/${agent.model.id}`}>
              {agent.model.id}
            </span>
            <span className="block truncate text-[10px] text-ink-tertiary">
              {agent.model.providerID}
            </span>
          </Field>
          <Field icon={Clock3} label="Desde o início">
            <span className="tnum block">{formatDuration(reference - agent.startedAt)}</span>
            <span className="tnum block text-[10px] text-ink-tertiary">
              {formatClock(agent.startedAt)}
            </span>
          </Field>
          <Field icon={Coins} label="Custo">
            <span className="tnum block">{formatCost(agent.cost)}</span>
          </Field>
          <Field icon={Hash} label="Tokens">
            <span className="tnum block">{formatTokens(agent.tokens.total)}</span>
            <span className="tnum block text-[10px] text-ink-tertiary">
              {formatTokens(agent.tokens.input)} in · {formatTokens(agent.tokens.output)} out
            </span>
          </Field>
        </div>

        {canMessage && (
          <section
            aria-label="Enviar mensagem"
            data-testid="office-message-box"
            className="rounded-control border border-[var(--border-subtle)] bg-surface-sunken p-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                <MessageSquare size={11} aria-hidden="true" />
                Enviar mensagem
              </span>
              {sendState.status === 'fila' && <Badge tone="neutral">na fila</Badge>}
              {sendState.status === 'entregue' && <Badge tone="success">entregue</Badge>}
              {sendState.status === 'falhou' && <Badge tone="danger">falhou</Badge>}
            </div>

            <label htmlFor="office-message" className="sr-only">
              Mensagem para {agent.name}
            </label>
            <textarea
              id="office-message"
              data-testid="office-message-input"
              value={text}
              rows={3}
              maxLength={MESSAGE_MAX}
              disabled={messageDisabled || sendState.status === 'fila'}
              onChange={(event) => {
                setText(event.target.value)
                if (sendState.status !== 'idle') setSendState({ status: 'idle' })
              }}
              onKeyDown={handleMessageKeyDown}
              placeholder="Escreva para o agente… (Enter envia, Shift+Enter quebra linha)"
              className="mt-1.5 w-full resize-y rounded-control border border-[var(--border-subtle)] bg-surface-1 px-2 py-1.5 font-mono text-[11px] leading-snug text-ink-primary placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />

            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="tnum text-[9.5px] text-ink-tertiary">
                {text.length}/{MESSAGE_MAX}
              </span>
              <Button
                size="sm"
                variant="primary"
                data-testid="office-message-send"
                disabled={
                  messageDisabled || sendState.status === 'fila' || text.trim().length === 0
                }
                onClick={sendMessage}
              >
                {sendState.status === 'fila' ? (
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send size={12} aria-hidden="true" />
                )}
                Enviar
              </Button>
            </div>

            <div aria-live="polite">
              {sendState.status === 'falhou' && (
                <p
                  data-testid="office-message-status"
                  className="mt-1 flex items-start gap-1.5 text-[10.5px] leading-snug text-danger"
                >
                  <CircleAlert size={12} className="mt-px shrink-0" aria-hidden="true" />
                  {sendState.error ?? 'A entrega falhou.'}
                </p>
              )}
              {sendState.status === 'fila' && (
                <p className="mt-1 text-[10px] text-ink-tertiary">
                  Aguardando o plugin entregar ao OpenCode…
                </p>
              )}
              {sendState.status === 'entregue' && (
                <p
                  data-testid="office-message-status"
                  className="mt-1 flex items-center gap-1.5 text-[10.5px] text-success"
                >
                  <Check size={12} aria-hidden="true" />
                  Mensagem entregue ao agente.
                </p>
              )}
            </div>

            {!pluginConnected && (
              <p className="mt-1.5 text-[10px] leading-snug text-ink-tertiary">
                Instale o plugin em Configurações → OpenOffice para enviar mensagens.
              </p>
            )}
            {pluginConnected && !actionsEnabled && (
              <p className="mt-1.5 text-[10px] leading-snug text-ink-tertiary">
                Ações em somente leitura — ligue a chave no topo para enviar.
              </p>
            )}
          </section>
        )}

        {!pluginConnected && (
          <p
            data-testid="office-actions-unavailable"
            className="flex items-start gap-1.5 rounded-control border border-[var(--border-subtle)] px-2.5 py-2 text-[10.5px] leading-snug text-ink-tertiary"
          >
            <Info size={12} className="mt-px shrink-0" aria-hidden="true" />
            Instale o plugin em Configurações → OpenOffice para responder pedidos e enviar
            mensagens.
          </p>
        )}

        {pluginConnected && !actionsEnabled && !requests.length && !canMessage && (
          <p className="text-[10.5px] leading-snug text-ink-tertiary">
            Ações em somente leitura — ligue a chave no topo para responder.
          </p>
        )}
      </div>
    </section>
  )
}
