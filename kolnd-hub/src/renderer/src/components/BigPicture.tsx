import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { motion } from 'framer-motion'
import { LogOut, Mouse } from 'lucide-react'
import { BigPictureRail, BigPictureSection } from './BigPictureRail'
import { BigPictureGames } from './BigPictureGames'
import { BigPictureControls } from './BigPictureControls'
import { GamepadSetup } from './GamepadSetup'
import { BigPictureTransition, revealMaskStyle, REVEAL_FROM } from './BigPictureTransition'
import {
  BigPictureFocusProvider,
  useBigPictureFocus,
  useFocusable,
  BP_FOCUS_RING,
  BP_FOCUSED_RING
} from './BigPictureFocus'
import { OptionsOverlay, ExitOverlay, DisconnectOverlay } from './BigPictureOverlays'
import { fadeOnlyTransition, useReducedMotion } from '../lib/motion'
import { Button, Toast } from './ui'
import { useGamepad } from '../hooks/useGamepad'
import { playSfx, setSfxEnabled } from '../lib/sfx'
import { announce, formatFocusItem, useAnnouncer } from '../lib/useAnnouncer'
import type { GamepadAction, GamepadConfig } from '../lib/gamepad'

export type BigPictureMode = 'setup' | 'transitioning' | 'active'

interface BigPictureProps {
  /**
   * 'setup' = gate: sem controle configurado, exibe a configuração antes da home.
   * 'transitioning' = transição cinematográfica (T7) antes da home liberar.
   * 'active' = home pronta.
   */
  mode: BigPictureMode
  /** Sai do Big Picture: restaura a janela e devolve ao shell normal. */
  onExit: () => void
  /** Chamado quando o setup do gate é concluído (config persistida): entra direto na home. */
  onSetupComplete: () => void
  /** Fim da transição cinematográfica — o App troca o modo para 'active'. */
  onTransitionComplete?: () => void
}

const SECTION_ORDER: BigPictureSection[] = ['games', 'controls']
const SECTION_PREFIX: Record<BigPictureSection, string> = {
  games: 'game:',
  controls: 'control:'
}
const SECTION_LABEL: Record<BigPictureSection, string> = {
  games: 'Jogos',
  controls: 'Controle'
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Relógio HH:MM do canto superior direito — re-renderiza no máximo 1× por minuto. */
function useMinuteClock(): string {
  const [label, setLabel] = useState<string>(() => formatClock(new Date()))

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLabel((prev) => {
        const next = formatClock(new Date())
        return next === prev ? prev : next
      })
    }, 1000)
    return (): void => window.clearInterval(timer)
  }, [])

  return label
}

/**
 * Gate de primeira execução (T6) — exibido quando não há controle configurado.
 * Único caminho liberado no modo 'setup': a tela de configuração de controles
 * (GamepadSetup) + "Voltar ao Hub". O restante do Big Picture (rail/conteúdo)
 * nem é montado. Ao concluir o setup a home é liberada automaticamente; ao
 * cancelar, volta-se ao Hub. Esc é tratado pelo próprio GamepadSetup.
 */
const SetupView = memo(function SetupView({
  onComplete,
  onExit
}: {
  onComplete: () => void
  onExit: () => void
}): JSX.Element {
  return (
    <div className="relative flex h-full flex-col">
      {/* ── Cabeçalho amigável do gate ─────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-6 px-10 pt-8">
        <div className="max-w-2xl space-y-2">
          <p className="text-[10px] 3xl:text-base font-bold uppercase tracking-[0.35em] text-accent">
            Antes de usar o Big Picture…
          </p>
          <h1 className="text-4xl font-black tracking-tight text-ink-primary">
            Nenhum controle configurado
          </h1>
          <p className="text-lg leading-relaxed text-ink-secondary">
            Pressione qualquer botão do seu controle para detectar e configurar automaticamente — ou
            configure com o mouse.
          </p>
        </div>
        <Button
          variant="ghost"
          size="md"
          onClick={onExit}
          className={`!h-auto !min-h-[3.5rem] !px-6 !py-4 !text-xl !font-medium !normal-case !tracking-normal shrink-0 gap-2 ${BP_FOCUS_RING} focus:outline-none`}
        >
          <LogOut size={18} aria-hidden="true" />
          Voltar ao Hub
        </Button>
      </div>

      {/* ── Tela de configuração de controles (compartilhada com a T5) ── */}
      <div className="min-h-0 flex-1 px-6 pb-6 pt-2 sm:px-10">
        <GamepadSetup layout="inline" onSaved={() => onComplete()} onClose={onExit} />
      </div>
    </div>
  )
})

