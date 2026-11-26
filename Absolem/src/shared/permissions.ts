/**
 * Modelo de permissões por categoria de ação (task 08, T1).
 *
 * Cada categoria tem uma decisão (`allow`, `ask` ou `deny`) que o roteador da
 * task 05 consulta ANTES de confirmar/executar. O default é conservador:
 * apps e arquivos perguntam, pesquisa web é liberada e energia/UIA ficam
 * desligadas até o usuário habilitar explicitamente.
 *
 * `microphone` é o consentimento da task 06 e não é uma categoria de ação:
 * continua booleano e é preservado por qualquer alteração de categorias.
 */

export const PERMISSION_CATEGORIES = [
  'apps.launch',
  'apps.close',
  'files.read',
  'files.write',
  'system.power',
  'uia.control',
  'web.search'
] as const

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]

export const PERMISSION_DECISIONS = ['allow', 'ask', 'deny'] as const

export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]

export type PermissionCategories = Record<PermissionCategory, PermissionDecision>

export interface PermissionsState {
  /** Consentimento do microfone (task 06). */
  microphone: boolean
  /** Pausa global: bloqueia toda ferramenta de ação antes da confirmação. */
  paused: boolean
  categories: PermissionCategories
}

/** Defaults aprovados: ask para apps/arquivos, allow web, deny energia/UIA. */
export const DEFAULT_PERMISSION_CATEGORIES: Readonly<PermissionCategories> = Object.freeze({
  'apps.launch': 'ask',
  'apps.close': 'ask',
  'files.read': 'ask',
  'files.write': 'ask',
  'system.power': 'deny',
  'uia.control': 'deny',
  'web.search': 'allow'
})

/** Limites de taxa das ações (task 08, T10). */
export const ACTION_LIMITS = {
  appLaunchesPerMinute: 5,
  fileOpsPerRequest: 10,
  uiaActionsPerTwoSeconds: 1
} as const

export function isPermissionCategory(value: unknown): value is PermissionCategory {
  return typeof value === 'string' && (PERMISSION_CATEGORIES as readonly string[]).includes(value)
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  return typeof value === 'string' && (PERMISSION_DECISIONS as readonly string[]).includes(value)
}

export function defaultPermissionCategories(): PermissionCategories {
  return { ...DEFAULT_PERMISSION_CATEGORIES }
}

/** Entrada desconhecida/ inválida cai no default daquela categoria. */
export function normalizePermissionCategories(input: unknown): PermissionCategories {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  const categories = defaultPermissionCategories()
  for (const category of PERMISSION_CATEGORIES) {
    const decision = raw[category]
    if (isPermissionDecision(decision)) categories[category] = decision
  }
  return categories
}

/**
 * Normaliza o estado completo. Campos legados (`screenVision`,
 * `computerControl`, `fileAccess`) são ignorados de propósito: as categorias
 * novas nascem com os defaults, sem herdar consentimento amplo.
 */
export function normalizePermissionsState(input: unknown): PermissionsState {
  const raw =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}
  return {
    microphone: raw.microphone === true,
    paused: raw.paused === true,
    categories: normalizePermissionCategories(raw.categories)
  }
}

/** Devolve um estado novo com a categoria alterada; não muta a entrada. */
export function setPermissionCategory(
  state: PermissionsState,
  category: PermissionCategory,
  decision: PermissionDecision
): PermissionsState {
  return {
    ...state,
    categories: { ...state.categories, [category]: decision }
  }
}

/**
 * `true` somente quando a ação pode executar sem diálogo. `deny` nunca
 * executa e a pausa global vence qualquer categoria.
 */
export function isActionAllowed(state: PermissionsState, category: PermissionCategory): boolean {
  if (state.paused) return false
  return state.categories[category] === 'allow'
}

/**
 * Decisão efetiva consultada pelo roteador (pausa global vira `deny`).
 * `internal` (hora atual, echo de teste) é leitura sem efeito: não pergunta.
 * Categoria de tela mantém `ask` (o modo da task 07 decide antes).
 */
export function effectivePermission(state: PermissionsState, category: string): PermissionDecision {
  if (state.paused) return 'deny'
  if (category === 'internal') return 'allow'
  return isPermissionCategory(category) ? state.categories[category] : 'ask'
}
