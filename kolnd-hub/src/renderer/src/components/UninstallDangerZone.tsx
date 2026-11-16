// Seção "Zona de perigo" das Configurações (T4 — desinstalar).
//
// Montada no fim de Settings.tsx, antes da nota informativa. Recebe o
// opcional `onToast` (reaproveita o toast do App quando informado; caso
// contrário exibe um toast inline próprio). Não duplica lógica de MSI/registro
// — tudo flui via window.api.*.
//
// Reformulação visual 2.0 (13.13): moldura surface-1 + borda danger SUTIL 1px
// (Card + override pontual de borderColor), estados com Badge (warning/neutral,
// reusando strings já existentes), botões danger via primitivo Button.
// Lógica, estados, ordem, textos e bloqueios: INTOCADOS.
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { entranceProps, useReducedMotion } from '../lib/motion'
import { AlertTriangle, Gamepad2, RefreshCw, Trash2, Zap } from 'lucide-react'
import { UninstallKloudGamesModal } from './UninstallKloudGamesModal'
import { UninstallHubModal } from './UninstallHubModal'
import { Badge, Button, Card, IconButton, Skeleton } from './ui'
import {
  getKloudPartialKind,
  getKloudPartialStatusText,
  type KloudDetectionLike
} from '../lib/uninstall'