/** Noop estável para o useGamepad enquanto a home ainda não pode receber input
 * (transição T7 em andamento) — o loop continua publicando `connected`, mas
 * nenhuma ação semântica é disparada. */
const noopGamepadAction = (): void => undefined

/**
 * Botão de canto (mockup aprovado do Big Picture): atalho visível, no canto
 * inferior direito, das ações que o controle dispara com B (Voltar ao Hub) e
 * Menu (Opções). Ghost grande, alvo 10-foot; registrado no spatialNav como
 * `corner:*` e anunciado no leitor de tela via formatFocusItem.
 */
const CornerButton = memo(function CornerButton({
  id,
  hint,
  label,
  onActivate,
  position,
  total
}: {
  id: string
  /** Tecla/botão do gamepad que dispara a mesma ação (mostrado como chip). */
  hint: string
  label: string
  onActivate: () => void
  position: number
  total: number
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id, () =>
    formatFocusItem('Big Picture', position, total, label)
  )
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="md"
      onClick={onActivate}
      onMouseEnter={focus}
      onFocus={focus}
      className={`!h-11 !px-4 !text-[13px] !font-semibold !normal-case !tracking-normal gap-2.5 ${
        focused ? `${BP_FOCUSED_RING} bg-surface-2 text-ink-primary` : ''
      } ${BP_FOCUS_RING} focus:outline-none`}
    >
      <kbd
        aria-hidden="true"
        className="rounded-sm border border-[var(--border-strong)] bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-ink-tertiary"
      >
        {hint}
      </kbd>
      <span>{label}</span>
    </Button>
  )
})

interface ActiveViewProps {
  onExit: () => void
  /** false durante a transição (T7): nenhum input de controle/teclado age na home. */
  inputEnabled?: boolean
}

