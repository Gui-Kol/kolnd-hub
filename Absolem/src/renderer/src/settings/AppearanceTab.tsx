import type { ChangeEvent } from 'react'
import {
  contrastRatio,
  contrastWithOverlay,
  fixContrast,
  MIN_AVATAR_CONTRAST
} from '../../../shared/contrast'
import type { OverlayLayout, OverlayPosition } from '../../../shared/config'
import {
  OVERLAY_HEIGHT_MAX,
  OVERLAY_HEIGHT_MIN,
  OVERLAY_WIDTH_MAX,
  OVERLAY_WIDTH_MIN
} from '../../../shared/overlay'
import {
  DEFAULT_THEME_PRESET_ID,
  PARTICLE_DENSITIES,
  THEME_ACCESSORIES,
  THEME_OUTFITS,
  THEME_PRESETS,
  THEME_STYLES,
  markThemeCustom,
  type ParticleDensity,
  type ThemeAccessory,
  type ThemeConfig,
  type ThemeOutfit,
  type ThemePresetId,
  type ThemeStyle
} from '../../../shared/theme'

/**
 * Aba Aparência: todos os controles do tema e da geometria do overlay.
 *
 * Acessibilidade: cada campo tem `<label htmlFor>`; grupos usam `fieldset` +
 * `legend`; nada de `div` clicável. O preview (task 04/T5) fica fora deste
 * componente e recebe o mesmo `theme`.
 */

const ACCESSORY_LABELS: Record<ThemeAccessory, string> = {
  antenna_glow: 'Brilho nas antenas',
  back_spikes: 'Espinhos nas costas',
  visor_hud: 'Visor de HUD'
}

const STYLE_LABELS: Record<ThemeStyle, string> = {
  classic: 'Clássico',
  neon: 'Neon',
  wireframe: 'Wireframe',
  liquid: 'Líquido'
}

const OUTFIT_LABELS: Record<ThemeOutfit, string> = {
  none: 'Sem roupa',
  scarf: 'Cachecol',
  collar: 'Coleira',
  visor: 'Visor'
}

const DENSITY_LABELS: Record<ParticleDensity, string> = {
  off: 'Desligada',
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta'
}

const POSITION_LABELS: Record<OverlayPosition, string> = {
  'bottom-left': 'Inferior esquerdo',
  'bottom-right': 'Inferior direito',
  'top-left': 'Superior esquerdo',
  'top-right': 'Superior direito'
}

export interface AppearanceTabProps {
  theme: ThemeConfig
  layout: OverlayLayout
  onThemeChange: (theme: ThemeConfig) => void
  onPreset: (presetId: ThemePresetId) => void
  onResetTheme: () => void
  onLayoutChange: (patch: Partial<OverlayLayout>) => void
  onResetLayout: () => void
}

