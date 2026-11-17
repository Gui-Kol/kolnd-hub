// Tipos e lógica pura de escala/resolução/taxa de atualização (aba Tela em Meu PC).
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `hwmon.ts`). Só regras puras: o PowerShell/C# consulta o Windows.

export interface DisplayMode {
  width: number
  height: number
  refreshHz: number
}

export interface DisplayResolution {
  width: number
  height: number
  /** Modo preferido do monitor (EDID/DisplayConfig); fallback no primeiro da lista. */
  recommended: boolean
  /** Taxas aceitas nesta resolução, em ordem decrescente. */
  refreshRates: number[]
}

export interface DisplayScaleInfo {
  current: number
  recommended: number
  options: number[]
}

export interface DisplayDescriptor {
  /** Nome GDI do adaptador, ex.: `\\.\DISPLAY1`. */
  id: string
  /** Nome amigável do monitor (fallback já resolvido pelo main). */
  name: string
  primary: boolean
  width: number
  height: number
  refreshHz: number
  resolutions: DisplayResolution[]
  scale: DisplayScaleInfo | null
}

export interface DisplayInfo {
  ok: boolean
  displays: DisplayDescriptor[]
  error?: string
}

/** Janela de confirmação (mesmo padrão das Configurações do Windows). */
export const DISPLAY_CONFIRM_TIMEOUT_MS = 10_000

export interface DisplayChangeTicket {
  id: number
  timeoutMs: number
  /** Instante (epoch ms) em que o main reverte sozinho se ninguém confirmar. */
  deadline: number
}

export interface DisplaySetResult {
  ok: boolean
  error?: string
  /** Presente quando a mudança foi aplicada e aguarda confirmação. */
  change?: DisplayChangeTicket
}

export interface DisplayRevertedEvent {
  changeId: number
  ok: boolean
  error?: string
}

/**
 * Resultado do `display:confirm-change`. `confirmed: false` significa que o
 * timeout já disparou (o revert pode estar em andamento/concluído): a UI não
 * pode anunciar sucesso, mesmo que a chamada tenha chegado logo depois dos 10 s.
 */
export interface DisplayConfirmResult {
  ok: boolean
  confirmed: boolean
}

/**
 * Degraus de escala do Windows (mesma tabela das Configurações). O valor
 * relativo devolvido pela API é um índice nesta lista, ancorado no mínimo
 * suportado pelo monitor — nunca é o percentual em si.
 */
export const DISPLAY_SCALE_STEPS = [
  100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500
] as const

function isValidScaleRel(value: number): boolean {
  return Number.isInteger(value)
}

/**
 * Traduz os índices relativos da API de DPI para percentuais.
 *
 * `recommended` é o degrau no mínimo suportado (índice `|minRel|`), `current`
 * soma o deslocamento atual e `options` lista só os degraus que o monitor
 * aceita. Qualquer índice fora da tabela invalida o bloco inteiro (a UI fica
 * sem o controle de escala em vez de mostrar um valor inventado).
 */
export function buildScaleInfo(
  minRel: number,
  curRel: number,
  maxRel: number
): DisplayScaleInfo | null {
  if (!isValidScaleRel(minRel) || !isValidScaleRel(curRel) || !isValidScaleRel(maxRel)) {
    return null
  }
  if (maxRel < 0) return null

  const base = Math.abs(minRel)
  const last = base + maxRel
  if (last >= DISPLAY_SCALE_STEPS.length) return null

  const clamped = Math.min(Math.max(curRel, minRel), maxRel)
  const currentIndex = base + clamped
  if (currentIndex < 0 || currentIndex >= DISPLAY_SCALE_STEPS.length) return null

  const recommended = DISPLAY_SCALE_STEPS[base]
  const current = DISPLAY_SCALE_STEPS[currentIndex]
  if (recommended === undefined || current === undefined) return null

  return {
    current,
    recommended,
    options: DISPLAY_SCALE_STEPS.slice(0, last + 1) as number[]
  }
}

/**
 * Converte um percentual escolhido na UI para o índice relativo que a API de
 * DPI espera (`percentual - recomendado`). `null` quando o percentual não é
 * um dos degraus disponíveis para esta tela.
 */
export function scaleRelForPercent(
  percent: number,
  recommended: number,
  minRel: number,
  maxRel: number
): number | null {
  if (!Number.isInteger(percent) || !Number.isInteger(recommended)) return null
  const steps: readonly number[] = DISPLAY_SCALE_STEPS
  const index = steps.indexOf(percent)
  const recommendedIndex = steps.indexOf(recommended)
  if (index < 0 || recommendedIndex < 0) return null
  if (index > Math.abs(minRel) + maxRel) return null

  const rel = index - recommendedIndex
  if (rel < minRel || rel > maxRel) return null
  return rel
}

function isValidDimension(value: number, min: number): boolean {
  return Number.isInteger(value) && value >= min && value <= 16384
}

function isValidMode(mode: DisplayMode): boolean {
  return (
    isValidDimension(mode.width, 1) &&
    isValidDimension(mode.height, 1) &&
    Number.isInteger(mode.refreshHz) &&
    mode.refreshHz >= 20 &&
    mode.refreshHz <= 1000
  )
}

