// Tipos canônicos da sobreposição (HUD) e validação do atalho global.
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `hwmon.ts`). A validação do accelerator é pura de
// propósito: o main precisa rejeitar entradas inválidas ANTES de chamar
// `globalShortcut.register`, e o renderer precisa montar o mesmo formato ao
// gravar o atalho — as duas pontas usam estas funções.

import type { HudFpsReading } from './fps'
import type { HwSnapshot } from './hwmon'

/** Atalho padrão: combinação improvável de já estar em uso em outros apps. */
/**
 * Atalho padrão do HUD: `Shift+Insert` (pedido do usuário, 17/11/2026).
 * Verificado nesta máquina com RegisterHotKey: livre e registrável. Obs.: é a
 * combinação clássica de "colar" em alguns aplicativos; como o `globalShortcut`
 * do Electron é global, enquanto o Hub estiver aberto a combinação é capturada
 * pelo HUD — a UI permite trocar.
 */
export const HUD_DEFAULT_SHORTCUT = 'Shift+Insert'

/**
 * Tamanho da janela: a largura é configurável (passo de 10 px) e a altura é
 * sempre automática — o renderer mede o conteúdo e pede `setBounds` ao main.
 * Nunca cortamos informação: o clamp só protege contra medições absurdas.
 */
export const HUD_WIDTH_MIN = 180
export const HUD_WIDTH_MAX = 560
export const HUD_WIDTH_STEP = 10
export const HUD_DEFAULT_WIDTH = 300

export const HUD_MIN_HEIGHT = 120
/**
 * Teto de sanidade da altura (não do layout): em 300 px/grande o conteúdo já
 * ocupa a maior parte de uma tela 720p, e nomes longos de CPU/GPU que quebrem
 * mais uma linha ainda precisam caber. O limite real é a área de trabalho —
 * `fitHudHeight` aplica esse corte.
 */
export const HUD_MAX_HEIGHT = 1200
/** Altura inicial antes da primeira medição; o overlay ajusta em seguida. */
export const HUD_INITIAL_HEIGHT = 240

/** Margem em relação ao canto superior esquerdo da área de trabalho. */
export const HUD_MARGIN_PX = 12

/** Escalas tipográficas do HUD (persistidas em `hud.scale`). */
export const HUD_SCALES = ['compacta', 'normal', 'grande'] as const
export type HudScale = (typeof HUD_SCALES)[number]
export const HUD_DEFAULT_SCALE: HudScale = 'normal'

/** Teto de tamanho — o config.json não precisa de accelerators gigantes. */
export const HUD_MAX_SHORTCUT_LENGTH = 64

/** Preferência persistida na chave `hud` do electron-store. */
export interface HudConfig {
  /** Accelerator canônico do Electron (ex.: `Control+Alt+M`). */
  shortcut: string
  /** Se a sobreposição deve reaparecer ao abrir o Hub. */
  visible: boolean
  /** Largura em px (180–560, passo de 10). A altura é automática. */
  width: number
  /** Escala tipográfica dos valores do HUD. */
  scale: HudScale
}

/** Preferências de tamanho devolvidas pela UI/IPC (sem atalho/visibilidade). */
export interface HudSize {
  width: number
  scale: HudScale
}

/**
 * Normaliza a largura: número finito → múltiplo de 10 dentro de 180–560.
 * Entrada inválida cai no padrão — o renderer nunca recebe `NaN`/`undefined`.
 */
export function normalizeHudWidth(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return HUD_DEFAULT_WIDTH
  const stepped = Math.round(input / HUD_WIDTH_STEP) * HUD_WIDTH_STEP
  return Math.min(HUD_WIDTH_MAX, Math.max(HUD_WIDTH_MIN, stepped))
}

/** `true` somente para as três escalas conhecidas (whitelist do IPC). */
export function isHudScale(input: unknown): input is HudScale {
  return typeof input === 'string' && (HUD_SCALES as readonly string[]).includes(input)
}

/** Escala inválida cai no padrão `normal`. */
export function normalizeHudScale(input: unknown): HudScale {
  return isHudScale(input) ? input : HUD_DEFAULT_SCALE
}

/**
 * Normaliza a altura medida pelo overlay. Medição inválida/zero usa a altura
 * inicial; o clamp evita que um layout quebrado ocupe a tela ou suma.
 */
export function normalizeHudHeight(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) {
    return HUD_INITIAL_HEIGHT
  }
  return Math.min(HUD_MAX_HEIGHT, Math.max(HUD_MIN_HEIGHT, Math.ceil(input)))
}

/**
 * Altura final da janela: a medição normalizada nunca pode passar da área de
 * trabalho menos as duas margens (topo e rodapé). Sem esse corte, um conteúdo
 * mais alto que a tela faria a parte de baixo (o rodapé) ficar fora do monitor.
 * `workAreaHeight` desconhecido não limita — melhor manter a medição do que
 * inventar um teto. Área minúscula ainda respeita o piso mínimo do HUD.
 */
