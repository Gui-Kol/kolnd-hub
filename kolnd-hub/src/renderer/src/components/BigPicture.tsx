import { useCallback, useEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gamepad2, Gamepad, LogOut, X, Mouse, Undo2, Loader2 } from 'lucide-react'
import { BigPictureRail, BigPictureSection } from './BigPictureRail'
import { BigPictureGames } from './BigPictureGames'
import { BigPictureControls } from './BigPictureControls'
import { GamepadSetup } from './GamepadSetup'
import { BigPictureTransition, revealMaskStyle, REVEAL_FROM } from './BigPictureTransition'
import {
  BigPictureFocusProvider,
  useBigPictureFocus,
  useFocusable
} from './BigPictureFocus'
import { useGamepad } from '../hooks/useGamepad'
import { playSfx, setSfxEnabled } from '../lib/sfx'
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

interface Toast {
  id: number
  text: string
}

const SECTION_ORDER: BigPictureSection[] = ['games', 'controls']
const SECTION_PREFIX: Record<BigPictureSection, string> = {
  games: 'game:',
  controls: 'control:'
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
function SetupView({
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
          <p className="text-[10px] 3xl:text-base font-bold uppercase tracking-[0.35em] text-neon-cyan">
            Antes de usar o Big Picture…
          </p>
          <h1 className="text-4xl font-black tracking-tight text-white">
            Nenhum controle configurado
          </h1>
          <p className="text-lg leading-relaxed text-slate-400">
            Pressione qualquer botão do seu controle para detectar e configurar automaticamente —
            ou configure com o mouse.
          </p>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="btn-ghost shrink-0 !px-6 !py-4 !text-xl min-h-[3.5rem] focus:outline-none focus-visible:ring-4 focus-visible:ring-neon-cyan/70"
        >
          <LogOut size={18} />
          Voltar ao Hub
        </button>
      </div>

      {/* ── Tela de configuração de controles (compartilhada com a T5) ── */}
      <div className="min-h-0 flex-1 px-6 pb-6 pt-2 sm:px-10">
        <GamepadSetup
          layout="inline"
          onSaved={() => onComplete()}
          onClose={onExit}
        />
      </div>
    </div>
  )
}

/** Botão de overlay — mesma anatomia do foco (mouse = gamepad = teclado). */
function OverlayButton({
  id,
  icon: Icon,
  label,
  danger,
  onClick
}: {
  id: string
  icon: typeof LogOut
  label: string
  danger?: boolean
  onClick: () => void
}): JSX.Element {
  const { ref, focused, focus } = useFocusable(id)

  const palette = danger
    ? focused
      ? 'border-red-400/60 bg-red-500/15 text-red-200 ring-4 ring-red-400/50'
      : 'border-red-500/25 bg-red-500/5 text-red-300 hover:bg-red-500/10'
    : focused
      ? 'border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan ring-4 ring-neon-cyan/40'
      : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]'

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={focus}
      onFocus={focus}
      className={`flex w-full items-center gap-4 rounded-2xl border px-6 py-5 text-xl font-semibold tracking-tight transition-all duration-150 focus:outline-none ${palette}`}
    >
      <Icon size={24} strokeWidth={1.75} className="shrink-0" />
      <span className="min-w-0">{label}</span>
    </button>
  )
}

/** Overlay "Opções" (Start/Menu): configuração de controle ou sair. */
function OptionsOverlay({
  onOpenControls,
  onQuit,
  onClose
}: {
  onOpenControls: () => void
  onQuit: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Opções do Big Picture"
      onClick={onClose}
    >
      <div
        className="w-[30rem] max-w-[90vw] space-y-4 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-6 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="px-1 text-xs font-bold uppercase tracking-[0.3em] text-slate-500">
          Opções
        </h2>
        <OverlayButton
          id="options:controls"
          icon={Gamepad}
          label="Configuração de controle"
          onClick={onOpenControls}
        />
        <OverlayButton
          id="options:quit"
          icon={LogOut}
          label="Sair do Big Picture"
          danger
          onClick={onQuit}
        />
        <p className="px-1 pt-1 text-[11px] 3xl:text-base font-medium uppercase tracking-widest text-slate-400">
          Esc também fecha
        </p>
      </div>
    </div>
  )
}

