import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, Loader2, Palette, UserCog, X } from 'lucide-react'
import type {
  OfficeAgent,
  OfficeAgentOption,
  OfficeModelOption,
  OfficeRoom,
  OfficeRosterOptions
} from '../../../../shared/office'
import { effortLabel, STATUS_META } from './format'
import { OfficeTranscript } from './OfficeTranscript'
import { PromptComposer } from './PromptComposer'
import { Badge, Button, Select } from '../ui'

/**
 * Popover ancorado no personagem (clique no boneco ou na lista da sidebar).
 *
 * Mesmas ações do card "Função" do painel: agente + modelo ("manter atual"),
 * com a regra de `working` (o main revalida). O atalho **Aparência** abre o
 * editor completo. `Esc` e clique fora fecham; o foco entra no primeiro campo.
 */

export interface AgentPopoverProps {
  agent: OfficeAgent
  room: OfficeRoom | null
  /** Tamanho do container do canvas (para não vazar da cena). */
  bounds: { width: number; height: number }
  anchor: { x: number; y: number }
  onClose: () => void
  onAppearance: () => void
  onSaved: () => void
}

const POPOVER_WIDTH = 340
const POPOVER_HEIGHT = 600

function modelKey(model: Pick<OfficeModelOption, 'providerID' | 'id'>): string {
  return `${model.providerID}/${model.id}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function AgentPopover({
  agent,
  room,
  bounds,
  anchor,
  onClose,
  onAppearance,
  onSaved
}: AgentPopoverProps): JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const selectRef = useRef<HTMLSelectElement | null>(null)
  const directory = (agent.directory ?? room?.path ?? '').trim()

  const [options, setOptions] = useState<OfficeRosterOptions | null>(null)
  const [loading, setLoading] = useState(directory.length > 0)
  const [agentID, setAgentID] = useState(agent.agent)
  const [modelValue, setModelValue] = useState('')
  const [variantValue, setVariantValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Cada envio/parada incrementa e força a releitura da conversa. */
  const [transcriptKey, setTranscriptKey] = useState(0)

  useEffect(() => {
    if (!directory) return
    let alive = true
    window.api
      .officeRosterOptions({ directory })
      .then((result) => {
        if (!alive) return
        if (!result.ok) {
          setError(result.error ?? 'Não consegui consultar as funções desta sessão.')
          return
        }
        setOptions({ agents: result.agents, models: result.models })
      })
      .catch(() => {
        if (alive) setError('Não consegui falar com o processo principal.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [directory])

  useEffect(() => {
    selectRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (!cardRef.current) return
      if (!cardRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    // `mousedown` no documento captura o clique fora; o clique que abriu o
    // popover já aconteceu, então não fecha no mesmo gesto.
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  const agentOptions: OfficeAgentOption[] = options?.agents ?? []
  const modelOptions = (options?.models ?? []).filter((model) => model.enabled)
  const hasCurrentAgent = agentOptions.some((option) => option.id === agent.agent)
  const currentModelKey = modelKey(agent.model)
  const hasCurrentModel = modelOptions.some((model) => modelKey(model) === currentModelKey)
  const selectedModel = modelOptions.find((model) => modelKey(model) === modelValue) ?? null
  /** Esforços do modelo escolhido; sem escolha, os do modelo atual (se listado). */
  const effortSource =
    selectedModel ?? modelOptions.find((model) => modelKey(model) === currentModelKey) ?? null
  const effortOptions = effortSource?.variants ?? []
  const working = agent.status === 'working'
  const blocked = working || saving
  const canSave = !blocked && !loading && options !== null && agentID.length > 0
  const canChooseVariant = !blocked && !loading && effortOptions.length > 0

  const width = Math.max(0, bounds.width)
  const height = Math.max(0, bounds.height)
  const left = clamp(anchor.x - POPOVER_WIDTH / 2, 8, Math.max(8, width - POPOVER_WIDTH - 8))
  const above = anchor.y - POPOVER_HEIGHT - 12
  const top = above >= 8 ? above : clamp(anchor.y + 18, 8, Math.max(8, height - POPOVER_HEIGHT - 8))
  const status = STATUS_META[agent.status]

  function save(): void {
    if (!canSave) return
    let chosenModel: OfficeModelOption | null = selectedModel
    if (!chosenModel && variantValue && agent.model.id !== 'desconhecido') {
      // Só o esforço mudou: mantém modelo/provider atuais e envia o variant.
      chosenModel = {
        providerID: agent.model.providerID,
        id: agent.model.id,
        name: agent.model.id,
        enabled: true,
        variants: effortOptions,
        variant: variantValue
      }
    } else if (chosenModel && variantValue) {
      chosenModel = { ...chosenModel, variant: variantValue }
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    void window.api
      .officeSetRole({ sessionID: agent.sessionID, agentID, model: chosenModel })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui mudar a função desta sessão.')
          return
        }
        setSaved(true)
        onSaved()
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Função de ${agent.name}`}
      data-testid="office-agent-popover"
      className="absolute z-dropdown flex w-[340px] max-h-[min(80vh,600px)] flex-col overflow-hidden rounded-card border border-[var(--border-strong)] bg-surface-3 shadow-elevation-3"
      style={{ left, top }}
    >
      <header className="flex items-start gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-ink-primary">{agent.name}</p>
          <p className="flex items-center gap-1.5 truncate text-[10.5px] text-ink-tertiary">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-pill ${status.dot}`} />
            {status.label}
            <span aria-hidden="true">·</span>
            {room?.name ?? 'Sem sala'}
          </p>
        </div>
        <button
          type="button"
          aria-label="Fechar popover"
          data-testid="office-popover-close"
          onClick={onClose}
          className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-tertiary hover:bg-surface-2 hover:text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {agent.rolePending && (
          <Badge tone="warning" data-testid="office-popover-pending">
            função {agent.rolePending} pendente
          </Badge>
        )}

        <div>
          <label
            htmlFor={`popover-agent-${agent.sessionID}`}
            className="block text-[9.5px] uppercase tracking-[0.08em] text-ink-tertiary"
          >
            Função
          </label>
          <Select
            ref={selectRef}
            id={`popover-agent-${agent.sessionID}`}
            data-testid="office-popover-agent"
            className="mt-1 !py-1.5 text-[12px]"
            value={agentID}
            disabled={blocked || loading || options === null}
            onChange={(event) => {
              setSaved(false)
              setAgentID(event.target.value)
            }}
          >
            {!hasCurrentAgent && <option value={agent.agent}>{agent.agent} (atual)</option>}
            {agentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor={`popover-model-${agent.sessionID}`}
            className="block text-[9.5px] uppercase tracking-[0.08em] text-ink-tertiary"
          >
            Modelo
          </label>
          <Select
            id={`popover-model-${agent.sessionID}`}
            data-testid="office-popover-model"
            className="mt-1 !py-1.5 text-[12px]"
            value={modelValue}
            disabled={blocked || loading || options === null}
            onChange={(event) => {
              setSaved(false)
              setModelValue(event.target.value)
              // Os esforços mudam com o modelo: não carregar um variant inválido.
              setVariantValue('')
            }}
          >
            <option value="">Manter modelo atual</option>
            {!hasCurrentModel && <option value={currentModelKey}>{agent.model.id} (atual)</option>}
            {modelOptions.map((model) => (
              <option key={modelKey(model)} value={modelKey(model)}>
                {model.name} ({model.providerID})
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor={`popover-effort-${agent.sessionID}`}
            className="block text-[9.5px] uppercase tracking-[0.08em] text-ink-tertiary"
          >
            Esforço
          </label>
          <Select
            id={`popover-effort-${agent.sessionID}`}
            data-testid="office-popover-effort"
            className="mt-1 !py-1.5 text-[12px]"
            value={variantValue}
            disabled={!canChooseVariant}
            onChange={(event) => {
              setSaved(false)
              setVariantValue(event.target.value)
            }}
          >
            <option value="">Padrão</option>
            {effortOptions.map((variant) => (
              <option key={variant} value={variant}>
                {effortLabel(variant)}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[9.5px] text-ink-tertiary">
            Atual: {agent.model.variant ? effortLabel(agent.model.variant) : 'padrão'}
            {effortOptions.length === 0 ? ' · este modelo não oferece esforço' : ''}
          </p>
        </div>

        {working && (
          <p className="text-[10.5px] leading-snug text-warn">
            Sessão trabalhando — espere a tarefa terminar para trocar a função.
          </p>
        )}
        {!directory && !working && (
          <p className="text-[10.5px] leading-snug text-ink-tertiary">
            Sem pasta de projeto para consultar as funções do OpenCode.
          </p>
        )}

        <div aria-live="polite" className="min-h-[14px]">
          {loading && (
            <span className="flex items-center gap-1.5 text-[10px] text-ink-tertiary">
              <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              carregando funções…
            </span>
          )}
          {!loading && error && (
            <span className="flex items-start gap-1.5 text-[10px] leading-snug text-danger">
              <CircleAlert size={11} className="mt-px shrink-0" aria-hidden="true" />
              {error}
            </span>
          )}
          {!loading && !error && saved && (
            <span className="flex items-center gap-1.5 text-[10px] text-success">
              <Check size={11} aria-hidden="true" />
              Função atualizada.
            </span>
          )}
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-2.5">
          <PromptComposer
            agent={agent}
            onActivity={() => {
              setTranscriptKey((current) => current + 1)
              onSaved()
            }}
          />
        </div>

        <div className="border-t border-[var(--border-subtle)] pt-2.5">
          <OfficeTranscript sessionID={agent.sessionID} refreshKey={transcriptKey} compact />
        </div>
      </div>

      <footer className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onAppearance}
          data-testid="office-popover-appearance"
        >
          <Palette size={12} aria-hidden="true" />
          Aparência
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="primary"
          onClick={save}
          disabled={!canSave}
          data-testid="office-popover-save"
        >
          {saving ? (
            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <UserCog size={12} aria-hidden="true" />
          )}
          Salvar
        </Button>
      </footer>
    </div>
  )
}
