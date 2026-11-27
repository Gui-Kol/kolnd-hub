// Seção "Big Picture" das Configurações (T5) — status do controle,
// abertura do fluxo de configuração (GamepadSetup), "Efeitos sonoros"
// persistidos em `bigPicture.sounds` e ação destrutiva "Apagar configuração".
//
// Embutida em Settings.tsx (modo normal) — é o único escritor do toggle
// `bigPicture.sounds` fora do BP. A UI é única e autocontida (sem props):
// qualquer instância (embutida ou futura) renderiza exatamente a mesma tela.
// O toggle de sons usa o primitivo <Switch/> (mesmo padrão do "Iniciar o
// Kolnd Hub com o Windows" na seção "Ao abrir o Hub").

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { entranceProps, exitProps, useReducedMotion } from '../lib/motion'
import {
  Gamepad2,
  Volume2,
  Check,
  AlertCircle,
  RotateCcw,
  Trash2,
  SlidersHorizontal,
  BadgeCheck
} from 'lucide-react'
import { GAMEPAD_PROFILES } from '../lib/gamepad'
import type { GamepadConfig } from '../lib/gamepad'
import { setSfxEnabled } from '../lib/sfx'
import { useFocusTrap } from '../lib/useFocusTrap'
import { GamepadSetup } from './GamepadSetup'
import { Badge, Button, Card, Switch } from './ui'

function formatConfiguredDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function BigPictureSettings(): JSX.Element {
  // Entradas decorativas (card de seção, toast) viram fade curto com reduce.
  const reduced = useReducedMotion()
  // `null` = carregando; `undefined` nunca é usado — ausência de config vira `null` no state.
  const [config, setConfig] = useState<GamepadConfig | null>(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [sounds, setSounds] = useState<boolean | null>(null)
  const [soundsFeedback, setSoundsFeedback] = useState<'saved' | 'error' | null>(null)
  const soundsFeedbackTimer = useRef<number | null>(null)

  const [setupOpen, setSetupOpen] = useState(false)
  const [setupInitial, setSetupInitial] = useState<GamepadConfig | null>(null)
  const [confirmErase, setConfirmErase] = useState(false)
  const [confirmRedo, setConfirmRedo] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const showToast = useCallback((text: string): void => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4000)
  }, [])

  // Config do controle (status) — corrompida/ausente é tratada como "não configurado".
  const refreshConfig = useCallback((): void => {
    window.api
      .getGamepadConfig()
      .then((result) => setConfig(result.ok ? result.config : null))
      .catch(() => setConfig(null))
      .finally(() => setConfigLoaded(true))
  }, [])

  useEffect(() => {
    let mounted = true
    window.api
      .getGamepadConfig()
      .then((result) => {
        if (mounted) setConfig(result.ok ? result.config : null)
      })
      .catch(() => {
        if (mounted) setConfig(null)
      })
      .finally(() => {
        if (mounted) setConfigLoaded(true)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  // Preferência "Efeitos sonoros" (bigPicture.sounds).
  useEffect(() => {
    let mounted = true
    window.api
      .getBigPicturePrefs()
      .then((result) => {
        if (!mounted) return
        const value = result.ok ? result.prefs.sounds : true
        setSounds(value)
        setSfxEnabled(value)
      })
      .catch(() => {
        if (mounted) setSounds(true)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  useEffect(
    () => () => {
      if (soundsFeedbackTimer.current) window.clearTimeout(soundsFeedbackTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    []
  )

  const handleToggleSounds = async (): Promise<void> => {
    if (sounds === null) return
    const next = !sounds
    setSounds(next)
    setSoundsFeedback(null)
    try {
      const result = await window.api.setBigPicturePrefs({ sounds: next })
      if (!result.ok) throw new Error(result.error ?? 'erro desconhecido')
      setSfxEnabled(next)
      setSoundsFeedback('saved')
    } catch (err) {
      console.error('[settings] Falha ao salvar preferência de sons:', err)
      // Reverte o toggle — o valor real continua sendo o persistido.
      setSounds(!next)
      setSoundsFeedback('error')
    } finally {
      if (soundsFeedbackTimer.current) window.clearTimeout(soundsFeedbackTimer.current)
      soundsFeedbackTimer.current = window.setTimeout(() => setSoundsFeedback(null), 2500)
    }
  }

  const openSetup = (): void => {
    setSetupInitial(config)
    setSetupOpen(true)
  }

  const handleRedoAuto = async (): Promise<void> => {
    setConfirmRedo(false)
    try {
      const result = await window.api.resetGamepadConfig()
      if (!result.ok) {
        showToast('Não foi possível apagar a configuração atual.')
        return
      }
      setConfig(null)
      setSetupInitial(null)
      setSetupOpen(true)
    } catch {
      showToast('Não foi possível apagar a configuração atual.')
    }
  }

  const handleErase = async (): Promise<void> => {
    setConfirmErase(false)
    try {
      const result = await window.api.resetGamepadConfig()
      if (!result.ok) {
        showToast('Não foi possível apagar a configuração.')
        return
      }
      setConfig(null)
      showToast('Configuração de controle apagada')
    } catch {
      showToast('Não foi possível apagar a configuração.')
    }
  }

  return (
    <>
      {/* Rótulo da seção (uppercase + hairline), coerente com as seções do modo normal */}
      <div className="mx-2 flex items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          Big Picture
        </h3>
        <span aria-hidden="true" className="h-px flex-1 bg-[var(--border-subtle)]" />
      </div>

      <motion.div {...entranceProps(reduced, { y: 20 })}>
        <Card className="p-6">
          {/* Título + descrição */}
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent shadow-elevation-1">
              <Gamepad2 size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink-primary">Modo Big Picture</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Interface em tela cheia otimizada para gamepad e TV — navegação, lançamento de jogos
                e controles do Hub.
              </p>
            </div>
          </div>

          {/* Status do controle */}
          <div
            className="mt-4 flex items-center gap-3 rounded-control border border-[var(--border-subtle)] bg-surface-2 px-4 py-3"
            role="status"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                config ? 'bg-success' : 'bg-ink-tertiary'
              }`}
            />
            <p className="min-w-0 text-xs leading-relaxed text-ink-secondary">
              {!configLoaded ? (
                'Lendo configuração…'
              ) : config ? (
                <>
                  Controle:{' '}
                  <span className="font-bold text-ink-primary">{config.controllerName}</span> ·
                  perfil{' '}
                  <span className="font-bold text-ink-primary">
                    {GAMEPAD_PROFILES[config.profile].label}
                  </span>{' '}
                  · configurado em {formatConfiguredDate(config.configuredAt)}
                </>
              ) : (
                'Nenhum controle configurado'
              )}
            </p>
          </div>

          {/* Ações */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={openSetup}>
              <SlidersHorizontal size={14} aria-hidden="true" />
              Configurar controle
            </Button>
            {config && (
              <>
                <Button variant="secondary" onClick={() => setConfirmRedo(true)}>
                  <RotateCcw size={14} aria-hidden="true" />
                  Refazer mapeamento automático
                </Button>
                <Button variant="danger" onClick={() => setConfirmErase(true)}>
                  <Trash2 size={14} aria-hidden="true" />
                  Apagar configuração
                </Button>
              </>
            )}
          </div>

          {/* Toggle: Efeitos sonoros */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-6 border-t border-[var(--border-subtle)] pt-5">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-muted text-accent shadow-elevation-1">
                <Volume2 size={20} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-ink-primary">Efeitos sonoros</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                  Sons de navegação, confirmação e erros no modo Big Picture.
                </p>
                {soundsFeedback === 'saved' && (
                  <Badge tone="success" className="mt-2">
                    <Check size={12} aria-hidden="true" /> Salvo
                  </Badge>
                )}
                {soundsFeedback === 'error' && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-danger">
                    Não foi possível salvar. Tente de novo.
                  </p>
                )}
              </div>
            </div>

            <Switch
              aria-label="Efeitos sonoros do Big Picture"
              checked={sounds === true}
              disabled={sounds === null}
              onCheckedChange={() => void handleToggleSounds()}
              className="shrink-0"
            />
          </div>
        </Card>
      </motion.div>

      {/* ── Overlay: fluxo de configuração (GamepadSetup) ── */}
      {setupOpen && (
        <GamepadSetup
          layout="overlay"
          initialConfig={setupInitial}
          onSaved={(cfg) => {
            setConfig(cfg)
            setSetupOpen(false)
            showToast('Configuração de controle salva')
          }}
          onClose={() => {
            setSetupOpen(false)
            // Fecha pode esconder um auto-save feito no passo de detecção —
            // relê a config para o status não ficar desatualizado.
            refreshConfig()
          }}
        />
      )}

      {/* ── Confirmação: apagar configuração ── */}
      {confirmErase && (
        <ConfirmDialog
          title="Apagar configuração?"
          message="O controle volta a não ter mapeamento — ao entrar no Big Picture, a configuração será solicitada de novo."
          confirmLabel="Apagar"
          onCancel={() => setConfirmErase(false)}
          onConfirm={() => void handleErase()}
        />
      )}

      {/* ── Confirmação: refazer mapeamento automático ── */}
      {confirmRedo && (
        <ConfirmDialog
          title="Refazer mapeamento automático?"
          message="O mapeamento atual será apagado e você vai pressionar qualquer botão para detectar tudo de novo."
          confirmLabel="Apagar e refazer"
          onCancel={() => setConfirmRedo(false)}
          onConfirm={() => void handleRedoAuto()}
        />
      )}

      {/* ── Toast local ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            {...entranceProps(reduced, { y: 20, scale: 0.95 })}
            exit={exitProps(reduced, { y: 10, scale: 0.95 })}
            role="status"
            className="fixed bottom-6 right-6 z-[80] flex max-w-md items-center gap-3 rounded-card border border-success-border bg-surface-3 px-5 py-4 shadow-elevation-3"
          >
            <BadgeCheck size={18} aria-hidden="true" className="shrink-0 text-success" />
            <p className="text-sm leading-relaxed text-ink-primary">{toast}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Diálogo de confirmação simples (destrutivo) — mesmo padrão visual dos overlays do Hub. */
function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm
}: {
  title: string
  message: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  // Prende o foco no diálogo destrutivo. Esc NÃO é ligado aqui de propósito:
  // o Big Picture trata Esc globalmente (volta/fecha overlay) e este diálogo é
  // invocado abaixo dele — interceptar Esc em dobro abriria a confirmação de saída.
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true })
  // Painel em surface-1 (não surface-3): o botão danger do 13.6 sobre surface-3
  // mede 3.75; sobre surface-1, 4.56 (AA para o rótulo 11px bold uppercase).

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />
      <div
        ref={trapRef}
        className="relative w-full max-w-md space-y-5 rounded-card border border-[var(--border-subtle)] bg-surface-1 p-6 text-center shadow-elevation-3"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-control border border-danger-border bg-danger-bg">
          <AlertCircle size={30} strokeWidth={1.5} aria-hidden="true" className="text-danger" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-ink-primary">{title}</h3>
          <p className="text-sm leading-relaxed text-ink-secondary">{message}</p>
        </div>
        <div className="flex justify-center gap-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <Trash2 size={14} aria-hidden="true" />
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