/** Confirmação de saída ("B" na raiz, Esc, ou item do rail). */
function ExitOverlay({
  onCancel,
  onConfirm
}: {
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element {
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sair do Big Picture?"
      onClick={onCancel}
    >
      <div
        className="w-[32rem] max-w-[90vw] space-y-6 rounded-3xl border border-white/[0.08] bg-[#0d0d14]/95 p-8 text-center shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10">
          <LogOut size={36} strokeWidth={1.5} className="text-red-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-3xl font-black tracking-tight text-white">Sair do Big Picture?</h2>
          <p className="text-base leading-relaxed text-slate-400">
            Você voltará ao Hub normal. Nada será fechado — seus programas e a bandeja
            continuam exatamente como estão.
          </p>
        </div>
        <div className="flex gap-3">
          <OverlayButton
            id="exit:cancel"
            icon={Undo2}
            label="Continuar no Big Picture"
            onClick={onCancel}
          />
          <OverlayButton
            id="exit:quit"
            icon={LogOut}
            label="Sair do Big Picture"
            danger
            onClick={onConfirm}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Overlay de "Controle desconectado" (T8) — exibido quando o controle some no
 * meio da sessão. Não-bloqueante para o mouse (pointer-events-none em tudo):
 * o rail e a grade seguem clicáveis por trás, enquanto o gamepad fica inerte
 * por construção (sem pad, nenhuma ação dispara). Some sozinho ao reconectar.
 */
function DisconnectOverlay(): JSX.Element {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[56] flex items-center justify-center"
      role="alertdialog"
      aria-live="assertive"
      aria-label="Controle desconectado"
    >
      <div className="flex max-w-lg flex-col items-center gap-5 rounded-3xl border border-white/[0.1] bg-[#0d0d14]/90 px-12 py-10 text-center shadow-2xl shadow-black/70 backdrop-blur-xl">
        <Loader2 size={44} strokeWidth={1.75} className="animate-spin text-neon-cyan" aria-hidden="true" />
        <h2 className="text-3xl font-black tracking-tight text-white">Controle desconectado</h2>
        <p className="text-lg leading-relaxed text-slate-300">
          Reconecte o controle ou use o mouse
        </p>
      </div>
    </div>
  )
}

/** Noop estável para o useGamepad enquanto a home ainda não pode receber input
 * (transição T7 em andamento) — o loop continua publicando `connected`, mas
 * nenhuma ação semântica é disparada. */
const noopGamepadAction = (): void => undefined

interface ActiveViewProps {
  onExit: () => void
  /** false durante a transição (T7): nenhum input de controle/teclado age na home. */
  inputEnabled?: boolean
}

function ActiveView({
  onExit,
  inputEnabled = true
}: ActiveViewProps): JSX.Element {
  const [section, setSectionState] = useState<BigPictureSection>('games')
  const [overlay, setOverlay] = useState<'options' | 'exit' | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
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
    focusFirstMatching
  } = useBigPictureFocus()

  const notify = useCallback((text: string): void => {
    setToast({ id: Date.now(), text })
  }, [])

  // Auto-dismiss do toast local.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 5000)
    return (): void => window.clearTimeout(timer)
  }, [toast])

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
      const next =
        SECTION_ORDER[(index + direction + SECTION_ORDER.length) % SECTION_ORDER.length]
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
          overlay === 'exit' ? (['exit:cancel', 'exit:quit'] as const) : (['options:controls', 'options:quit'] as const)
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
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
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
          <p className="text-3xl 3xl:text-5xl font-light tabular-nums tracking-wider text-white/90">
            {clock}
          </p>
          <p className="mt-1 text-[10px] 3xl:text-base font-bold uppercase tracking-[0.35em] text-slate-400">
            Kolnd Hub
          </p>
        </div>

        <div className="h-full pt-2">
          {section === 'games' && <BigPictureGames notify={notify} />}
          {section === 'controls' && <BigPictureControls notify={notify} />}
        </div>
      </main>

      {/* ── Overlay: controle desconectado no meio da sessão (não bloqueia o mouse) ── */}
      {configResolved && hadConnection && !connected && <DisconnectOverlay />}

      {/* ── Dica discreta: nunca houve controle e o mouse parou ── */}
      {configResolved && !hadConnection && !connected && mouseIdle && (
        <div
          className="pointer-events-none absolute bottom-5 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/[0.08] bg-black/60 px-5 py-2 backdrop-blur-md"
          role="status"
        >
          <Mouse size={14} className="shrink-0 text-slate-400" aria-hidden="true" />
          <p className="text-xs 3xl:text-base font-medium text-slate-400">
            Conecte um controle para navegação por botão
          </p>
        </div>
      )}

      {/* ── Overlays (confinam a navegação ao diálogo) ─── */}
      {overlay === 'options' && (
        <OptionsOverlay
          onOpenControls={() => {
            closeOverlay()
            goToSection('controls')
          }}
          onQuit={openExitOverlay}
          onClose={closeOverlay}
        />
      )}
      {overlay === 'exit' && (
        <ExitOverlay
          onCancel={closeOverlay}
          onConfirm={() => {
            setFocusScope(null)
            onExit()
          }}
        />
      )}

      {/* ── Toast local do Big Picture ─────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="fixed bottom-8 right-8 z-[70] flex max-w-md items-start gap-3 rounded-2xl border border-neon-cyan/25 bg-[#050f14]/95 px-5 py-4 shadow-2xl shadow-black/60 backdrop-blur-xl"
            role="status"
          >
            <Gamepad2 size={18} className="mt-0.5 shrink-0 text-neon-cyan" />
            <p className="text-sm leading-relaxed text-slate-100">{toast.text}</p>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-2 shrink-0 flex h-12 w-12 items-center justify-center rounded-xl text-slate-500 transition-colors hover:text-white focus:outline-none focus-visible:ring-4 focus-visible:ring-neon-cyan/70"
              aria-label="Fechar aviso"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Fundo do Big Picture (gradiente + glows + scanlines) — alvo da máscara radial
 * de revelação na transição (T7). `maskRadiusPx === null` → sem máscara. */
function BigPictureBackdrop({
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
      className="absolute inset-0 z-0 overflow-hidden bg-gradient-gaming"
      // Máscara controlada via estilo direto pelo rAF da transição (ver T7);
      // o valor inicial apenas garante o estado antes do primeiro frame.
      style={revealMaskStyle(maskRadiusPx)}
    >
      {/* ── Glows radiais de fundo (orbs desfocados) ─── */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[36rem] w-[36rem] rounded-full bg-kloud-500/15 blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-48 h-[44rem] w-[44rem] rounded-full bg-neon-purple/15 blur-[170px]" />
      <div className="pointer-events-none absolute top-1/4 right-1/4 h-96 w-96 rounded-full bg-neon-cyan/10 blur-[130px]" />
      {/* ── Scanlines (efeito arcade/console) ─────────── */}
      <div className="scanlines" />
    </div>
  )
}

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
  // Home montada por baixo da transição (fase 6) e invisível até a fase 7.
  const [ready, setReady] = useState<boolean>(() => mode !== 'transitioning')
  const [leaving, setLeaving] = useState(false)
  const backgroundRef = useRef<HTMLDivElement>(null)
  const leaveTimerRef = useRef<number | null>(null)

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

  const handleExit = useCallback((): void => {
    setLeaving(true)
    if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = window.setTimeout(() => onExit(), EXIT_FADE_MS)
  }, [onExit])

  return (
    <BigPictureFocusProvider>
      {/* Base escura (visível antes/durante a revelação do fundo pela onda) */}
      <motion.div
        className={`fixed inset-0 z-50 overflow-hidden bg-[#050508] text-slate-200 ${
          leaving ? 'pointer-events-none' : ''
        }`}
        initial={false}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={{ duration: EXIT_FADE_MS / 1000, ease: 'easeIn' }}
      >
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
            animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            style={{ visibility: ready ? 'visible' : 'hidden' }}
          >
            <ActiveView
              onExit={handleExit}
              inputEnabled={ready && !leaving}
            />
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