function ActiveView({ onExit, inputEnabled = true }: ActiveViewProps): JSX.Element {
  const [section, setSectionState] = useState<BigPictureSection>('games')
  const [overlay, setOverlay] = useState<'options' | 'exit' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [config, setConfig] = useState<GamepadConfig | null>(null)
  const [configResolved, setConfigResolved] = useState(false)
  const historyRef = useRef<BigPictureSection[]>([])
  const clock = useMinuteClock()

  const {
    focusedId,
    setFocusedId,
    moveFocus,
    activateFocused,
    setFocusScope,
    focusFirstMatching,
    describeId
  } = useBigPictureFocus()

  const notify = useCallback((text: string): void => {
    setToast(text)
  }, [])

  // Handler estável para o primitivo Toast (auto-dismiss não rearma a cada render).
  const closeToast = useCallback((): void => setToast(null), [])

  // Config do controle + toggle de efeitos sonoros, lidos uma vez do store (T2).
  useEffect(() => {
    let cancelled = false
    void window.api
      .getGamepadConfig()
      .then((result) => {
        if (!cancelled) setConfig(result.ok ? result.config : null)
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
      .finally(() => {
        if (!cancelled) setConfigResolved(true)
      })
    void window.api
      .getBigPicturePrefs()
      .then((result) => setSfxEnabled(result.ok ? result.prefs.sounds : true))
      .catch(() => setSfxEnabled(true))
    return (): void => {
      cancelled = true
    }
  }, [])

  /** Foca o primeiro focável da área de conteúdo (fallback: item do rail). */
  const focusSectionFirst = useCallback(
    (target: BigPictureSection): void => {
      const prefix = SECTION_PREFIX[target]
      // Espera o commit (refs registram durante ele) para mirar o primeiro item.
      requestAnimationFrame(() => {
        if (!focusFirstMatching(prefix)) {
          // Área vazia (ou biblioteca ainda carregando): foca o item do rail
          // da seção para não abrir sem nenhum foco visível.
          setFocusedId(`rail:${target}`)
        }
      })
    },
    [focusFirstMatching, setFocusedId]
  )

  // Foco inicial ao entrar no Big Picture.
  const didInitialFocus = useRef(false)
  useEffect(() => {
    if (didInitialFocus.current) return
    didInitialFocus.current = true
    focusSectionFirst('games')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Anúncios para leitor de tela ─────────────────────
  // Mudança de seção anuncia "Seção: X" — pulada na montagem (a entrada
  // anuncia "Modo Big Picture"). Declarada ANTES do efeito de foco: quando os
  // dois disparam no mesmo commit, o anúncio de foco (mais específico)
  // substitui o de seção no debounce.
  const skipInitialSectionAnnounce = useRef(true)
  useEffect(() => {
    if (skipInitialSectionAnnounce.current) {
      skipInitialSectionAnnounce.current = false
      return
    }
    announce(`Seção: ${SECTION_LABEL[section]}`)
  }, [section])

  // Cada mudança de foco (gamepad, teclado ou mouse) anuncia o item focado
  // via descritor registrado pelo componente dono do id. Na montagem o foco
  // inicial é pulado — a fala de entrada ("Modo Big Picture") já cobre o
  // contexto, e o debounce de substituição descartaria uma das duas.
  const skipInitialFocusAnnounce = useRef(true)
  useEffect(() => {
    if (!focusedId) return
    if (skipInitialFocusAnnounce.current) {
      skipInitialFocusAnnounce.current = false
      return
    }
    const description = describeId(focusedId)
    if (description) announce(description)
  }, [focusedId, describeId])

  const goToSection = useCallback(
    (next: BigPictureSection): void => {
      setSectionState((prev) => {
        if (prev !== next) {
          historyRef.current.push(prev)
          if (historyRef.current.length > 10) historyRef.current.shift()
        }
        return next
      })
      focusSectionFirst(next)
    },
    [focusSectionFirst]
  )

  const cycleSection = useCallback(
    (direction: 1 | -1): void => {
      const index = SECTION_ORDER.indexOf(section)
      const next = SECTION_ORDER[(index + direction + SECTION_ORDER.length) % SECTION_ORDER.length]
      if (!next || next === section) return
      // LB/RB são atalhos: não poluem o histórico de "voltar".
      setSectionState(next)
      playSfx('move')
      focusSectionFirst(next)
    },
    [section, focusSectionFirst]
  )

  const closeOverlay = useCallback((): void => {
    setOverlay(null)
    setFocusScope(null)
    focusSectionFirst(section)
  }, [section, setFocusScope, focusSectionFirst])

  const openExitOverlay = useCallback((): void => {
    setOverlay('exit')
    setFocusScope('exit:')
    // Foco padrão no caminho seguro (Continuar no Big Picture).
    setFocusedId('exit:cancel')
  }, [setFocusScope, setFocusedId])

  const openOptionsOverlay = useCallback((): void => {
    setOverlay('options')
    setFocusScope('options:')
    setFocusedId('options:controls')
  }, [setFocusScope, setFocusedId])

  const openControlsSection = useCallback((): void => {
    closeOverlay()
    goToSection('controls')
  }, [closeOverlay, goToSection])

  const confirmExit = useCallback((): void => {
    setFocusScope(null)
    onExit()
  }, [setFocusScope, onExit])

  const goBack = useCallback((): void => {
    if (overlay) {
      playSfx('back')
      closeOverlay()
      return
    }
    const stack = historyRef.current
    const previous = stack.pop()
    if (previous) {
      playSfx('back')
      setSectionState(previous)
      focusSectionFirst(previous)
      return
    }
    // Raiz: pede confirmação de saída.
    playSfx('back')
    openExitOverlay()
  }, [overlay, closeOverlay, focusSectionFirst, openExitOverlay])

  const handleAction = useCallback(
    (action: GamepadAction): void => {
      // ── Overlays: navegação confinada aos botões do diálogo ──
      if (overlay) {
        const pair =
          overlay === 'exit'
            ? (['exit:cancel', 'exit:quit'] as const)
            : (['options:controls', 'options:quit'] as const)
        if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
          setFocusedId(focusedId === pair[0] ? pair[1] : pair[0])
          playSfx('move')
          return
        }
        if (action === 'confirm') {
          playSfx('confirm')
          activateFocused()
          return
        }
        if (action === 'back' || action === 'menu' || action === 'options') {
          playSfx('back')
          closeOverlay()
          return
        }
        return
      }

      // ── Navegação principal ──────────────────────────
      switch (action) {
        case 'up':
          if (moveFocus('up')) playSfx('move')
          return
        case 'down':
          if (moveFocus('down')) playSfx('move')
          return
        case 'left':
          if (moveFocus('left')) playSfx('move')
          return
        case 'right':
          if (moveFocus('right')) playSfx('move')
          return
        case 'confirm':
          playSfx('confirm')
          activateFocused()
          return
        case 'back':
          goBack()
          return
        case 'tab_prev':
          cycleSection(-1)
          return
        case 'tab_next':
          cycleSection(1)
          return
        case 'menu':
          openOptionsOverlay()
          return
        default:
          return
      }
    },
    [
      overlay,
      focusedId,
      setFocusedId,
      activateFocused,
      moveFocus,
      goBack,
      cycleSection,
      openOptionsOverlay,
      closeOverlay
    ]
  )

  const { connected, padId } = useGamepad({
    config: configResolved ? config : null,
    onAction: inputEnabled ? handleAction : noopGamepadAction
  })

  // Já houve um controle conectado nesta sessão do Big Picture? Decide entre
  // overlay bloqueante ("Controle desconectado") e dica discreta (nunca houve).
  const [hadConnection, setHadConnection] = useState(false)
  if (connected && !hadConnection) {
    setHadConnection(true)
  }

  // Aviso não-bloqueante quando o pad reconectado é de outro modelo (o
  // mapeamento salvo é posicional e continua válido, mas os rótulos mudam).
  const warnedPadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!connected || !padId || !config) return
    if (padId === config.controllerId) {
      warnedPadRef.current = null
      return
    }
    if (warnedPadRef.current === padId) return
    warnedPadRef.current = padId
    notify(
      'Controle diferente detectado — os botões podem ter rótulos diferentes. Revise em Configurações → Big Picture.'
    )
  }, [connected, padId, config, notify])

  // Mouse parado por MOUSE_IDLE_MS → dica discreta para quem não tem controle.
  // Qualquer movimento/clique reinicia a contagem e esconde a dica na hora.
  const [mouseIdle, setMouseIdle] = useState(false)
  useEffect(() => {
    const MOUSE_IDLE_MS = 6000
    let timer: number | null = null
    const arm = (): void => {
      setMouseIdle(false)
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => setMouseIdle(true), MOUSE_IDLE_MS)
    }
    arm()
    window.addEventListener('mousemove', arm, { passive: true })
    window.addEventListener('mousedown', arm, { passive: true })
    window.addEventListener('wheel', arm, { passive: true })
    return (): void => {
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('mousemove', arm)
      window.removeEventListener('mousedown', arm)
      window.removeEventListener('wheel', arm)
    }
  }, [])

  // Indicador de conexão: some sozinho 3 s após (re)conectar; offline fica fixo.
  // (Ajuste de estado durante o render — padrão oficial "you might not need an
  // effect" — para zerar o "já sumiu" a cada mudança de conexão.)
  const [prevConnected, setPrevConnected] = useState(connected)
  const [badgeDismissed, setBadgeDismissed] = useState(false)
  if (connected !== prevConnected) {
    setPrevConnected(connected)
    setBadgeDismissed(false)
  }
  useEffect(() => {
    if (!connected || badgeDismissed) return
    const timer = window.setTimeout((): void => setBadgeDismissed(true), 3000)
    return (): void => window.clearTimeout(timer)
  }, [connected, badgeDismissed])
  const connectionVisible = !connected || !badgeDismissed

  // ── Teclado de cortesia: mesma semântica do controle ──
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined)
  useEffect(() => {
    keyHandlerRef.current = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          if (moveFocus('up')) playSfx('move')
          return
        case 'ArrowDown':
          event.preventDefault()
          if (moveFocus('down')) playSfx('move')
          return
        case 'ArrowLeft':
          event.preventDefault()
          if (moveFocus('left')) playSfx('move')
          return
        case 'ArrowRight':
          event.preventDefault()
          if (moveFocus('right')) playSfx('move')
          return
        case 'Enter':
          event.preventDefault()
          playSfx('confirm')
          activateFocused()
          return
        case 'Escape':
          event.preventDefault()
          goBack()
          return
        default:
          return
      }
    }
  })
  useEffect(() => {
    if (!inputEnabled) return undefined
    const listener = (event: KeyboardEvent): void => keyHandlerRef.current(event)
    window.addEventListener('keydown', listener)
    return (): void => window.removeEventListener('keydown', listener)
  }, [inputEnabled])

  return (
    <div className="relative flex h-full">
      {/* ── Rail de navegação ─────────────────────── */}
      <BigPictureRail
        section={section}
        onSelectSection={goToSection}
        onExit={openExitOverlay}
        connection={{ connected, visible: connectionVisible }}
      />

      {/* ── Área de conteúdo ──────────────────────── */}
      <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-8 xl:px-12 xl:py-10">
        {/* Relógio do canto superior direito (toque "console") */}
        <div className="pointer-events-none absolute top-8 right-12 text-right">
          <p className="tnum text-4xl 3xl:text-5xl font-bold leading-none tracking-tight text-ink-primary">
            {clock}
          </p>
          <p className="mt-1.5 text-[10px] 3xl:text-base font-bold uppercase tracking-[0.35em] text-ink-tertiary">
            Kolnd Hub
          </p>
        </div>

        <div className="h-full pt-2">
          {section === 'games' && <BigPictureGames notify={notify} />}
          {section === 'controls' && <BigPictureControls notify={notify} />}
        </div>
      </main>

      {/* ── Botões de canto (atalhos de B / Menu — mockup aprovado) ── */}
      <div
        className="absolute bottom-5 right-6 z-[35] flex items-center gap-2"
        role="group"
        aria-label="Ações do Big Picture"
      >
        <CornerButton
          id="corner:back"
          hint="B"
          label="Voltar ao Hub"
          onActivate={openExitOverlay}
          position={1}
          total={2}
        />
        <CornerButton
          id="corner:options"
          hint="Menu"
          label="Opções"
          onActivate={openOptionsOverlay}
          position={2}
          total={2}
        />
      </div>

      {/* ── Overlay: controle desconectado no meio da sessão (não bloqueia o mouse) ── */}
      {configResolved && hadConnection && !connected && <DisconnectOverlay />}

      {/* ── Dica discreta: nunca houve controle e o mouse parou ── */}
      {configResolved && !hadConnection && !connected && mouseIdle && (
        <div
          className="pointer-events-none absolute bottom-5 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-2.5 rounded-pill border border-[var(--border-subtle)] bg-surface-3 px-5 py-2"
          role="status"
          aria-atomic="true"
        >
          <Mouse size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
          <p className="text-xs 3xl:text-base font-medium text-ink-secondary">
            Conecte um controle para navegação por botão
          </p>
        </div>
      )}

      {/* ── Overlays (confinam a navegação ao diálogo) ─── */}
      {overlay === 'options' && (
        <OptionsOverlay
          onOpenControls={openControlsSection}
          onQuit={openExitOverlay}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'exit' && <ExitOverlay onCancel={closeOverlay} onConfirm={confirmExit} />}

      {/* ── Toast local do Big Picture (primitivo ui/Toast; kind info, 5 s) ── */}
      {toast && (
        <Toast
          kind="info"
          message={toast}
          onClose={closeToast}
          duration={5000}
          className="!bottom-24"
        />
      )}
    </div>
  )
}