export function AppearanceTab({
  theme,
  layout,
  onThemeChange,
  onPreset,
  onResetTheme,
  onLayoutChange,
  onResetLayout
}: AppearanceTabProps) {
  const presetValue = THEME_PRESETS.some((preset) => preset.id === theme.presetId)
    ? theme.presetId
    : 'custom'
  const overlayContrast = contrastWithOverlay(theme.primaryColor)
  const primaryEffectContrast = contrastRatio(theme.primaryColor, theme.effectColor)

  function patch(partial: Partial<ThemeConfig>): void {
    onThemeChange(
      markThemeCustom({
        ...theme,
        ...partial,
        accessories: partial.accessories ? [...partial.accessories] : [...theme.accessories]
      })
    )
  }

  function toggleAccessory(accessory: ThemeAccessory, checked: boolean): void {
    const next = checked
      ? [...theme.accessories.filter((item) => item !== accessory), accessory]
      : theme.accessories.filter((item) => item !== accessory)
    patch({ accessories: next })
  }

  function numberValue(event: ChangeEvent<HTMLInputElement>): number | null {
    if (event.target.value.trim() === '') return null
    const parsed = Number(event.target.value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="appearance-preset-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="appearance-preset-title" className="text-sm font-semibold text-ink-primary">
            Preset
          </h2>
          <button
            type="button"
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
            onClick={onResetTheme}
          >
            Restaurar padrão
          </button>
        </div>
        <label htmlFor="appearance-preset" className="text-xs text-ink-secondary">
          Tema pronto
        </label>
        <select
          id="appearance-preset"
          className="w-full rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
          value={presetValue}
          onChange={(event) => {
            const value = event.target.value
            if (value === 'custom') return
            onPreset(value as ThemePresetId)
          }}
        >
          {presetValue === 'custom' ? <option value="custom">Personalizado</option> : null}
          {THEME_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        {presetValue === 'custom' && theme.presetId !== DEFAULT_THEME_PRESET_ID ? (
          <p className="text-xs text-ink-tertiary">
            Ajustes manuais tornam o tema personalizado; escolher um preset substitui os valores.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="appearance-color-title" className="flex flex-col gap-3">
        <h2 id="appearance-color-title" className="text-sm font-semibold text-ink-primary">
          Cores e brilho
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-primary-color" className="text-xs text-ink-secondary">
              Cor principal
            </label>
            <div className="flex items-center gap-2">
              <input
                id="appearance-primary-color"
                type="color"
                className="h-9 w-12 rounded border border-surface-2 bg-surface-1"
                value={theme.primaryColor}
                onChange={(event) => patch({ primaryColor: event.target.value })}
              />
              <output className="font-mono text-xs text-ink-tertiary">{theme.primaryColor}</output>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-effect-color" className="text-xs text-ink-secondary">
              Cor dos efeitos
            </label>
            <div className="flex items-center gap-2">
              <input
                id="appearance-effect-color"
                type="color"
                className="h-9 w-12 rounded border border-surface-2 bg-surface-1"
                value={theme.effectColor}
                onChange={(event) => patch({ effectColor: event.target.value })}
              />
              <output className="font-mono text-xs text-ink-tertiary">{theme.effectColor}</output>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="appearance-glow" className="text-xs text-ink-secondary">
            Brilho do holograma
          </label>
          <div className="flex items-center gap-3">
            <input
              id="appearance-glow"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={theme.glowIntensity}
              onChange={(event) => patch({ glowIntensity: Number(event.target.value) })}
              className="flex-1"
            />
            <output className="w-10 text-right font-mono text-xs text-ink-tertiary">
              {theme.glowIntensity.toFixed(2)}
            </output>
          </div>
        </div>

        {overlayContrast < MIN_AVATAR_CONTRAST ? (
          <div
            role="status"
            className="flex flex-col gap-2 rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
          >
            <p>
              O avatar pode ficar difícil de ver: contraste {overlayContrast.toFixed(1)}:1 com o
              fundo escuro (mínimo {MIN_AVATAR_CONTRAST}:1).
            </p>
            <button
              type="button"
              className="self-start rounded border border-amber-400/50 px-2 py-1 text-amber-100 hover:border-amber-300"
              onClick={() => patch({ primaryColor: fixContrast(theme.primaryColor) })}
            >
              Corrigir automaticamente
            </button>
          </div>
        ) : null}

        {primaryEffectContrast < MIN_AVATAR_CONTRAST ? (
          <p role="status" className="text-xs text-ink-tertiary">
            As cores principal e de efeitos têm pouco contraste entre si (
            {primaryEffectContrast.toFixed(1)}:1); os efeitos podem se confundir com o corpo.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="appearance-shape-title" className="flex flex-col gap-3">
        <h2 id="appearance-shape-title" className="text-sm font-semibold text-ink-primary">
          Estilo e roupa
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-style" className="text-xs text-ink-secondary">
              Estilo visual
            </label>
            <select
              id="appearance-style"
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={theme.style}
              onChange={(event) => patch({ style: event.target.value as ThemeStyle })}
            >
              {THEME_STYLES.map((style) => (
                <option key={style} value={style}>
                  {STYLE_LABELS[style]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-outfit" className="text-xs text-ink-secondary">
              Roupa
            </label>
            <select
              id="appearance-outfit"
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={theme.outfit}
              onChange={(event) => patch({ outfit: event.target.value as ThemeOutfit })}
            >
              {THEME_OUTFITS.map((outfit) => (
                <option key={outfit} value={outfit}>
                  {OUTFIT_LABELS[outfit]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs text-ink-secondary">Acessórios</legend>
          {THEME_ACCESSORIES.map((accessory) => (
            <label
              key={accessory}
              htmlFor={`appearance-accessory-${accessory}`}
              className="flex items-center gap-2 text-sm text-ink-primary"
            >
              <input
                id={`appearance-accessory-${accessory}`}
                type="checkbox"
                checked={theme.accessories.includes(accessory)}
                onChange={(event) => toggleAccessory(accessory, event.target.checked)}
              />
              {ACCESSORY_LABELS[accessory]}
            </label>
          ))}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-density" className="text-xs text-ink-secondary">
              Densidade de partículas
            </label>
            <select
              id="appearance-density"
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={theme.particleDensity}
              onChange={(event) =>
                patch({ particleDensity: event.target.value as ParticleDensity })
              }
            >
              {PARTICLE_DENSITIES.map((density) => (
                <option key={density} value={density}>
                  {DENSITY_LABELS[density]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-scale" className="text-xs text-ink-secondary">
              Escala do avatar
            </label>
            <div className="flex items-center gap-3">
              <input
                id="appearance-scale"
                type="range"
                min={0.8}
                max={1.5}
                step={0.01}
                value={theme.scale}
                onChange={(event) => patch({ scale: Number(event.target.value) })}
                className="flex-1"
              />
              <output className="w-10 text-right font-mono text-xs text-ink-tertiary">
                {theme.scale.toFixed(2)}
              </output>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="appearance-position-title" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="appearance-position-title" className="text-sm font-semibold text-ink-primary">
            Posição e tamanho
          </h2>
          <button
            type="button"
            className="rounded border border-surface-2 px-3 py-1.5 text-xs text-ink-secondary hover:border-accent hover:text-ink-primary"
            onClick={onResetLayout}
          >
            Centralizar no canto inferior esquerdo
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="appearance-position" className="text-xs text-ink-secondary">
            Canto da tela
          </label>
          <select
            id="appearance-position"
            className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
            value={layout.position}
            onChange={(event) =>
              onLayoutChange({ position: event.target.value as OverlayPosition })
            }
          >
            {(Object.keys(POSITION_LABELS) as OverlayPosition[]).map((position) => (
              <option key={position} value={position}>
                {POSITION_LABELS[position]}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-offset-x" className="text-xs text-ink-secondary">
              Deslocamento X (px)
            </label>
            <input
              id="appearance-offset-x"
              type="number"
              step={8}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={layout.offsetX}
              onChange={(event) => {
                const value = numberValue(event)
                if (value !== null) onLayoutChange({ offsetX: value })
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-offset-y" className="text-xs text-ink-secondary">
              Deslocamento Y (px)
            </label>
            <input
              id="appearance-offset-y"
              type="number"
              step={8}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={layout.offsetY}
              onChange={(event) => {
                const value = numberValue(event)
                if (value !== null) onLayoutChange({ offsetY: value })
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-width" className="text-xs text-ink-secondary">
              Largura ({OVERLAY_WIDTH_MIN}-{OVERLAY_WIDTH_MAX} px)
            </label>
            <input
              id="appearance-width"
              type="number"
              min={OVERLAY_WIDTH_MIN}
              max={OVERLAY_WIDTH_MAX}
              step={8}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={layout.width}
              onChange={(event) => {
                const value = numberValue(event)
                if (value !== null) onLayoutChange({ width: value })
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="appearance-height" className="text-xs text-ink-secondary">
              Altura ({OVERLAY_HEIGHT_MIN}-{OVERLAY_HEIGHT_MAX} px)
            </label>
            <input
              id="appearance-height"
              type="number"
              min={OVERLAY_HEIGHT_MIN}
              max={OVERLAY_HEIGHT_MAX}
              step={8}
              className="rounded border border-surface-2 bg-surface-1 px-3 py-2 text-sm text-ink-primary"
              value={layout.height}
              onChange={(event) => {
                const value = numberValue(event)
                if (value !== null) onLayoutChange({ height: value })
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