export interface UninstallDangerZoneProps {
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

type DetStatus = 'installed' | 'partial' | 'missing'

interface KloudState {
  status: DetStatus | null
  detection: NonNullable<
    Awaited<ReturnType<typeof window.api.getKloudGamesUninstallStatus>>['detection']
  > | null
  loading: boolean
}

interface HubState {
  available: boolean | null
  isPackaged: boolean
  loading: boolean
}

export function UninstallDangerZone({ onToast }: UninstallDangerZoneProps): JSX.Element {
  // Entradas decorativas dos cards de perigo viram fade curto com reduce.
  const reduced = useReducedMotion()
  const showToast = useCallback(
    (msg: string, kind: 'success' | 'error' | 'info' = 'info'): void => {
      onToast?.(msg, kind)
    },
    [onToast]
  )

  const [kloud, setKloud] = useState<KloudState>({ status: null, detection: null, loading: true })
  const [hub, setHub] = useState<HubState>({ available: null, isPackaged: false, loading: true })
  const [uninstalling, setUninstalling] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [hubModalOpen, setHubModalOpen] = useState(false)
  const originRef = useRef<HTMLButtonElement | null>(null)
  const originHubRef = useRef<HTMLButtonElement | null>(null)

  const loadKloud = useCallback(async (): Promise<void> => {
    try {
      const res = await window.api.getKloudGamesUninstallStatus()
      if (!res.ok) {
        setKloud({ status: null, detection: null, loading: false })
        return
      }
      setKloud({
        status: res.detection?.status ?? 'missing',
        detection: res.detection ?? null,
        loading: false
      })
    } catch {
      setKloud({ status: null, detection: null, loading: false })
    }
  }, [])

  // Monta com status vazio (loading) e preenche após o await — evita setState
  // síncrono no corpo do efeito.
  useEffect(() => {
    let mounted = true
    window.api
      .getKloudGamesUninstallStatus()
      .then((res) => {
        if (!mounted) return
        if (!res.ok) {
          setKloud({ status: null, detection: null, loading: false })
          return
        }
        setKloud({
          status: res.detection?.status ?? 'missing',
          detection: res.detection ?? null,
          loading: false
        })
      })
      .catch(() => {
        if (mounted) setKloud({ status: null, detection: null, loading: false })
      })
    return (): void => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    let mounted = true
    window.api
      .getHubUninstallStatus()
      .then((res) => {
        if (mounted)
          setHub({ available: res.available, isPackaged: res.isPackaged, loading: false })
      })
      .catch(() => {
        if (mounted) setHub({ available: false, isPackaged: false, loading: false })
      })
    return (): void => {
      mounted = false
    }
  }, [])

  // Revalida o status ao fechar o modal (o botão deve refletir "Não instalado"
  // imediatamente quando a desinstalação removeu o Kloud Games).
  const handleModalClose = useCallback((): void => {
    setUninstalling(false)
    setModalOpen(false)
    // Marca carregando enquanto revalida (chamado de manipulador de evento).
    setKloud((s) => ({ ...s, loading: true }))
    void loadKloud()
    originRef.current?.focus()
  }, [loadKloud])

  const handleUninstallClick = useCallback((): void => {
    setModalOpen(true)
  }, [])

  const handleHubModalClose = useCallback((): void => {
    setUninstalling(false)
    setHubModalOpen(false)
    originHubRef.current?.focus()
  }, [])

  const handleHubUninstallClick = useCallback((): void => {
    setHubModalOpen(true)
  }, [])

  const detectionLike: KloudDetectionLike | null = kloud.detection
    ? {
        status: kloud.detection.status,
        exePath: kloud.detection.exePath,
        service: kloud.detection.service,
        entry: kloud.detection.entry ? { productCode: kloud.detection.entry.productCode } : null
      }
    : null
  const kloudRunning = kloud.detection?.service === 'running'
  const partialKind = getKloudPartialKind(detectionLike)
  const kloudPartial = kloud.status === 'partial'
  const kloudMissing = kloud.status === 'missing'
  const kloudEnabled = (kloud.status === 'installed' || kloud.status === 'partial') && !uninstalling
  const buttonDisabled = !kloudEnabled
  // O Hub só pode ser desinstalado no app empacotado com o desinstalador NSIS presente.
  const hubEnabled = !uninstalling && !hub.loading && hub.isPackaged && hub.available === true
  const kloudButtonLabel = uninstalling
    ? 'Em execução'
    : partialKind === 'registry-orphan'
      ? 'Desinstalar pelo registro'
      : kloudPartial
        ? 'Instalação quebrada'
        : 'Desinstalar Kloud Games'

  const statusText = (): string => {
    if (kloud.loading) return 'Carregando status…'
    if (kloud.status === null) return 'Não foi possível carregar o status.'
    const d = kloud.detection
    if (kloud.status === 'installed' && d) {
      const loc = d.entry?.installLocation ?? 'C:\\Program Files\\KLOUD_GAMES'
      const ver = d.entry?.displayVersion ?? '—'
      const svc =
        d.service === 'running' ? 'rodando' : d.service === 'stopped' ? 'parado' : 'não encontrado'
      return `Instalado em ${loc} (versão ${ver}) · serviço KLOUD_GAMESsvc: ${svc}`
    }
    if (kloud.status === 'partial') {
      return getKloudPartialStatusText(partialKind)
    }
    return 'Não instalado.'
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-1">
        <p className="mx-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-danger">
          <AlertTriangle size={14} aria-hidden="true" />
          Zona de perigo
        </p>
        <p className="mx-2 text-sm leading-relaxed text-ink-secondary">
          Desinstalações são definitivas — leia com atenção antes de confirmar.
        </p>
      </header>

      {/* Enquanto a desinstalação roda, o card fica sem interação e escurecido. */}
      <div className={`space-y-6 ${uninstalling ? 'pointer-events-none opacity-70' : ''}`}>
        {/* ── Kloud Games ───────────────────────────── */}
        <motion.div {...entranceProps(reduced, { y: 10 })}>
          {/* Borda danger SUTIL (1px, danger/30) — nunca fundo vermelho gritante. */}
          <Card className="p-6" style={{ borderColor: 'var(--danger-border)' }}>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-danger-border bg-danger-bg text-danger">
                <Gamepad2 size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink-primary">Desinstalar Kloud Games</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  Remove o Kloud Games (programa, serviço, regras de firewall, PATH e atalhos). Suas
                  preferências do Hub continuam salvas.
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-2 px-4 py-3">
              {kloud.loading ? (
                <div className="flex items-center gap-2 text-xs text-ink-tertiary">
                  <Skeleton rounded="pill" className="h-3 w-48" />
                  <Skeleton rounded="pill" className="h-3 w-24" />
                </div>
              ) : (
                <>
                  <span className="text-xs font-mono text-ink-secondary">{statusText()}</span>
                  {kloud.status === 'partial' && (
                    <Badge tone="warning" className="shrink-0">
                      Instalação quebrada
                    </Badge>
                  )}
                  {kloud.status === 'missing' && (
                    <Badge tone="neutral" className="shrink-0">
                      Não instalado.
                    </Badge>
                  )}
                  {kloud.status === null && (
                    <Badge tone="neutral" className="shrink-0">
                      Status indisponível
                    </Badge>
                  )}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={loadKloud}
                    title="Atualizar status"
                    aria-label="Atualizar status do Kloud Games"
                    className="ml-auto shrink-0"
                  >
                    <RefreshCw size={14} aria-hidden="true" />
                  </IconButton>
                </>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                ref={originRef}
                variant="danger"
                disabled={buttonDisabled}
                onClick={handleUninstallClick}
                aria-disabled={buttonDisabled}
                title={
                  kloudMissing
                    ? 'O Kloud Games não está instalado'
                    : kloud.status === null
                      ? 'Status indisponível'
                      : uninstalling
                        ? 'Desinstalação em andamento'
                        : partialKind === 'registry-orphan'
                          ? 'Desinstalação pelo registro — o programa consta no registro'
                          : undefined
                }
              >
                <Trash2 size={14} aria-hidden="true" />
                {kloudButtonLabel}
              </Button>
              {uninstalling && <Badge tone="danger">Em execução</Badge>}
            </div>
          </Card>
        </motion.div>

        {/* ── Kolnd Hub ─────────────────────────────── */}
        <motion.div {...entranceProps(reduced, { y: 10 })}>
          <Card className="p-6" style={{ borderColor: 'var(--danger-border)' }}>
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control border border-danger-border bg-danger-bg text-danger">
                <Zap size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-ink-primary">Desinstalar Kolnd Hub</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  Remove o Kolnd Hub{' '}
                  <strong className="text-ink-primary">e também desinstala o Kloud Games</strong>{' '}
                  durante o processo (perguntaremos a cada passo). O Mark LVI é removido junto com a
                  pasta do Hub.
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-2 px-4 py-3">
              {hub.loading ? (
                <div className="flex items-center gap-2 text-xs text-ink-tertiary">
                  <Skeleton rounded="pill" className="h-3 w-32" />
                </div>
              ) : (
                <span className="text-xs font-mono text-ink-secondary">
                  {!hub.isPackaged
                    ? 'Disponível apenas no app instalado'
                    : hub.available
                      ? 'Disponível no app instalado'
                      : 'Desinstalador não encontrado'}
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button
                ref={originHubRef}
                variant="danger"
                disabled={!hubEnabled}
                aria-disabled={!hubEnabled}
                title={
                  hub.loading
                    ? 'Carregando status…'
                    : !hub.isPackaged
                      ? 'Disponível apenas no app instalado'
                      : !hub.available
                        ? 'Desinstalador não encontrado — desinstale pelo aplicativo Configurações do Windows → Aplicativos → Kolnd Hub'
                        : uninstalling
                          ? 'Desinstalação em andamento'
                          : undefined
                }
                onClick={handleHubUninstallClick}
              >
                <Trash2 size={14} aria-hidden="true" />
                {uninstalling ? 'Em execução' : 'Desinstalar Kolnd Hub'}
              </Button>
              {uninstalling && <Badge tone="danger">Em execução</Badge>}
            </div>
          </Card>
        </motion.div>
      </div>

      {modalOpen && (
        <UninstallKloudGamesModal
          open
          isRunning={kloudRunning}
          detection={detectionLike}
          onClose={handleModalClose}
          onRunningChange={setUninstalling}
          onToast={showToast}
        />
      )}

      {hubModalOpen && (
        <UninstallHubModal
          open
          onClose={handleHubModalClose}
          onRunningChange={setUninstalling}
          onToast={showToast}
        />
      )}
    </section>
  )
}