/**
 * Agrupa os modos por resolução: cada item guarda todas as taxas aceitas
 * (decrescente) e o recomendado é o modo preferido do monitor, com fallback
 * no primeiro da lista. A ordem segue a das Configurações do Windows: área
 * decrescente, depois largura e maior taxa.
 */
export function buildResolutions(
  modes: readonly DisplayMode[],
  preferred?: Pick<DisplayMode, 'width' | 'height'> | null
): DisplayResolution[] {
  const byResolution = new Map<string, Set<number>>()
  for (const mode of modes) {
    if (!isValidMode(mode)) continue
    const key = `${mode.width}x${mode.height}`
    const rates = byResolution.get(key)
    if (rates) rates.add(mode.refreshHz)
    else byResolution.set(key, new Set([mode.refreshHz]))
  }

  const list = [...byResolution.entries()].map(([key, rates]) => {
    const [widthText, heightText] = key.split('x')
    return {
      width: Number(widthText),
      height: Number(heightText),
      refreshRates: [...rates].sort((a, b) => b - a)
    }
  })

  list.sort((a, b) => {
    const areaDiff = b.width * b.height - a.width * a.height
    if (areaDiff !== 0) return areaDiff
    if (b.width !== a.width) return b.width - a.width
    return (b.refreshRates[0] ?? 0) - (a.refreshRates[0] ?? 0)
  })

  const preferredIndex = preferred
    ? list.findIndex((r) => r.width === preferred.width && r.height === preferred.height)
    : -1
  const recommendedIndex = preferredIndex >= 0 ? preferredIndex : 0

  return list.map((resolution, index) => ({
    ...resolution,
    recommended: index === recommendedIndex
  }))
}

/**
 * Taxa a aplicar ao trocar de resolução: preserva a atual quando o novo modo
 * a aceita; senão cai na maior disponível. `0` significa "o Windows escolhe"
 * (usado quando a lista vier vazia, o que não deveria acontecer na UI).
 */
export function pickRefreshRate(resolution: DisplayResolution, preferredHz: number): number {
  const rates = resolution.refreshRates
  if (rates.length === 0) return 0
  if (Number.isInteger(preferredHz) && rates.includes(preferredHz)) return preferredHz
  return Math.max(...rates)
}

/** `1920 × 1080 (Recomendado)` — o separador é U+00D7, como no Windows. */
export function resolutionLabel(resolution: DisplayResolution): string {
  const base = `${resolution.width} × ${resolution.height}`
  return resolution.recommended ? `${base} (Recomendado)` : base
}

/** `165 Hz (Recomendado)` / `60 Hz` (o recomendado é o maior da resolução). */
export function refreshLabel(hz: number, recommendedHz: number): string {
  return hz === recommendedHz ? `${hz} Hz (Recomendado)` : `${hz} Hz`
}

/** `1. DELL U2720Q` — o índice vem da ordem devolvida pelo main. */
export function displayLabel(display: DisplayDescriptor, index: number): string {
  return `${index + 1}. ${display.name}`
}

/** `100% (Recomendado)` / `125%`. */
export function scaleLabel(percent: number, recommended: number): string {
  return percent === recommended ? `${percent}% (Recomendado)` : `${percent}%`
}

/** Códigos de `ChangeDisplaySettingsEx` traduzidos para a linguagem do usuário. */
export function resolutionErrorMessage(rc: number): string {
  switch (rc) {
    case 0:
      return 'Resolução alterada.'
    case 1:
      return 'A nova resolução foi aplicada, mas só será exibida após reiniciar o computador.'
    case -1:
      return 'O Windows não permitiu alterar a resolução agora. Feche jogos ou aplicativos em tela cheia e tente novamente.'
    case -2:
      return 'Esta resolução não é compatível com o monitor conectado.'
    case -3:
      return 'Não foi possível salvar a resolução nas configurações do Windows.'
    case -5:
      return 'Resolução inválida para este monitor.'
    case -100:
      return 'A resolução ou a taxa de atualização escolhida não está disponível para este monitor.'
    default:
      return 'Não foi possível alterar a resolução de tela. Tente novamente.'
  }
}

/**
 * Códigos da API de DPI (Win32) também usam `0` para sucesso; `-100` é o
 * marcador interno de "não suportado" devolvido pelo C# deste app.
 */
export function scaleErrorMessage(rc: number): string {
  switch (rc) {
    case 0:
      return 'Escala alterada.'
    case 1:
      return 'A nova escala foi aplicada, mas pode exigir sair e entrar novamente na conta.'
    case -1:
      return 'O Windows não permitiu alterar a escala agora. Feche aplicativos em tela cheia e tente novamente.'
    case -2:
      return 'Esta escala não é compatível com a tela atual.'
    case -3:
      return 'Não foi possível salvar a escala nas configurações do Windows.'
    case -5:
      return 'Escala inválida para esta tela.'
    case -100:
      return 'Esta escala não é suportada pelo monitor conectado.'
    case 5:
      return 'O Windows negou permissão para alterar a escala da tela.'
    case 87:
      return 'Esta escala não é válida para a tela atual.'
    default:
      return 'Não foi possível alterar a escala da tela. Tente novamente.'
  }
}
