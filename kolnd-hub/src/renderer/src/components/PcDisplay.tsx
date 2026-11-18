import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import {
  AlertTriangle,
  Gauge,
  Loader2,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  Scaling
} from 'lucide-react'
import type { DisplayDescriptor, DisplayInfo, DisplayResolution, DisplayScaleInfo } from '../types'
import {
  displayLabel,
  pickRefreshRate,
  refreshLabel,
  resolutionLabel,
  scaleLabel
} from '../../../shared/display'
import { Button, Card, IconButton, Modal, Select } from './ui'

const GENERIC_LOAD_ERROR =
  'Não foi possível ler as configurações de tela do Windows. Tente novamente em alguns instantes.'
const GENERIC_SCALE_ERROR = 'Não foi possível alterar a escala da tela. Tente novamente.'
const GENERIC_RESOLUTION_ERROR = 'Não foi possível alterar a resolução de tela. Tente novamente.'

interface RevertTarget {
  displayId: string
  width: number
  height: number
  refreshHz: number
}

interface Notice {
  tone: 'success' | 'danger'
  message: string
  /** Presente só em mudança de modo confirmada, para oferecer o caminho de volta. */
  revert?: RevertTarget
}

interface PendingConfirmation {
  changeId: number
  deadline: number
  /** Quem mudou: nome do monitor ou "Escala de <monitor>". */
  subject: string
  appliedLabel: string
  restoreLabel: string
  restoreTarget: 'tela' | 'escala'
  successMessage: string
  /** Só em mudança de modo; alimenta o "Reverter para …" do aviso. */
  previous: RevertTarget | null
  changed: boolean
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDisplayScaleInfo(value: unknown): value is DisplayScaleInfo {
  if (typeof value !== 'object' || value === null) return false
  const scale = value as Partial<DisplayScaleInfo>
  return (
    isFiniteNumber(scale.current) &&
    isFiniteNumber(scale.recommended) &&
    Array.isArray(scale.options) &&
    scale.options.every(isFiniteNumber)
  )
}

function isDisplayResolution(value: unknown): value is DisplayResolution {
  if (typeof value !== 'object' || value === null) return false
  const resolution = value as Partial<DisplayResolution>
  return (
    isFiniteNumber(resolution.width) &&
    isFiniteNumber(resolution.height) &&
    typeof resolution.recommended === 'boolean' &&
    Array.isArray(resolution.refreshRates) &&
    resolution.refreshRates.length > 0 &&
    resolution.refreshRates.every(isFiniteNumber)
  )
}

function isDisplayDescriptor(value: unknown): value is DisplayDescriptor {
  if (typeof value !== 'object' || value === null) return false
  const display = value as Partial<DisplayDescriptor>
  return (
    typeof display.id === 'string' &&
    display.id.length > 0 &&
    display.id.length <= 32 &&
    typeof display.name === 'string' &&
    display.name.length > 0 &&
    display.name.length <= 200 &&
    typeof display.primary === 'boolean' &&
    isFiniteNumber(display.width) &&
    isFiniteNumber(display.height) &&
    isFiniteNumber(display.refreshHz) &&
    Array.isArray(display.resolutions) &&
    display.resolutions.every(isDisplayResolution) &&
    (display.scale === null || isDisplayScaleInfo(display.scale))
  )
}

/** O renderer não confia no IPC: só usa o objeto se ele tiver a forma esperada. */
function isDisplayInfo(value: unknown): value is DisplayInfo {
  if (typeof value !== 'object' || value === null) return false
  const info = value as Partial<DisplayInfo>
  return (
    typeof info.ok === 'boolean' &&
    Array.isArray(info.displays) &&
    info.displays.every(isDisplayDescriptor)
  )
}

export function PcDisplay(): JSX.Element {
  // Entradas decorativas (aviso, card) viram fade curto com reduce.
  const reduced = useReducedMotion()
  const [info, setInfo] = useState<DisplayInfo | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<'scale' | 'mode' | 'confirm' | 'revert' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [pending, setPending] = useState<PendingConfirmation | null>(null)
  const [now, setNow] = useState(0)
  const mountedRef = useRef(true)
  // Espelho do pendente para o listener de timeout ler o id atual sem closure velha.
  const pendingRef = useRef<PendingConfirmation | null>(null)

  const updatePending = (next: PendingConfirmation | null): void => {
    pendingRef.current = next
    setPending(next)
  }

  // Mantém o monitor escolhido enquanto ele existir; senão cai no primário.
  const applyInfo = useCallback((next: DisplayInfo): void => {
    setInfo(next)
    setError(next.ok ? null : (next.error ?? GENERIC_LOAD_ERROR))
    setSelectedId((current) => {
      if (!next.ok) return current
      if (current && next.displays.some((display) => display.id === current)) return current
      return next.displays.find((display) => display.primary)?.id ?? next.displays[0]?.id ?? null
    })
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next: unknown = await window.api.getDisplayInfo()
      if (!mountedRef.current) return
      if (!isDisplayInfo(next)) {
        setError(GENERIC_LOAD_ERROR)
        return
      }
      applyInfo(next)
    } catch {
      // Nunca exibir detalhes técnicos crus — mensagem amigável.
      if (mountedRef.current) setError(GENERIC_LOAD_ERROR)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [applyInfo])

  useEffect(() => {
    mountedRef.current = true
    // Carga inicial fora do corpo do efeito: setState só em callbacks (sem
    // render em cascata). O botão de atualizar reusa `load` em um evento.
    window.api
      .getDisplayInfo()
      .then((next) => {
        if (!mountedRef.current) return
        if (!isDisplayInfo(next)) {
          setError(GENERIC_LOAD_ERROR)
          return
        }
        applyInfo(next)
      })
      .catch(() => {
        if (mountedRef.current) setError(GENERIC_LOAD_ERROR)
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false)
      })
    return () => {
      mountedRef.current = false
    }
  }, [applyInfo])

  // Relê o estado real depois de aplicar/confirmar/reverter: os selects voltam
  // sozinhos ao modo que o Windows está usando de fato.
  const refreshAfter = useCallback(async (): Promise<void> => {
    try {
      const refreshed: unknown = await window.api.getDisplayInfo()
      if (!mountedRef.current) return
      if (!isDisplayInfo(refreshed)) {
        setError(GENERIC_LOAD_ERROR)
        return
      }
      applyInfo(refreshed)
    } catch {
      if (mountedRef.current) setError(GENERIC_LOAD_ERROR)
    }
  }, [applyInfo])

  // Contagem regressiva ~4×/s a partir do deadline devolvido pelo main.
  useEffect(() => {
    if (!pending) return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [pending])

  // O main reverte sozinho no timeout; o evento fecha o modal mesmo se a UI
  // estava travada. Ids antigos são ignorados.
  useEffect(() => {
    const unsubscribe = window.api.onDisplayReverted((event) => {
      if (!mountedRef.current) return
      const current = pendingRef.current
      if (!current || current.changeId !== event.changeId) return

      pendingRef.current = null
      setPending(null)
      void refreshAfter().then(() => {
        if (!mountedRef.current) return
        setNotice(
          event.ok
            ? {
                tone: 'success',
                message: 'Nenhuma confirmação em 10 s — voltamos para a configuração anterior.'
              }
            : {
                tone: 'danger',
                message:
                  event.error ??
                  'Não foi possível reverter a alteração. Verifique as configurações de tela.'
              }
        )
      })
    })
    return unsubscribe
  }, [refreshAfter])

  const applyScale = async (target: DisplayDescriptor, percent: number): Promise<void> => {
    if (!info || applying || pendingRef.current) return
    const previousPercent = target.scale?.current ?? percent
    setApplying('scale')
    setNotice(null)
    try {
      const result = await window.api.setDisplayScale(target.id, percent)
      if (!mountedRef.current) return
      if (!result.ok) {
        await refreshAfter()
        if (!mountedRef.current) return
        setNotice({ tone: 'danger', message: result.error ?? GENERIC_SCALE_ERROR })
        return
      }

      await refreshAfter()
      if (!mountedRef.current) return

      const appliedLabel = `${percent}%`
      const changed = percent !== previousPercent
      const successMessage = `Escala de ${target.name} alterada para ${percent}%.`

      if (result.change) {
        setNow(Date.now())
        updatePending({
          changeId: result.change.id,
          deadline: result.change.deadline,
          subject: `Escala de ${target.name}`,
          appliedLabel,
          restoreLabel: `${previousPercent}%`,
          restoreTarget: 'escala',
          successMessage,
          previous: null,
          changed
        })
      } else {
        setNotice({ tone: 'success', message: successMessage })
      }
    } catch {
      await refreshAfter()
      if (mountedRef.current) setNotice({ tone: 'danger', message: GENERIC_SCALE_ERROR })
    } finally {
      if (mountedRef.current) setApplying(null)
    }
  }

  const applyMode = async (
    target: DisplayDescriptor,
    width: number,
    height: number,
    refreshHz: number
  ): Promise<void> => {
    if (!info || applying || pendingRef.current) return
    const previous: RevertTarget = {
      displayId: target.id,
      width: target.width,
      height: target.height,
      refreshHz: target.refreshHz
    }
    setApplying('mode')
    setNotice(null)
    try {
      const result = await window.api.setDisplayResolution(target.id, width, height, refreshHz)
      if (!mountedRef.current) return
      if (!result.ok) {
        await refreshAfter()
        if (!mountedRef.current) return
        setNotice({ tone: 'danger', message: result.error ?? GENERIC_RESOLUTION_ERROR })
        return
      }

      await refreshAfter()
      if (!mountedRef.current) return

      const appliedLabel = `${width} × ${height} · ${refreshHz} Hz`
      const changed =
        previous.width !== width || previous.height !== height || previous.refreshHz !== refreshHz
      const successMessage = `${target.name}: ${appliedLabel}.`

      if (result.change) {
        setNow(Date.now())
        updatePending({
          changeId: result.change.id,
          deadline: result.change.deadline,
          subject: target.name,
          appliedLabel,
          restoreLabel: `${previous.width} × ${previous.height} · ${previous.refreshHz} Hz`,
          restoreTarget: 'tela',
          successMessage,
          previous,
          changed
        })
      } else {
        setNotice({
          tone: 'success',
          message: successMessage,
          revert: changed ? previous : undefined
        })
      }
    } catch {
      await refreshAfter()
      if (mountedRef.current) setNotice({ tone: 'danger', message: GENERIC_RESOLUTION_ERROR })
    } finally {
      if (mountedRef.current) setApplying(null)
    }
  }

  const handleConfirm = async (): Promise<void> => {
    const current = pendingRef.current
    if (!current || applying) return
    setApplying('confirm')
    try {
      const result = await window.api.confirmDisplayChange()
      // O main já cancelou o timer: fechar o modal antes de reler evita que a
      // contagem chegue a "Revertendo…" durante o refresh.
      updatePending(null)
      await refreshAfter()
      if (!mountedRef.current) return
      if (result.confirmed) {
        setNotice({
          tone: 'success',
          message: current.successMessage,
          revert: current.changed ? (current.previous ?? undefined) : undefined
        })
      } else {
        // O timeout já disparou enquanto o clique chegava: o main esperou o
        // revert terminar, então o estado relido já é o anterior.
        setNotice({
          tone: 'danger',
          message: 'O tempo para confirmar terminou — a alteração foi revertida.'
        })
      }
    } catch {
      // Mantém o pendente: o timer do main continua valendo e o evento de
      // timeout ainda fecha o modal e relê o estado.
      if (mountedRef.current) {
        setNotice({
          tone: 'danger',
          message: 'Não foi possível confirmar a alteração. Aguarde a reversão automática.'
        })
      }
    } finally {
      if (mountedRef.current) setApplying(null)
    }
  }

  const handleRevertNow = async (): Promise<void> => {
    if (!pendingRef.current || applying) return
    setApplying('revert')
    try {
      const result = await window.api.revertDisplayChange()
      updatePending(null)
      await refreshAfter()
      if (!mountedRef.current) return
      setNotice(
        result.ok
          ? { tone: 'success', message: 'Alteração revertida.' }
          : {
              tone: 'danger',
              message:
                result.error ??
                'Não foi possível reverter a alteração. Verifique as configurações de tela.'
            }
      )
    } catch {
      // Sem resposta do main: mantém o modal e deixa o timer automático agir.
      await refreshAfter()
      if (mountedRef.current) {
        setNotice({
          tone: 'danger',
          message: 'Não foi possível reverter a alteração agora. Aguarde a reversão automática.'
        })
      }
    } finally {
      if (mountedRef.current) setApplying(null)
    }
  }

  const displays = info?.ok ? info.displays : []
  const display =
    displays.find((item) => item.id === selectedId) ??
    displays.find((item) => item.primary) ??
    displays[0] ??
    null
  const currentResolution = display
    ? (display.resolutions.find(
        (resolution) => resolution.width === display.width && resolution.height === display.height
      ) ?? null)
    : null
  const refreshRates = currentResolution?.refreshRates ?? []
  const recommendedHz = refreshRates.length > 0 ? Math.max(...refreshRates) : 0
  const canInteract = !loading && applying === null && pending === null
  const busy = loading || applying !== null
  /** Confirmação/reversão em voo: evita reentrada nos botões do modal. */
  const modalActionPending = applying === 'confirm' || applying === 'revert'
  const revert = notice?.revert ?? null
  const revertAvailable = revert !== null && displays.some((item) => item.id === revert.displayId)
  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - now) / 1000)) : 0
  const expired = pending !== null && secondsLeft <= 0

  const revertMode = (target: RevertTarget): void => {
    const descriptor = displays.find((item) => item.id === target.displayId)
    if (!descriptor) return
    setSelectedId(descriptor.id)
    void applyMode(descriptor, target.width, target.height, target.refreshHz)
  }

  return (
    <div className="space-y-4">
      {notice && (
        <motion.div
          {...entranceProps(reduced, { y: 10 })}
          role={notice.tone === 'success' ? 'status' : 'alert'}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-card border p-4 ${
            notice.tone === 'success'
              ? 'border-success-border bg-success-bg'
              : 'border-danger-border bg-danger-bg'
          }`}
        >
          <p
            className={`text-[13px] font-semibold leading-relaxed ${
              notice.tone === 'success' ? 'text-success' : 'text-danger'
            }`}
          >
            {notice.message}
          </p>
          {revert && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => revertMode(revert)}
              disabled={!canInteract || !revertAvailable}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Reverter para {revert.width} × {revert.height} · {revert.refreshHz} Hz
            </Button>
          )}
        </motion.div>
      )}

      {info && info.ok && display ? (
        <Card aria-busy={busy} className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-accent">
                <Monitor size={16} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink-primary">Escala e layout</h3>
                <p className="text-[11px] text-ink-tertiary">
                  {displays.length === 1
                    ? `Escala, resolução e taxa de atualização · ${display.name}`
                    : 'Escolha o monitor e ajuste escala, resolução e taxa de atualização'}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {applying && (
                <span
                  role="status"
                  className="flex items-center gap-1.5 text-[11px] text-ink-tertiary"
                >
                  <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                  Aplicando…
                </span>
              )}
              <IconButton
                aria-label="Atualizar configurações de tela"
                size="sm"
                onClick={() => void load()}
                disabled={!canInteract}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
              </IconButton>
            </div>
          </div>

          <div className="mt-4 border-t border-[var(--border-subtle)]">
            {displays.length > 1 && (
              <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-ink-secondary">
                    <MonitorSmartphone size={20} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-primary">Monitor</p>
                    <p className="text-[11px] text-ink-tertiary">
                      Escolha a tela que deseja ajustar
                    </p>
                  </div>
                </div>
                <div className="w-full shrink-0 sm:w-[240px]">
                  <Select
                    aria-label="Monitor"
                    value={display.id}
                    disabled={!canInteract}
                    onChange={(event) => setSelectedId(event.target.value)}
                  >
                    {displays.map((item, index) => (
                      <option key={item.id} value={item.id}>
                        {displayLabel(item, index)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}

            <div
              className={`flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between ${
                displays.length > 1 ? 'border-t border-[var(--border-subtle)]' : ''
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-ink-secondary">
                  <Scaling size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-primary">Escala</p>
                  <p className="text-[11px] text-ink-tertiary">
                    Alterar o tamanho do texto, dos aplicativos e de outros itens
                  </p>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-[240px]">
                {display.scale ? (
                  <Select
                    aria-label="Escala da tela"
                    value={String(display.scale.current)}
                    disabled={!canInteract}
                    onChange={(event) => {
                      const percent = Number(event.target.value)
                      if (Number.isInteger(percent) && percent !== display.scale?.current) {
                        void applyScale(display, percent)
                      }
                    }}
                  >
                    {display.scale.options.map((percent) => (
                      <option key={percent} value={String(percent)}>
                        {scaleLabel(percent, display.scale?.recommended ?? percent)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-[11px] text-ink-tertiary">
                    Escala não disponível para este monitor.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-ink-secondary">
                  <Monitor size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-primary">Resolução de tela</p>
                  <p className="text-[11px] text-ink-tertiary">
                    Ajustar a resolução para se adequar à tela conectada
                  </p>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-[240px]">
                <Select
                  aria-label="Resolução de tela"
                  value={`${display.width}x${display.height}`}
                  disabled={!canInteract || display.resolutions.length === 0}
                  onChange={(event) => {
                    const [widthText, heightText] = event.target.value.split('x')
                    const width = Number(widthText)
                    const height = Number(heightText)
                    if (!Number.isInteger(width) || !Number.isInteger(height)) return
                    if (width === display.width && height === display.height) return
                    const target = display.resolutions.find(
                      (resolution) => resolution.width === width && resolution.height === height
                    )
                    if (!target) return
                    // Preserva o Hz atual quando a nova resolução o aceita;
                    // senão usa o maior disponível.
                    void applyMode(
                      display,
                      target.width,
                      target.height,
                      pickRefreshRate(target, display.refreshHz)
                    )
                  }}
                >
                  {display.resolutions.map((resolution) => (
                    <option
                      key={`${resolution.width}x${resolution.height}`}
                      value={`${resolution.width}x${resolution.height}`}
                    >
                      {resolutionLabel(resolution)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-surface-2 text-ink-secondary">
                  <Gauge size={20} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-primary">Taxa de atualização</p>
                  <p className="text-[11px] text-ink-tertiary">
                    Escolher a taxa de atualização da tela (Hz)
                  </p>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-[240px]">
                {currentResolution ? (
                  <Select
                    aria-label="Taxa de atualização"
                    value={String(display.refreshHz)}
                    disabled={!canInteract || refreshRates.length < 2}
                    onChange={(event) => {
                      const hz = Number(event.target.value)
                      if (!Number.isInteger(hz) || hz === display.refreshHz) return
                      void applyMode(display, display.width, display.height, hz)
                    }}
                  >
                    {refreshRates.map((hz) => (
                      <option key={hz} value={String(hz)}>
                        {refreshLabel(hz, recommendedHz)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p className="text-[11px] text-ink-tertiary">{display.refreshHz} Hz</p>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card aria-busy={loading} className="p-5">
          <div className="flex items-start gap-3">
            {loading ? (
              <>
                <Loader2
                  size={18}
                  className="mt-0.5 shrink-0 animate-spin text-accent"
                  aria-hidden="true"
                />
                <div>
                  <p role="status" className="text-[13px] font-semibold text-ink-primary">
                    Lendo as configurações de tela…
                  </p>
                  <p className="text-[11px] text-ink-tertiary">Isso leva só um instante.</p>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle
                  size={18}
                  className="mt-0.5 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <p role="alert" className="text-[13px] font-semibold text-danger">
                    Não foi possível ler as configurações de tela
                  </p>
                  <p className="text-[11px] leading-relaxed text-ink-secondary">
                    {error ?? info?.error ?? GENERIC_LOAD_ERROR}
                  </p>
                </div>
              </>
            )}
          </div>
          {!loading && (
            <Button variant="ghost" size="sm" className="mt-3" onClick={() => void load()}>
              <RefreshCw size={14} aria-hidden="true" />
              Tentar novamente
            </Button>
          )}
        </Card>
      )}

      {pending && (
        <Modal
          title="Manter estas configurações?"
          onClose={() => void handleRevertNow()}
          closeLabel="Reverter alteração"
          footer={
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => void handleRevertNow()}
                disabled={modalActionPending}
              >
                Reverter agora
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleConfirm()}
                disabled={expired || modalActionPending}
              >
                Manter alteração
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              Aplicado em {pending.subject}:{' '}
              <span className="font-semibold text-ink-primary">{pending.appliedLabel}</span>.
            </p>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              A {pending.restoreTarget} voltará para{' '}
              <span className="font-semibold text-ink-primary">{pending.restoreLabel}</span> em{' '}
              <span className="font-semibold text-ink-primary">{secondsLeft} s</span>.
            </p>
            <p
              role="timer"
              aria-live="polite"
              className="text-[13px] font-semibold text-ink-primary"
            >
              {expired ? 'Revertendo…' : `Voltando em ${secondsLeft} s…`}
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
