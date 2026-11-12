// Seção "Controle" do Big Picture (T5) — visão geral do controle configurado
// e abertura do fluxo de configuração (GamepadSetup) para ajuste manual ou
// nova detecção automática. Substitui o placeholder estático da T3/T4.
//
// Os botões registram-se no foco espacial do Big Picture (useFocusable), então
// mouse, teclado de cortesia e gamepad navegam até eles. O GamepadSetup em si
// (passos de detecção/ajuste) é operável por mouse e teclado; a captura de
// botões dele é independente (ver GamepadSetup.tsx).

import { useCallback, useEffect, useState } from 'react'
import { Gamepad2, SlidersHorizontal, Radar } from 'lucide-react'
import { GAMEPAD_PROFILES } from '../lib/gamepad'
import type { GamepadConfig } from '../lib/gamepad'
import { useFocusable } from './BigPictureFocus'
import { GamepadSetup } from './GamepadSetup'

function formatConfiguredDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

type ControlsView = 'overview' | 'adjust' | 'detect'

interface BigPictureControlsProps {
  /** Toast local do Big Picture. */
  notify: (text: string) => void
}

export function BigPictureControls({ notify }: BigPictureControlsProps): JSX.Element {
  const [view, setView] = useState<ControlsView>('overview')
  const [config, setConfig] = useState<GamepadConfig | null>(null)
  const [loaded, setLoaded] = useState(false)

  const { ref: adjustRef, focused: adjustFocused, focus: focusAdjust } = useFocusable('control:adjust')
  const { ref: detectRef, focused: detectFocused, focus: focusDetect } = useFocusable('control:detect')

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
        if (mounted) setLoaded(true)
      })
    return (): void => {
      mounted = false
    }
  }, [])

  const handleSaved = useCallback(
    (cfg: GamepadConfig): void => {
      setConfig(cfg)
      setView('overview')
      notify('Configuração de controle salva')
    },
    [notify]
  )

  const refreshAndBack = useCallback((): void => {
    setView('overview')
    window.api
      .getGamepadConfig()
      .then((result) => setConfig(result.ok ? result.config : null))
      .catch(() => setConfig(null))
  }, [])

  if (view === 'adjust' && config) {
    return (
      <GamepadSetup
        layout="inline"
        initialConfig={config}
        onSaved={handleSaved}
        onClose={refreshAndBack}
      />
    )
  }

  if (view === 'detect') {
    // Sem initialConfig: começa na detecção ("Pressione qualquer botão…").
    // O mapeamento só é sobrescrito quando um botão é pressionado — cancelar
    // antes disso mantém a configuração existente intacta.
    return (
      <GamepadSetup
        layout="inline"
        initialConfig={null}
        onSaved={handleSaved}
        onClose={refreshAndBack}
      />
    )
  }

  return (
    <section
      aria-label="Controle"
      className="flex h-full flex-col items-center justify-center gap-8 text-center"
    >
      <div className="flex h-28 w-28 items-center justify-center rounded-[2rem] border border-neon-cyan/30 bg-neon-cyan/5 shadow-glow-cyan">
        <Gamepad2 size={56} strokeWidth={1.5} className="text-neon-cyan" />
      </div>

      <div className="space-y-3">
        <h2 className="text-4xl font-black tracking-tight text-white">Controle</h2>
        {!loaded ? (
          <p className="text-lg text-slate-400">Lendo configuração…</p>
        ) : config ? (
          <p className="max-w-xl text-lg leading-relaxed text-slate-300">
            <span className="font-bold text-white">{config.controllerName}</span>
            <br />
            Perfil {GAMEPAD_PROFILES[config.profile].label} · configurado em{' '}
            {formatConfiguredDate(config.configuredAt)}
          </p>
        ) : (
          <p className="max-w-xl text-lg leading-relaxed text-slate-400">
            Nenhum controle configurado — pressione qualquer botão do controle ou use o mouse.
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-4">
        {config && (
          <button
            ref={adjustRef}
            type="button"
            onClick={() => setView('adjust')}
            onMouseEnter={focusAdjust}
            onFocus={focusAdjust}
            className={`inline-flex items-center gap-3 rounded-2xl border px-8 py-5 text-xl font-bold tracking-tight transition-all duration-150 focus:outline-none ${
              adjustFocused
                ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan ring-4 ring-neon-cyan/40'
                : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]'
            }`}
          >
            <SlidersHorizontal size={24} strokeWidth={1.75} />
            Ajustar botões
          </button>
        )}
        <button
          ref={detectRef}
          type="button"
          onClick={() => setView('detect')}
          onMouseEnter={focusDetect}
          onFocus={focusDetect}
          className={`inline-flex items-center gap-3 rounded-2xl border px-8 py-5 text-xl font-bold tracking-tight transition-all duration-150 focus:outline-none ${
            detectFocused
              ? 'border-neon-purple/50 bg-neon-purple/10 text-neon-purple ring-4 ring-neon-purple/40'
              : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]'
          }`}
        >
          <Radar size={24} strokeWidth={1.75} />
          {config ? 'Refazer detecção automática' : 'Configurar controle'}
        </button>
      </div>

      <p className="text-xs 3xl:text-base font-medium uppercase tracking-widest text-slate-400">
        Esc volta · Esc no ajuste cancela a escuta de botão
      </p>
    </section>
  )
}
