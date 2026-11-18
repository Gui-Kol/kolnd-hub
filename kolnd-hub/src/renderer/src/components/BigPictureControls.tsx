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
import { useFocusable, BP_FOCUS_RING, BP_FOCUSED_RING } from './BigPictureFocus'
import { GamepadSetup } from './GamepadSetup'
import { announce, formatFocusItem } from '../lib/useAnnouncer'

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

  // Sem config, só existe o botão de detecção (item 1 de 1); com config,
  // "Ajustar botões" é 1 de 2 e "Refazer detecção" é 2 de 2.
  const actionTotal = config ? 2 : 1
  const {
    ref: adjustRef,
    focused: adjustFocused,
    focus: focusAdjust
  } = useFocusable('control:adjust', () =>
    formatFocusItem('Controle', 1, actionTotal, 'Ajustar botões')
  )
  const {
    ref: detectRef,
    focused: detectFocused,
    focus: focusDetect
  } = useFocusable('control:detect', () =>
    formatFocusItem(
      'Controle',
      config ? 2 : 1,
      actionTotal,
      config ? 'Refazer detecção automática' : 'Configurar controle'
    )
  )

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
      announce('Configuração de controle salva')
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
      {/* Card de perfil: ícone grande + nome + status da configuração */}
      <div className="flex w-full max-w-2xl flex-col items-center gap-6 rounded-card border border-[var(--border-subtle)] bg-surface-1 px-10 py-8 shadow-elevation-1 3xl:px-14 3xl:py-10">
        <div className="flex h-28 w-28 3xl:h-32 3xl:w-32 items-center justify-center rounded-card border border-[var(--border-subtle)] bg-surface-2">
          <Gamepad2
            size={56}
            strokeWidth={1.5}
            aria-hidden="true"
            className="text-accent 3xl:h-16 3xl:w-16"
          />
        </div>

        <div className="space-y-3">
          <h2 className="text-5xl font-black tracking-tight text-ink-primary">Controle</h2>
          <div className="flex max-w-xl items-start justify-center gap-3" role="status">
            <span
              aria-hidden="true"
              className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${
                loaded && config ? 'bg-success' : 'bg-ink-tertiary'
              }`}
            />
            {!loaded ? (
              <p className="text-lg text-ink-secondary">Lendo configuração…</p>
            ) : config ? (
              <p className="text-lg leading-relaxed text-ink-secondary">
                <span className="font-bold text-ink-primary">{config.controllerName}</span>
                <br />
                Perfil {GAMEPAD_PROFILES[config.profile].label} · configurado em{' '}
                {formatConfiguredDate(config.configuredAt)}
              </p>
            ) : (
              <p className="text-lg leading-relaxed text-ink-secondary">
                Nenhum controle configurado — pressione qualquer botão do controle ou use o mouse.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col items-stretch gap-4">
        {config && (
          <button
            ref={adjustRef}
            type="button"
            onClick={() => setView('adjust')}
            onMouseEnter={focusAdjust}
            onFocus={focusAdjust}
            className={`inline-flex min-h-[4rem] items-center justify-center gap-4 rounded-control border px-8 text-xl font-semibold tracking-tight transition-all duration-2 ease-standard cursor-pointer focus:outline-none ${BP_FOCUS_RING} ${
              adjustFocused
                ? `border-[var(--accent-border)] bg-accent-muted text-accent ${BP_FOCUSED_RING}`
                : 'border-[var(--border-subtle)] bg-surface-2 text-ink-primary hover:bg-surface-3'
            }`}
          >
            <SlidersHorizontal size={24} strokeWidth={1.75} aria-hidden="true" />
            Ajustar botões
          </button>
        )}
        <button
          ref={detectRef}
          type="button"
          onClick={() => setView('detect')}
          onMouseEnter={focusDetect}
          onFocus={focusDetect}
          className={`inline-flex min-h-[4rem] items-center justify-center gap-4 rounded-control border px-8 text-xl font-semibold tracking-tight transition-all duration-2 ease-standard cursor-pointer focus:outline-none ${BP_FOCUS_RING} ${
            detectFocused
              ? `border-[var(--accent-border)] bg-accent-muted text-accent ${BP_FOCUSED_RING}`
              : 'border-[var(--border-subtle)] bg-surface-2 text-ink-primary hover:bg-surface-3'
          }`}
        >
          <Radar size={24} strokeWidth={1.75} aria-hidden="true" />
          {config ? 'Refazer detecção automática' : 'Configurar controle'}
        </button>
      </div>

      <p className="text-xs 3xl:text-base font-medium uppercase tracking-widest text-ink-tertiary">
        Esc volta · Esc no ajuste cancela a escuta de botão
      </p>
    </section>
  )
}