export function fitHudHeight(measured: unknown, workAreaHeight: number): number {
  const height = normalizeHudHeight(measured)
  if (typeof workAreaHeight !== 'number' || !Number.isFinite(workAreaHeight)) return height
  const available = workAreaHeight - 2 * HUD_MARGIN_PX
  return Math.max(HUD_MIN_HEIGHT, Math.min(height, available))
}

/** Estado devolvido pelo IPC `hud:get` (config + registro atual). */
export interface HudStatus {
  config: HudConfig
  /** `true` quando o atalho está registrado globalmente agora. */
  registered: boolean
  /** Mensagem amigável quando o registro falhou (ex.: atalho em uso). */
  error?: string
}

/**
 * Payload do push `hud:update` (~1 Hz enquanto a sobreposição está visível).
 */
export interface HudUpdate {
  snapshot: HwSnapshot
  /** Tamanho atual do HUD — o overlay usa a escala e sabe a largura vigente. */
  size: HudSize
  /** ISO 8601 do instante em que o main montou esta atualização. */
  capturedAt: string
  /**
   * Faixa de FPS (campo ADITIVO): ausente em builds antigos/sem captura. O
   * renderer valida de novo; um número só aparece com `state === 'live'`.
   */
  fps?: HudFpsReading
}

type ModifierName = 'Control' | 'Alt' | 'Shift' | 'Super'

// Aliases aceitos: o usuário (ou um backup antigo) pode ter escrito `Ctrl` em
// vez de `Control`. A normalização sempre devolve a forma canônica.
const MODIFIER_ALIASES: Record<string, ModifierName> = {
  control: 'Control',
  ctrl: 'Control',
  commandorcontrol: 'Control',
  cmdorctrl: 'Control',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  command: 'Super',
  cmd: 'Super'
}

// Ordem fixa na serialização — o mesmo atalho sempre vira a mesma string.
const MODIFIER_ORDER: ModifierName[] = ['Control', 'Alt', 'Shift', 'Super']

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  escape: 'Esc',
  esc: 'Esc',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  // `KeyboardEvent.key` usa os nomes "Arrow*" — o gravador da UI recebe esses.
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  printscreen: 'PrintScreen',
  pause: 'Pause'
}

/** Converte uma tecla isolada para a forma canônica do Electron. */
function normalizeKey(value: string): string | null {
  // `KeyboardEvent.key` para a barra de espaço é `' '` — o trim abaixo o
  // descartaria antes de chegar na tabela de nomes.
  if (value === ' ') return 'Space'
  const part = value.trim()
  if (!part) return null
  if (/^[a-z]$/i.test(part)) return part.toUpperCase()
  if (/^[0-9]$/.test(part)) return part
  const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(part)
  if (functionKey) return `F${functionKey[1]}`
  return NAMED_KEYS[part.toLowerCase()] ?? null
}

/**
 * Valida e normaliza um accelerator do Electron. Retorna `null` se inválido.
 *
 * Exigimos ao menos um modificador: um atalho global de uma tecla solta
 * sequestraria a digitação do sistema inteiro — não é o que o usuário pediu.
 */
export function normalizeAccelerator(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed || trimmed.length > HUD_MAX_SHORTCUT_LENGTH) return null

  const parts = trimmed
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  // No mínimo modificador + tecla; no máximo os quatro modificadores + tecla.
  if (parts.length < 2 || parts.length > MODIFIER_ORDER.length + 1) return null

  const modifiers = new Set<ModifierName>()
  let key: string | null = null

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      if (modifiers.has(modifier)) return null
      modifiers.add(modifier)
      continue
    }
    // Duas teclas na mesma combinação não são um accelerator válido.
    if (key !== null) return null
    key = normalizeKey(part)
    if (!key) return null
  }

  if (!key || modifiers.size === 0) return null
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
  return [...ordered, key].join('+')
}

/** Conveniência booleana para o IPC e o normalizador do store. */
export function isValidAccelerator(input: unknown): boolean {
  return normalizeAccelerator(input) !== null
}

/** Subconjunto de KeyboardEvent usado pelo gravador da aba Monitor (puro/testável). */
export interface ShortcutKeyEvent {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * Converte um `keydown` em accelerator. Teclas modificadoras isoladas (e
 * combinações sem modificador) devolvem `null` — o gravador ignora e continua
 * esperando uma combinação completa.
 */
export function acceleratorFromKeyEvent(event: ShortcutKeyEvent): string | null {
  const key = normalizeKey(event.key)
  if (!key) return null

  const modifiers: ModifierName[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')
  if (modifiers.length === 0) return null

  return [...modifiers, key].join('+')
}

const MODIFIER_LABELS: Record<ModifierName, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Super: 'Win'
}

/** Rótulo legível para a UI (`Control+Alt+M` → `Ctrl + Alt + M`). */
export function formatAcceleratorLabel(accelerator: string): string {
  const normalized = normalizeAccelerator(accelerator)
  if (!normalized) return accelerator
  return normalized
    .split('+')
    .map((part) => MODIFIER_LABELS[part as ModifierName] ?? part)
    .join(' + ')
}
