// useGamepad — leitura contínua do controle enquanto o Big Picture está montado.
//
// A Gamepad API é poll-based: tudo sai de um loop em requestAnimationFrame.
// Complementarmente, os eventos `gamepadconnected`/`gamepaddisconnected` (quando
// o driver os dispara) acionam o mesmo poll na hora — o rAF continua como
// rede de segurança para drivers que não emitem os eventos (ou emitem tarde).
// Um controle que some da lista de `navigator.getGamepads()` é detectado no
// próximo poll, com ou sem evento.
//
// O loop resolve as ações semânticas via `config.mapping` (botões) e via
// eixos do stick esquerdo (deadzone 0,5) — ou pelo D-Pad (índices 12–15,
// remapeáveis). Repetição ao segurar: disparo imediato na borda; após
// 380 ms segurando, repete a cada 110 ms (somente direções —
// confirm/back/menu disparam apenas na borda).
//
// Trocar de controle desmonta o estado dos botões (tracks zerados) para não
// carregar "preso-pressionado" de um pad para outro — e nunca duplica loops:
// um único rAF + um único par de listeners por montagem do hook.
//
// Nenhum controle configurado → fallback silencioso: `{ connected: false }`,
// o loop nem sequer consulta a API (ações são simplesmente noops) e a UI
// mostra a dica discreta de configurar um controle.

import { useEffect, useRef, useState } from 'react'
import {
  axisToDirection,
  GAMEPAD_ACTIONS,
  type GamepadAction,
  type GamepadConfig
} from '../lib/gamepad'

const REPEAT_DELAY_MS = 380
const REPEAT_INTERVAL_MS = 110
const PRESS_THRESHOLD = 0.5
const DIRECTION_ACTIONS = new Set<GamepadAction>(['up', 'down', 'left', 'right'])

export interface UseGamepadOptions {
  /** Config persistida (T2). `null` (ou ainda carregando) → fallback sem controle. */
  config: GamepadConfig | null
  /** Chamado a cada disparo de ação (borda + repetição para direções). */
  onAction: (action: GamepadAction) => void
}

export interface UseGamepadResult {
  /** Há um controle presente no momento (não implica config válida). */
  connected: boolean
  /** Nome amigável do controle conectado (para o indicador). */
  controllerName: string | null
  /**
   * `id` bruto do Gamepad atualmente usado (ou `null` sem controle) — permite
   * comparar com `config.controllerId` para detectar troca de modelo.
   */
  padId: string | null
}

interface ButtonTrack {
  down: boolean
  pressedAt: number
  lastFiredAt: number
}

function freshTrack(): ButtonTrack {
  return { down: false, pressedAt: 0, lastFiredAt: 0 }
}

export function useGamepad({ config, onAction }: UseGamepadOptions): UseGamepadResult {
  const [connected, setConnected] = useState(false)
  const [controllerName, setControllerName] = useState<string | null>(null)
  const [padId, setPadId] = useState<string | null>(null)

  // Refs para o loop nunca ficar obsoleto (o hook não re-registra o rAF).
  const configRef = useRef(config)
  const onActionRef = useRef(onAction)
  // Último estado publicado — setState só quando algo muda (nunca por frame).
  const published = useRef<{ connected: boolean; name: string | null; padId: string | null }>({
    connected: false,
    name: null,
    padId: null
  })

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return
    }

    let rafId = 0
    const tracks = new Map<GamepadAction, ButtonTrack>()
    // Id do pad usado no poll anterior — a troca de controle zera os tracks.
    let lastPadId: string | null = null

    const publish = (
      nextConnected: boolean,
      nextName: string | null,
      nextPadId: string | null
    ): void => {
      if (
        published.current.connected === nextConnected &&
        published.current.name === nextName &&
        published.current.padId === nextPadId
      ) {
        return
      }
      published.current = { connected: nextConnected, name: nextName, padId: nextPadId }
      setConnected(nextConnected)
      setControllerName(nextName)
      setPadId(nextPadId)
    }

    const findPad = (cfg: GamepadConfig): Gamepad | null => {
      const pads = navigator.getGamepads()
      // Preferir o controle cujo id === controllerId da config…
      for (const pad of pads) {
        if (pad && pad.id === cfg.controllerId) return pad
      }
      // …senão o primeiro presente.
      for (const pad of pads) {
        if (pad) return pad
      }
      return null
    }

    const findPadSafe = (cfg: GamepadConfig): Gamepad | null => {
      try {
        return findPad(cfg)
      } catch {
        return null
      }
    }

    // Poll compartilhado entre o rAF e os eventos gamepadconnected/disconnected.
    const poll = (): void => {
      const cfg = configRef.current
      if (!cfg) {
        publish(false, null, null)
        return
      }

      const pad = findPadSafe(cfg)

      if (!pad) {
        publish(false, null, null)
        lastPadId = null
        tracks.clear()
        return
      }

      if (pad.id !== lastPadId) {
        // Controle trocado (outro modelo ou mesma id reconectada): zera o
        // estado dos botões para não herdar "pressionado" do pad anterior.
        tracks.clear()
        lastPadId = pad.id
      }

      publish(
        true,
        pad.id === cfg.controllerId ? cfg.controllerName : 'Controle conectado',
        pad.id
      )

      const axisX = axisToDirection(pad.axes[0] ?? 0)
      const axisY = axisToDirection(pad.axes[1] ?? 0)
      const now = performance.now()

      for (const action of GAMEPAD_ACTIONS) {
        let down = false

        // Botão físico via mapping (índices 0–15; `null` = ação sem botão).
        const buttonIndex = cfg.mapping[action]
        if (typeof buttonIndex === 'number') {
          const button = pad.buttons[buttonIndex]
          if (button && (button.pressed || button.value > PRESS_THRESHOLD)) {
            down = true
          }
        }

        // Stick esquerdo sempre navega (não remapeável) — P8/P10.
        if (action === 'up') down = down || axisY === -1
        else if (action === 'down') down = down || axisY === 1
        else if (action === 'left') down = down || axisX === -1
        else if (action === 'right') down = down || axisX === 1

        const track = tracks.get(action) ?? freshTrack()

        if (down && !track.down) {
          // Transição para pressionado → dispara na hora.
          track.down = true
          track.pressedAt = now
          track.lastFiredAt = now
          tracks.set(action, track)
          onActionRef.current(action)
          continue
        }

        if (down && track.down) {
          // Repetição apenas para direções, após o delay inicial.
          const held = now - track.pressedAt
          const sinceLast = now - track.lastFiredAt
          if (DIRECTION_ACTIONS.has(action) && held > REPEAT_DELAY_MS && sinceLast >= REPEAT_INTERVAL_MS) {
            track.lastFiredAt = now
            onActionRef.current(action)
          }
          continue
        }

        if (!down && track.down) {
          track.down = false
        }
      }
    }

    const tick = (): void => {
      rafId = requestAnimationFrame(tick)
      poll()
    }

    rafId = requestAnimationFrame(tick)

    // Eventos do driver (quando disparados) adiantam o poll — o rAF segue
    // cobrindo os drivers silenciosos. Ambos passam pelo mesmo caminho.
    const onConnectionEvent = (): void => poll()
    window.addEventListener('gamepadconnected', onConnectionEvent)
    window.addEventListener('gamepaddisconnected', onConnectionEvent)

    return (): void => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('gamepadconnected', onConnectionEvent)
      window.removeEventListener('gamepaddisconnected', onConnectionEvent)
      tracks.clear()
    }
  }, [])

  return { connected, controllerName, padId }
}
