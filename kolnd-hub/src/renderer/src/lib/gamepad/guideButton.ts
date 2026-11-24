// Detector do botão Guide/PS (índice 16) — atalho de entrada no Big Picture.
//
// Puro (sem React/Electron/IPC): o hook `useGuideButtonShortcut` faz o polling
// e o gate de foco; aqui só vive a máquina de estados da borda. O índice 16 é
// reservado para DETECÇÃO — o mapeamento das 12 ações continua proibindo-o.
//
// Regras:
// - dispara só na borda de pressão (segurar não repete);
// - o primeiro update após (re)armar é SILENCIOSO (prime): um botão já
//   pressionado quando o hook monta — ou o PS que o usuário ainda segura ao
//   sair do Big Picture — não abre o modo de novo;
// - pad trocado ou ausência de pad zera o estado (novo prime silencioso);
// - controles que não expõem o índice 16 são ignorados (o atalho não existe
//   neles; o botão da topbar continua sendo o fallback).

import { GAMEPAD_GUIDE_BUTTON_INDEX } from '../../../../shared/gamepad'

/** Mesmo limiar de `useGamepad`: `value` acima disso conta como pressionado. */
export const GUIDE_PRESS_THRESHOLD = 0.5

export interface GuideButtonDetector {
  /**
   * Consome o snapshot de `navigator.getGamepads()`. `true` somente na borda
   * de pressão do botão 16 de um pad que o exponha.
   */
  update(pads: readonly (Gamepad | null)[]): boolean
  /** Desarma e esquece o pad: o próximo update vira prime silencioso. */
  reset(): void
}

/** `pressed` ou `value` acima do limiar — tolera drivers que só preenchem um. */
export function isGuideButtonDown(pad: Gamepad | null | undefined): boolean {
  const button = pad?.buttons[GAMEPAD_GUIDE_BUTTON_INDEX]
  if (!button) return false
  return button.pressed || button.value > GUIDE_PRESS_THRESHOLD
}

export function createGuideButtonDetector(): GuideButtonDetector {
  let primed = false
  let down = false
  let padId: string | null = null

  const reset = (): void => {
    primed = false
    down = false
    padId = null
  }

  return {
    reset,
    update(pads: readonly (Gamepad | null)[]): boolean {
      // Usa o primeiro pad que exponha o índice 16 — pads sem ele (drivers que
      // não publicam o Guide) não podem bloquear a detecção de outro.
      const pad = pads.find((candidate) => candidate?.buttons[GAMEPAD_GUIDE_BUTTON_INDEX]) ?? null

      if (!pad) {
        reset()
        return false
      }

      if (!primed || pad.id !== padId) {
        // (Re)arme ou troca de controle: o estado atual vira referência, sem
        // disparar. Isso cobre o PS segurado ao reabrir e o "preso" de um pad.
        primed = true
        padId = pad.id
        down = isGuideButtonDown(pad)
        return false
      }

      const nextDown = isGuideButtonDown(pad)
      const rising = nextDown && !down
      down = nextDown
      return rising
    }
  }
}