/** Fundo do Big Picture — quase plano (quase-preto azulado, mesma linguagem do
 * modo normal: bg-base → bg-sunken) + vinheta fria sutil (≤ 8%, cor de
 * --shadow-*). Sem orbs/glows, sem scanlines (removidas com aprovação no gate
 * 13.2/13.17). Alvo da máscara radial de revelação na transição (T7):
 * `maskRadiusPx === null` → sem máscara. */
const BigPictureBackdrop = memo(function BigPictureBackdrop({
  refProp,
  maskRadiusPx
}: {
  refProp?: Ref<HTMLDivElement>
  maskRadiusPx: number | null
}): JSX.Element {
  return (
    <div
      ref={refProp}
      aria-hidden="true"
      className="absolute inset-0 z-0 overflow-hidden"
      // Máscara controlada via estilo direto pelo rAF da transição (ver T7);
      // o valor inicial apenas garante o estado antes do primeiro frame.
      style={{
        background:
          'radial-gradient(ellipse at center, transparent 55%, rgba(2, 8, 16, 0.08) 100%), linear-gradient(180deg, var(--bg-base) 0%, var(--bg-sunken) 100%)',
        ...revealMaskStyle(maskRadiusPx)
      }}
    />
  )
})

/** Saída: fade curto (~200 ms) de volta ao Hub — a animação cinematográfica
 * (T7) é exclusiva da entrada. */
