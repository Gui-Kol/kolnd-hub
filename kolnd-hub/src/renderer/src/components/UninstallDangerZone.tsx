// Seção "Zona de perigo" das Configurações (T4 — desinstalar).
//
// Montada no fim de Settings.tsx, antes da nota informativa. Recebe o
// opcional `onToast` (reaproveita o toast do App quando informado; caso
// contrário exibe um toast inline próprio). Não duplica lógica de MSI/registro
// — tudo flui via window.api.*.
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Gamepad2, RefreshCw, Trash2, Zap } from 'lucide-react'
import { UninstallKloudGamesModal } from './UninstallKloudGamesModal'
import { UninstallHubModal } from './UninstallHubModal'

export interface UninstallDangerZoneProps {
  onToast?: (msg: string, kind: 'success' | 'error' | 'info') => void
}

type DetStatus = 'installed' | 'partial' | 'missing'

interface KloudState {
  status: DetStatus | null
  detection:
    | NonNullable<
        Awaited<ReturnType<typeof window.api.getKloudGamesUninstallStatus>>['detection']
      >
    | null
  loading: boolean
}

interface HubState {
  available: boolean | null
  isPackaged: boolean
  loading: boolean
}

export function UninstallDangerZone({ onToast }: UninstallDangerZoneProps): JSX.Element {
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
        if (mounted) setHub({ available: res.available, isPackaged: res.isPackaged, loading: false })
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

  const kloudRunning = kloud.detection?.service === 'running'
  const kloudPartial = kloud.status === 'partial'
  const kloudMissing = kloud.status === 'missing'
  const kloudEnabled = (kloud.status === 'installed' || kloud.status === 'partial') && !uninstalling
  const buttonDisabled = !kloudEnabled
  // O Hub só pode ser desinstalado no app empacotado com o desinstalador NSIS presente.
  const hubEnabled = !uninstalling && !hub.loading && hub.isPackaged && hub.available === true

  const statusText = (): string => {
    if (kloud.loading) return 'Carregando status…'
    if (kloud.status === null) return 'Não foi possível carregar o status.'
    const d = kloud.detection
    if (kloud.status === 'installed' && d) {
      const loc = d.entry?.installLocation ?? 'C:\\Program Files\\KLOUD_GAMES'
      const ver = d.entry?.displayVersion ?? '—'
      const svc =
        d.service === 'running'
          ? 'rodando'
          : d.service === 'stopped'
            ? 'parado'
            : 'não encontrado'
      return `Instalado em ${loc} (versão ${ver}) · serviço KLOUD_GAMESsvc: ${svc}`
    }
    if (kloud.status === 'partial') {
      return 'Instalação parcial detectada (exe sem registro) — a desinstalação tentará limpar o que for possível.'
    }
    return 'Não instalado.'
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mx-2">
          Zona de perigo
        </p>
        <p className="text-sm text-slate-400 mx-2 leading-relaxed">
          Desinstalações são definitivas — leia com atenção antes de confirmar.
        </p>
      </header>

      {/* Enquanto a desinstalação roda, o card fica sem interação e escurecido. */}
      <div className={uninstalling ? 'pointer-events-none opacity-70' : ''}>
        {/* ── Kloud Games ───────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 border-l-4 border-red-500/60"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-500/10 text-red-400 shadow-lg">
              <Gamepad2 size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">Desinstalar Kloud Games</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Remove o Kloud Games (programa, serviço, regras de firewall, PATH e atalhos). Suas
                preferências do Hub continuam salvas.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            {kloud.loading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="skeleton h-3 w-48" />
                <span className="skeleton h-3 w-24" />
              </div>
            ) : (
              <>
                <span className="text-xs font-mono text-slate-400">{statusText()}</span>
                <button
                  type="button"
                  onClick={loadKloud}
                  className="ml-auto p-1 rounded text-slate-500 hover:text-red-400 transition-colors"
                  title="Atualizar status"
                  aria-label="Atualizar status do Kloud Games"
                >
                  <RefreshCw size={14} />
                </button>
              </>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              ref={originRef}
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
                      : undefined
              }
              className={`btn-danger ${buttonDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Trash2 size={14} />
              {uninstalling ? 'Em execução' : 'Desinstalar Kloud Games'}
            </button>
            {uninstalling && (
              <span className="badge bg-red-500/10 border border-red-500/20 text-red-400">
                Em execução
              </span>
            )}
          </div>
        </motion.div>

        {/* ── Kolnd Hub ─────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-6 border-l-4 border-red-500/60"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-red-500/10 text-red-400 shadow-lg">
              <Zap size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">Desinstalar Kolnd Hub</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Remove o Kolnd Hub <strong className="text-white">e também desinstala o Kloud
                Games</strong> durante o processo (perguntaremos a cada passo). O Mark LVI é removido
                junto com a pasta do Hub.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            {hub.loading ? (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="skeleton h-3 w-32" />
              </div>
            ) : (
              <span className="text-xs font-mono text-slate-400">
                {!hub.isPackaged
                  ? 'Disponível apenas no app instalado'
                  : hub.available
                    ? 'Disponível no app instalado'
                    : 'Desinstalador não encontrado'}
              </span>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              ref={originHubRef}
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
              className={`btn-danger ${!hubEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={handleHubUninstallClick}
            >
              <Trash2 size={14} />
              {uninstalling ? 'Em execução' : 'Desinstalar Kolnd Hub'}
            </button>
            {uninstalling && (
              <span className="badge bg-red-500/10 border border-red-500/20 text-red-400">
                Em execução
              </span>
            )}
          </div>
        </motion.div>
      </div>

      {modalOpen && (
        <UninstallKloudGamesModal
          open
          isRunning={kloudRunning}
          isPartial={kloudPartial}
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
