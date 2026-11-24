// GamepadSetup — fluxo de configuração de controle do modo Big Picture (T5).
//
// Tela compartilhada por três pontos de entrada:
//   1. Configurações → Big Picture → "Configurar controle" (layout 'overlay')
//   2. Big Picture → seção "Controle" (layout 'inline')
//   3. Gate de primeira execução (T6, layout 'inline' com cabeçalho próprio)
//
// Passos:
//   1. detect — "Pressione qualquer botão do controle" (detecção + auto-mapping)
//   2. review — resumo do controle detectado + os 12 mapeamentos
//   3. manual — ajuste fino por ação (remapear, conflito, restaurar padrão)
//
// Standalone: não depende do BigPictureFocusProvider (também roda em
// Configurações, fora do Big Picture). As capturas de botão (passos 1 e
// escuta da linha no ajuste) usam polling direto da Gamepad API, como manda
// a arquitetura poll-based — não há evento confiável de "botão pressionado".
//
// Fecha sem salvar descarta apenas as alterações do ajuste manual (com
// confirmação quando há alterações). A config auto-detectada já foi
// persistida no passo 1 — fechar o resumo não a desfaz.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Button, Modal } from './ui'
import { Gamepad2, X, Mouse, Undo2, RotateCcw, Check, AlertCircle, Cable } from 'lucide-react'
import {
  buildAutoConfig,
  GAMEPAD_ACTIONS,
  GAMEPAD_ACTION_LABELS,
  GAMEPAD_PROFILES,
  mappingsEqual
} from '../lib/gamepad'
import type { GamepadAction, GamepadButtonMapping, GamepadConfig } from '../lib/gamepad'
import { GAMEPAD_GUIDE_BUTTON_INDEX } from '../../../shared/gamepad'
import { playSfx, setSfxEnabled } from '../lib/sfx'
import { announce } from '../lib/useAnnouncer'
import { GamepadMappingRow } from './gamepad/GamepadMappingRow'

export interface GamepadSetupProps {
  /** Config existente → começa no ajuste manual; omitido/null → começa na detecção. */
  initialConfig?: GamepadConfig | null
  /**
   * 'overlay' = modal fixed inset-0 z-[70] (Configurações/gate por cima).
   * 'inline' = preenche a área disponível (seção "Controle" do Big Picture).
   */
  layout?: 'overlay' | 'inline'
  /** Chamado quando a config foi persistida com sucesso (Concluir/Salvar). */
  onSaved: (config: GamepadConfig) => void
  /** Chamado quando o usuário desiste/fecha (já confirmado se houver alterações). */
  onClose: () => void
}

type Step = 'detect' | 'review' | 'manual'

interface ConflictState {
  action: GamepadAction
  button: number
  /** Ação que já usa o botão (a "conflitante", destacada em vermelho). */
  owner: GamepadAction
}

const DETECT_POLL_MS = 200
const DETECT_HINT_AFTER_MS = 30_000
const LISTEN_POLL_MS = 100
const NOTICE_DISMISS_MS = 4500

function formatConfiguredDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function GamepadSetup({
  initialConfig = null,
  layout = 'overlay',
  onSaved,
  onClose
}: GamepadSetupProps): JSX.Element {
  const [step, setStep] = useState<Step>(initialConfig ? 'manual' : 'detect')
  const [baseConfig, setBaseConfig] = useState<GamepadConfig | null>(initialConfig)
  const [draft, setDraft] = useState<GamepadButtonMapping | null>(
    initialConfig ? { ...initialConfig.mapping } : null
  )
  const [listeningAction, setListeningAction] = useState<GamepadAction | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [padConnected, setPadConnected] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const soundsRef = useRef(true)
  const pendingAutoConfigRef = useRef<GamepadConfig | null>(null)
  const noticeTimer = useRef<number | null>(null)
  // Gamepad API pode não existir (ex.: ambientes de teste) — decidido na montagem.
  const gamepadApiAvailable = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
    []
  )

  const dirty = useMemo(
    () => (draft && baseConfig ? !mappingsEqual(draft, baseConfig.mapping) : false),
    [draft, baseConfig]
  )

  const profile = baseConfig?.profile ?? 'xbox'
  const profileButtons = GAMEPAD_PROFILES[profile].buttons
  const buttonName = useCallback(
    (index: number | null): string =>
      index === null ? 'Sem botão' : (profileButtons[index] ?? `Botão ${index}`),
    [profileButtons]
  )

  const showNotice = useCallback((text: string): void => {
    setNotice(text)
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_DISMISS_MS)
  }, [])

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current)
    },
    []
  )

  // Prefere o estado global de SFX persistido (Configurações → Big Picture).
  useEffect(() => {
    window.api
      .getBigPicturePrefs()
      .then((result) => {
        const sounds = result.ok ? result.prefs.sounds : true
        soundsRef.current = sounds
        setSfxEnabled(sounds)
      })
      .catch(() => {
        soundsRef.current = true
        setSfxEnabled(true)
      })
  }, [])

  // ── Anúncios de etapa para leitor de tela (Big Picture monta a região) ──
  // Dispara na montagem e em cada transição de etapa. Fora do Big Picture
  // (Configurações) não há região live montada — announce() vira no-op mudo.
  useEffect(() => {
    if (step === 'detect') {
      announce('Pressione qualquer botão no controle…')
      return
    }
    if (step === 'review') {
      announce(`Controle detectado: ${baseConfig?.controllerName ?? 'modelo desconhecido'}`)
      return
    }
    announce('Ajuste manual do mapeamento')
  }, [step, baseConfig])

  // Escuta de botão ("Remapear"): avisa que o próximo botão pressionado vira
  // o novo binding. Sair da escuta não anuncia — o anúncio de foco cobre.
  useEffect(() => {
    if (listeningAction !== null) announce('Pressione o novo botão…')
  }, [listeningAction])

  /** Persiste a config auto-detectada (passo 1). Erros ficam na própria tela. */
  const persistAutoConfig = useCallback((config: GamepadConfig): void => {
    pendingAutoConfigRef.current = config
    setDetecting(true)
    setDetectError(null)
    window.api
      .setGamepadConfig(config)
      .then((result) => {
        setDetecting(false)
        if (!result.ok) {
          setDetectError(result.error ?? 'Não foi possível salvar a configuração.')
          announce('Não foi possível salvar a configuração.')
          return
        }
        if (soundsRef.current) playSfx('confirm')
        setBaseConfig(config)
        setDraft({ ...config.mapping })
        setStep('review')
      })
      .catch((err: unknown) => {
        setDetecting(false)
        setDetectError(
          err instanceof Error ? err.message : 'Não foi possível salvar a configuração.'
        )
        announce('Não foi possível salvar a configuração.')
      })
  }, [])

  // ── Passo 1: detecção por polling (200 ms) + evento gamepadconnected ──
  const detectionArmed = step === 'detect' && gamepadApiAvailable
  useEffect(() => {
    if (!detectionArmed) return

    let anyDownAtLastPoll = false

    const scan = (): void => {
      let anyDown = false
      let pressedPad: Gamepad | null = null
      let sawPad = false
      try {
        for (const pad of navigator.getGamepads()) {
          if (!pad) continue
          sawPad = true
          for (const button of pad.buttons) {
            if (button.pressed || button.value > 0.5) {
              anyDown = true
              if (!pressedPad) pressedPad = pad
            }
          }
        }
      } catch {
        // Leitura falhou neste poll — tenta de novo no próximo tick.
        return
      }
      setPadConnected(sawPad)
      if (anyDown && !anyDownAtLastPoll && pressedPad && !detecting) {
        // Primeira borda: detecta modelo, aplica o perfil e persiste.
        persistAutoConfig(buildAutoConfig(pressedPad))
      }
      anyDownAtLastPoll = anyDown
    }

    const interval = window.setInterval(scan, DETECT_POLL_MS)
    const onConnect = (): void => scan()
    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onConnect)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onConnect)
    }
  }, [detectionArmed, detecting, persistAutoConfig])

  // ── Passo 1: dica amigável após 30 s sem nenhum botão ──
  useEffect(() => {
    if (step !== 'detect') return
    const timer = window.setTimeout(() => setHintVisible(true), DETECT_HINT_AFTER_MS)
    return (): void => window.clearTimeout(timer)
  }, [step])

  // ── Solicita fechamento: confirma se houver alterações no ajuste ──
  const requestClose = useCallback((): void => {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }, [dirty, onClose])

  // ── Esc cancela a escuta; fora dela, fecha (com confirmação se sujo) ──
  // Capture na raiz: impede que o atalho vaze para a tela ao redor
  // (ex.: o atalho global de Esc do Big Picture abrir a confirmação de saída).
  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (listeningAction) {
        setListeningAction(null)
        return
      }
      if (confirmDiscard) {
        setConfirmDiscard(false)
        return
      }
      requestClose()
    }
  }

  // ── Atribui um botão a uma ação, tratando conflitos de índice ──
  const assignButton = useCallback(
    (action: GamepadAction, button: number | null): void => {
      if (!draft) return

      if (button !== null) {
        if (button === GAMEPAD_GUIDE_BUTTON_INDEX) {
          if (soundsRef.current) playSfx('error')
          showNotice('O botão Guide (16) é reservado e não pode ser mapeado.')
          return
        }
        const owner = GAMEPAD_ACTIONS.find((candidate) => draft[candidate] === button)
        if (owner && owner !== action) {
          if (soundsRef.current) playSfx('error')
          setConflict({ action, button, owner })
          setListeningAction(null)
          return
        }
      }

      setDraft({ ...draft, [action]: button })
      setConflict(null)
      setListeningAction(null)
      if (soundsRef.current) playSfx('move')
    },
    [draft, showNotice]
  )

  /** Resolve o conflito: "Substituir" — a ação antiga fica sem botão (null). */
  const resolveConflictReplace = useCallback((): void => {
    if (!conflict || !draft) return
    setDraft({ ...draft, [conflict.action]: conflict.button, [conflict.owner]: null })
    setConflict(null)
    if (soundsRef.current) playSfx('confirm')
  }, [conflict, draft])

  // Alterna a escuta de botão de uma linha ("Remapear"). Mesma semântica de
  // antes: sempre limpa o conflito; sem Gamepad API e fora da escuta, avisa
  // em vez de travar a linha.
  const toggleListen = useCallback(
    (action: GamepadAction): void => {
      setConflict(null)
      const isListening = listeningAction === action
      if (!isListening && !gamepadApiAvailable) {
        showNotice('Gamepad API indisponível — use o seletor "Botão 0–15" para mapear com o mouse.')
        return
      }
      setListeningAction(isListening ? null : action)
    },
    [listeningAction, gamepadApiAvailable, showNotice]
  )

  // ── Escuta de botão da linha em "Remapear" (próxima borda captura o índice) ──
  useEffect(() => {
    if (listeningAction === null || !gamepadApiAvailable) return

    // Índices que já estavam pressionados ao entrar em escuta não contam —
    // só a próxima borda de verdade.
    const previouslyDown = new Set<number>()
    try {
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue
        pad.buttons.forEach((button, index) => {
          if (button.pressed || button.value > 0.5) previouslyDown.add(index)
        })
      }
    } catch {
      // Sem leitura inicial: o usuário aperta e solta — a borda será detectada.
    }

    const interval = window.setInterval(() => {
      try {
        for (const pad of navigator.getGamepads()) {
          if (!pad) continue
          for (let index = 0; index < pad.buttons.length; index += 1) {
            const button = pad.buttons[index]
            const down = Boolean(button?.pressed || (button?.value ?? 0) > 0.5)
            if (down && !previouslyDown.has(index)) {
              window.clearInterval(interval)
              assignButton(listeningAction, index)
              return
            }
            if (!down) previouslyDown.delete(index)
          }
        }
      } catch {
        // Falha de leitura neste poll — tenta no próximo.
      }
    }, LISTEN_POLL_MS)

    return () => window.clearInterval(interval)
  }, [listeningAction, assignButton, gamepadApiAvailable])

  const restoreProfileDefault = useCallback((): void => {
    if (!baseConfig) return
    setDraft({ ...GAMEPAD_PROFILES[baseConfig.profile].mapping })
    setConflict(null)
    setListeningAction(null)
    if (soundsRef.current) playSfx('back')
    showNotice('Mapeamento restaurado para o padrão do perfil.')
  }, [baseConfig, showNotice])

  // ── Salvar tudo de uma vez (ajuste manual) ──
  const handleSave = useCallback((): void => {
    if (!baseConfig || !draft || saving) return
    const changed = !mappingsEqual(draft, baseConfig.mapping)
    const config: GamepadConfig = {
      ...baseConfig,
      mapping: { ...draft },
      autoMapped: false,
      configuredAt: changed ? new Date().toISOString() : baseConfig.configuredAt
    }
    setSaving(true)
    setSaveError(null)
    window.api
      .setGamepadConfig(config)
      .then((result) => {
        setSaving(false)
        if (!result.ok) {
          setSaveError(result.error ?? 'Não foi possível salvar a configuração.')
          announce('Não foi possível salvar a configuração.')
          return
        }
        if (soundsRef.current) playSfx('confirm')
        onSaved(config)
      })
      .catch((err: unknown) => {
        setSaving(false)
        setSaveError(err instanceof Error ? err.message : 'Não foi possível salvar a configuração.')
        announce('Não foi possível salvar a configuração.')
      })
  }, [baseConfig, draft, saving, onSaved])

  // ── Wrapper de layout: modal (Configurações) vs. inline (Big Picture) ──
  const panel = (
    <div
      className={
        layout === 'overlay'
          ? 'relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-3 shadow-elevation-3'
          : 'flex h-full min-h-0 flex-col'
      }
    >
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-accent-border bg-accent-muted text-accent">
            <Gamepad2 size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-ink-primary">
              {step === 'detect' ? 'Configurar controle' : 'Controle'}
            </h2>
            <p className="text-[11px] text-ink-tertiary">
              {step === 'manual'
                ? 'Ajuste manual do mapeamento'
                : 'Detecção automática pelo modelo do seu controle'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={requestClose}
          className="shrink-0 flex h-12 w-12 items-center justify-center rounded-control text-ink-tertiary transition-colors hover:bg-surface-2 hover:text-ink-primary"
          aria-label="Fechar configuração de controle"
          title="Fechar"
        >
          <X size={18} />
        </button>
      </div>

      {/* Corpo */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {notice && (
          <div className="mb-4 flex items-center gap-2 rounded-control border border-accent-border bg-accent-muted px-4 py-2.5 text-xs text-accent">
            <AlertCircle size={14} className="shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* ───────── Passo 1 — Detecção ("Pressione qualquer botão") ───────── */}
        {step === 'detect' && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <div className="flex h-36 w-36 items-center justify-center rounded-card border border-accent-border bg-accent-muted">
              <Gamepad2 size={72} strokeWidth={1.25} className="animate-pulse-slow text-accent" />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-2xl font-black tracking-tight text-ink-primary">
                Pressione qualquer botão do controle
              </h3>
              <p className="text-sm leading-relaxed text-ink-secondary">
                Detectamos automaticamente o modelo e configuramos tudo para você.
              </p>
            </div>

            <div
              className={`flex items-center gap-2 rounded-pill border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest ${
                padConnected
                  ? 'border-success-border bg-success-bg text-success'
                  : 'border-[var(--border-strong)] bg-surface-2 text-ink-tertiary'
              }`}
              role="status"
            >
              <span
                className={`h-2 w-2 rounded-full ${padConnected ? 'bg-success' : 'bg-ink-tertiary'}`}
              />
              {padConnected ? 'Controle detectado — pressione um botão' : 'Aguardando controle…'}
            </div>

            {!gamepadApiAvailable && (
              <div className="flex max-w-md items-start gap-2 rounded-card border border-danger-border bg-danger-bg px-4 py-3 text-left text-xs leading-relaxed text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>
                  Este ambiente não expõe controles (Gamepad API indisponível). A detecção
                  automática não é possível aqui — tente com o controle conectado ou configure com o
                  mouse pelo ajuste manual.
                </span>
              </div>
            )}

            {hintVisible && (
              <div className="flex max-w-md items-start gap-2 rounded-card border border-warn-border bg-warn-bg px-4 py-3 text-left text-xs leading-relaxed text-warn">
                <Cable size={16} className="mt-0.5 shrink-0" />
                <span>
                  Não reconheceu seu controle? Tente USB ou outro cabo — ou configure depois com o
                  mouse pelas Configurações.
                </span>
              </div>
            )}

            {detecting && (
              <p className="text-xs font-semibold uppercase tracking-widest text-accent">
                Salvando configuração…
              </p>
            )}

            {detectError && (
              <div className="max-w-md space-y-3 rounded-card border border-danger-border bg-danger-bg p-4 text-left">
                <p className="flex items-start gap-2 text-xs leading-relaxed text-danger">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  Não foi possível salvar a configuração: {detectError}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      pendingAutoConfigRef.current &&
                      persistAutoConfig(pendingAutoConfigRef.current)
                    }
                  >
                    Tentar de novo
                  </Button>
                </div>
              </div>
            )}

            <Button variant="secondary" onClick={requestClose}>
              <Undo2 size={16} />
              Cancelar
            </Button>
          </div>
        )}

        {/* ───────── Passo 2 — Resumo do que foi detectado ───────── */}
        {step === 'review' && baseConfig && (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <Gamepad2 size={44} strokeWidth={1.25} className="text-accent" />
              <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-ink-tertiary">
                Controle detectado
              </p>
              <h3 className="text-xl font-bold text-ink-primary">{baseConfig.controllerName}</h3>
              <p className="text-xs text-ink-tertiary">
                Perfil{' '}
                <span className="font-bold text-ink-secondary">
                  {GAMEPAD_PROFILES[baseConfig.profile].label}
                </span>{' '}
                · configurado em {formatConfiguredDate(baseConfig.configuredAt)}
              </p>
            </div>

            <div className="overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Mapeamento dos 12 botões do controle</caption>
                <thead>
                  <tr className="bg-surface-2 text-[10px] font-bold uppercase tracking-[0.25em] text-ink-tertiary">
                    <th scope="col" className="px-5 py-2.5">
                      Ação
                    </th>
                    <th scope="col" className="px-5 py-2.5">
                      Botão
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GAMEPAD_ACTIONS.map((action) => (
                    <tr
                      key={action}
                      className="border-t border-[var(--border-subtle)] odd:bg-white/[0.02]"
                    >
                      <td className="px-5 py-2 text-ink-secondary">
                        {GAMEPAD_ACTION_LABELS[action]}
                      </td>
                      <td className="px-5 py-2">
                        <span className="inline-flex min-w-[5.5rem] justify-center rounded-control border border-accent-border bg-accent-muted px-3 py-1 font-mono text-[11px] font-semibold text-accent">
                          {buttonName(baseConfig.mapping[action])}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft({ ...baseConfig.mapping })
                  setStep('manual')
                }}
              >
                <Mouse size={16} />
                Ajustar manualmente
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (soundsRef.current) playSfx('confirm')
                  onSaved(baseConfig)
                }}
              >
                <Check size={16} />
                Concluir
              </Button>
            </div>
          </div>
        )}

        {/* ───────── Passo 3 — Ajuste manual por botão ───────── */}
        {step === 'manual' && baseConfig && draft && (
          <div className="space-y-4">
            <p className="text-xs leading-relaxed text-ink-tertiary">
              Controle:{' '}
              <span className="font-semibold text-ink-secondary">{baseConfig.controllerName}</span>{' '}
              · perfil {GAMEPAD_PROFILES[baseConfig.profile].label}. Clique em{' '}
              <span className="font-semibold text-ink-secondary">Remapear</span> e pressione o novo
              botão — ou escolha o índice no seletor.
            </p>

            <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-card border border-[var(--border-subtle)] bg-surface-1">
              {GAMEPAD_ACTIONS.map((action) => (
                <GamepadMappingRow
                  key={action}
                  action={action}
                  buttonIndex={draft[action]}
                  listening={listeningAction === action}
                  conflictHighlight={
                    conflict !== null && (conflict.owner === action || conflict.action === action)
                  }
                  buttonName={buttonName}
                  onAssign={assignButton}
                  onToggleListen={toggleListen}
                />
              ))}
            </ul>

            {/* Conflito: mesmo botão em duas ações */}
            {conflict && (
              <div className="space-y-3 rounded-card border border-danger-border bg-danger-bg p-4">
                <p className="flex items-start gap-2 text-sm font-semibold text-danger">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  Este botão já está em "{GAMEPAD_ACTION_LABELS[conflict.owner]}".
                </p>
                <p className="text-xs leading-relaxed text-danger">
                  Substituir coloca o botão em "{GAMEPAD_ACTION_LABELS[conflict.action]}" e deixa "
                  {GAMEPAD_ACTION_LABELS[conflict.owner]}" sem botão. Ou cancele e escolha outro.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" size="sm" onClick={resolveConflictReplace}>
                    Substituir
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setConflict(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            <p className="text-[11px] leading-relaxed text-ink-tertiary">
              O stick esquerdo sempre navega, além do D-Pad (não remapeável) · o botão Guide (16) é
              reservado e não pode ser mapeado · Esc cancela a escuta · Enter confirma nos botões.
            </p>

            {saveError && (
              <p className="flex items-start gap-2 text-xs text-danger">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                Não foi possível salvar: {saveError} — tente de novo.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">
              <Button
                variant="ghost"
                size="sm"
                className="!text-[11px]"
                onClick={restoreProfileDefault}
                title="Volta todos os 12 mapeamentos para o padrão do perfil"
              >
                <RotateCcw size={14} />
                Restaurar padrão do perfil
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={requestClose}>
                  Cancelar
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={saving}>
                  <Check size={16} />
                  {saving ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const overlayContent =
    layout === 'overlay' ? (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-sunken)_78%,transparent)] p-4 backdrop-blur-[6px]"
        role="dialog"
        aria-modal="true"
        aria-label="Configuração de controle"
      >
        <button
          type="button"
          aria-label="Fechar configuração de controle"
          className="absolute inset-0 cursor-default"
          onClick={requestClose}
        />
        {panel}
      </div>
    ) : (
      panel
    )

  return (
    <div
      className={layout === 'inline' ? 'h-full min-h-0' : undefined}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {overlayContent}

      {/* Confirmação de descarte de alterações (ajuste manual sujo) */}
      {confirmDiscard && (
        <Modal
          title="Descartar alterações?"
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
                Continuar editando
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setConfirmDiscard(false)
                  onClose()
                }}
              >
                Descartar e fechar
              </Button>
            </>
          }
        >
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-card border border-danger-border bg-danger-bg">
              <AlertCircle size={28} strokeWidth={1.5} className="text-danger" />
            </div>
            <p className="text-sm leading-relaxed text-ink-secondary">
              As alterações feitas no mapeamento serão perdidas.
            </p>
          </div>
        </Modal>
      )}
    </div>
  )
}
