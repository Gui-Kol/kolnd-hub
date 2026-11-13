// Seção "Big Picture" das Configurações (T5) — status do controle,
// abertura do fluxo de configuração (GamepadSetup), "Efeitos sonoros"
// persistidos em `bigPicture.sounds` e ação destrutiva "Apagar configuração".
//
// O toggle segue o mesmo padrão do toggle "Iniciar Kloud Games" já existente
// nesta tela: role="switch", classe `.toggle-console`, feedback "Salvo"/"Erro".

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
import { GamepadSetup } from './GamepadSetup'

function formatConfiguredDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function BigPictureSettings(): JSX.Element {
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
      <p className="text-xs font-bold text-slate-600 uppercase tracking-widest mx-2">Big Picture</p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-2xl p-6 border-l-4 border-neon-cyan"
      >
        {/* Título + descrição */}
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neon-cyan/10 text-neon-cyan shadow-lg">
            <Gamepad2 size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white">Modo Big Picture</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Interface em tela cheia otimizada para gamepad e TV — navegação, lançamento de jogos e
              controles do Hub.
            </p>
          </div>
        </div>

        {/* Status do controle */}
        <div
          className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          role="status"
        >
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              config ? 'bg-emerald-400' : 'bg-slate-600'
            }`}
          />
          <p className="min-w-0 text-xs leading-relaxed text-slate-300">
            {!configLoaded ? (
              'Lendo configuração…'
            ) : config ? (
              <>
                Controle: <span className="font-bold text-white">{config.controllerName}</span> ·
                perfil{' '}
                <span className="font-bold text-white">
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
          <button type="button" className="btn-primary" onClick={openSetup}>
            <SlidersHorizontal size={14} />
            Configurar controle
          </button>
          {config && (
            <>
              <button type="button" className="btn-secondary" onClick={() => setConfirmRedo(true)}>
                <RotateCcw size={14} />
                Refazer mapeamento automático
              </button>
              <button type="button" className="btn-danger" onClick={() => setConfirmErase(true)}>
                <Trash2 size={14} />
                Apagar configuração
              </button>
            </>
          )}
        </div>

        {/* Toggle: Efeitos sonoros */}
        <div className="mt-5 flex items-center justify-between gap-6 flex-wrap border-t border-white/[0.06] pt-5">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-neon-cyan/10 text-neon-cyan shadow-lg">
              <Volume2 size={20} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-white">Efeitos sonoros</h4>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Sons de navegação, confirmação e erros no modo Big Picture.
              </p>
              {soundsFeedback === 'saved' && (
                <p className="mt-2 text-[11px] font-semibold text-emerald-400 flex items-center gap-1.5">
                  <Check size={12} /> Salvo
                </p>
              )}
              {soundsFeedback === 'error' && (
                <p className="mt-2 text-[11px] font-semibold text-red-400">
                  Não foi possível salvar. Tente de novo.
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={sounds === true}
            aria-label="Efeitos sonoros do Big Picture"
            disabled={sounds === null}
            onClick={() => void handleToggleSounds()}
            className={`toggle-console shrink-0 ${sounds === true ? 'toggle-console-checked' : ''} ${
              sounds === null ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <span className="toggle-console-knob" />
          </button>
        </div>
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
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            role="status"
            className="fixed bottom-6 right-6 z-[80] flex max-w-md items-center gap-3 rounded-2xl border border-emerald-500/25 bg-[#071510]/95 px-5 py-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
          >
            <BadgeCheck size={18} className="shrink-0 text-emerald-400" />
            <p className="text-sm leading-relaxed text-slate-100">{toast}</p>
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
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md space-y-5 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-6 text-center shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
          <AlertCircle size={30} strokeWidth={1.5} className="text-red-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <p className="text-sm leading-relaxed text-slate-400">{message}</p>
        </div>
        <div className="flex justify-center gap-3">
          <button type="button" className="btn-secondary" onClick={onCancel} autoFocus>
            Cancelar
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            <Trash2 size={14} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
