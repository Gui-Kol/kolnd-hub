/**
 * Troca de tema a quente (task 19, T6) - lógica pura e testável em Node.
 *
 * `applyTheme` não recria renderer/câmera/loop. Quando SÓ a cor muda, os
 * materiais existentes são atualizados (`syncMaterialColors`) e a malha NÃO é
 * reconstruída (`rebuildCaterpillar` não é chamado). A malha é reconstruída
 * quando mudam estilo/roupa/acessórios. Mudar `outlineStrength` reconstrói só
 * o contorno (`rebuildOutline`), nunca a malha; mudar a presença de contorno
 * (0 <-> >0) também reconstrói o contorno.
 */

export interface ThemeRebuildInput {
  style: string
  outfit: string
  accessories: readonly string[]
}

export interface ApplyThemeChangeContext {
  /** Reconstrói a malha da lagarta (não recria renderer/câmera/loop). */
  rebuildCaterpillar: (minimal?: boolean) => void
  /** Reconstrói só o contorno, sem recriar malha. */
  rebuildOutline: () => void
  /** Atualiza cores dos materiais existentes sem recriar. */
  syncMaterialColors: () => void
  /** `outlineStrength` vigente (0 desliga; default 0.7). */
  outlineStrength: number
}

export interface ApplyThemeChangeResult {
  rebuiltMesh: boolean
  rebuiltOutline: boolean
  /** Presença de contorno mudou (0 -> >0 ou >0 -> 0). */
  outlinePresenceChanged: boolean
}

function accessoriesKey(accessories: readonly string[]): string {
  return accessories.join('|')
}

/** Mudou estilo, roupa ou acessórios? */
export function themeRequiresMeshRebuild(
  prev: ThemeRebuildInput,
  next: ThemeRebuildInput
): boolean {
  return (
    prev.style !== next.style ||
    prev.outfit !== next.outfit ||
    accessoriesKey(prev.accessories) !== accessoriesKey(next.accessories)
  )
}

/** `outlineStrength` 0 <-> >0 muda a presença de contorno. */
export function outlinePresenceChanged(prevStrength: number, nextStrength: number): boolean {
  return prevStrength > 0 !== nextStrength > 0
}

/**
 * Aplica uma troca de tema. `nextOutlineStrength` default mantém o vigente.
 * Só a cor não reconstrói malha; só atualiza cores dos materiais existentes.
 */
export function applyThemeChange(
  prev: ThemeRebuildInput,
  next: ThemeRebuildInput,
  ctx: ApplyThemeChangeContext,
  nextOutlineStrength?: number
): ApplyThemeChangeResult {
  const prevStrength = ctx.outlineStrength
  const nextStrength = nextOutlineStrength ?? ctx.outlineStrength
  const presenceChanged = outlinePresenceChanged(prevStrength, nextStrength)
  const strengthChanged = nextStrength !== prevStrength

  const meshRebuild = themeRequiresMeshRebuild(prev, next)

  if (meshRebuild) {
    ctx.rebuildCaterpillar()
  } else {
    // Só a cor mudou: atualiza materiais existentes, sem recriar malha.
    ctx.syncMaterialColors()
  }

  // Mudar `outlineStrength`/presença reconstrói só o contorno.
  const rebuildOutline = !meshRebuild && (presenceChanged || strengthChanged)
  if (rebuildOutline) ctx.rebuildOutline()

  return {
    rebuiltMesh: meshRebuild,
    rebuiltOutline: rebuildOutline,
    outlinePresenceChanged: presenceChanged
  }
}