const EXIT_FADE_MS = 200

export function BigPicture({
  mode,
  onExit,
  onSetupComplete,
  onTransitionComplete
}: BigPictureProps): JSX.Element {
  const isTransitioning = mode === 'transitioning'
  // Reveal decorativo da home vira fade curto com reduce.
  const reduced = useReducedMotion()
  // Home montada por baixo da transição (fase 6) e invisível até a fase 7.
  const [ready, setReady] = useState<boolean>(() => mode !== 'transitioning')
  const [leaving, setLeaving] = useState(false)
  const backgroundRef = useRef<HTMLDivElement>(null)
  const leaveTimerRef = useRef<number | null>(null)
  // Fala da região aria-live do Big Picture (sr-only, no contêiner).
  const announcement = useAnnouncer()

  // Quando o App troca para 'active' após a transição, garante home liberada.
  // (Ajuste de estado durante o render — padrão oficial "you might not need an
  // effect" — evita cascata e espelha o padrão usado no indicador de conexão.)
  const [prevMode, setPrevMode] = useState(mode)
  if (mode !== prevMode) {
    setPrevMode(mode)
    if (mode === 'active') setReady(true)
  }

  useEffect(
    () => (): void => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    },
    []
  )

  // Entrada no modo (montagem ou setup concluído → home liberada). Pulada
  // durante a transição cinematográfica — anuncia quando o modo muda de fato.
  useEffect(() => {
    if (mode !== 'transitioning') announce('Modo Big Picture')
  }, [mode])

  const handleExit = useCallback((): void => {
    // A região live ainda está montada neste momento — best effort para o
    // leitor de tela anunciar a saída antes do desmonte do modo.
    announce('Saindo do Modo Big Picture')
    setLeaving(true)
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = window.setTimeout(() => onExit(), EXIT_FADE_MS)
  }, [onExit])

  return (
    <BigPictureFocusProvider>
      {/* Base escura (visível antes/durante a revelação do fundo pela onda) */}
      <motion.div
        className={`fixed inset-0 z-50 overflow-hidden bg-surface-sunken text-ink-primary ${
          leaving ? 'pointer-events-none' : ''
        }`}
        initial={false}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: EXIT_FADE_MS / 1000, ease: 'easeIn' }}
      >
        {/* ── Região aria-live única dos anúncios do Big Picture (sr-only) ── */}
        {/* Cobre home, setup (GamepadSetup) e overlays — texto substituído,
            nunca enfileirado (ver lib/useAnnouncer). */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        {/* ── Fundo do Big Picture — revelado pela máscara radial (T7) ── */}
        <BigPictureBackdrop
          refProp={backgroundRef}
          maskRadiusPx={isTransitioning ? REVEAL_FROM : null}
        />

        {mode === 'setup' ? (
          <div className="relative z-10 h-full">
            <SetupView onComplete={onSetupComplete} onExit={handleExit} />
          </div>
        ) : (
          /* ── Home do Big Picture — montada durante a transição, oculta até a fase 7 ── */
          <motion.div
            className={`absolute inset-0 z-10 ${ready && !leaving ? '' : 'pointer-events-none select-none'}`}
            initial={false}
            animate={
              reduced
                ? { opacity: ready ? 1 : 0 }
                : ready
                  ? { opacity: 1, y: 0 }
                  : { opacity: 0, y: 24 }
            }
            transition={reduced ? fadeOnlyTransition : { duration: 0.4, ease: 'easeOut' }}
            style={{ visibility: ready ? 'visible' : 'hidden' }}
          >
            <ActiveView onExit={handleExit} inputEnabled={ready && !leaving} />
          </motion.div>
        )}

        {/* ── Transição cinematográfica (T7): overlay + canvas acima de tudo ── */}
        {isTransitioning && (
          <BigPictureTransition
            backgroundRef={backgroundRef}
            onHomeReveal={() => setReady(true)}
            onComplete={() => onTransitionComplete?.()}
          />
        )}
      </motion.div>
    </BigPictureFocusProvider>
  )
}
