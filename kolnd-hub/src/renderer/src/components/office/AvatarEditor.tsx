import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import type { OfficeAgent } from '../../../../shared/office'
import {
  AVATAR_SEXES,
  AVATAR_SEX_LABELS,
  HAIR_COLORS,
  HAIR_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  defaultLookFor,
  type OfficeAvatarColor,
  type OfficeAvatarLook,
  type OfficeAvatarSex
} from '../../../../shared/officeAvatar'
import { Badge, Button, Modal } from '../ui'
import {
  characterShadow,
  composeCharacter,
  floorShapes,
  frameShapes,
  rugShapes,
  scenePalette,
  wallShapes
} from '../../office/isoArt'

/**
 * Editor de aparência do personagem (mockup `editor-personagem.html`).
 *
 * Prévia ao vivo num canvas próprio (chão isométrico + boneco grande) e
 * controles de sexo, estilo/cor de cabelo, pele, camisa e calça — tudo com
 * paletas FIXAS. "Restaurar padrão" volta ao look determinístico da seed.
 */

export interface AvatarEditorProps {
  agent: OfficeAgent
  look: OfficeAvatarLook
  onClose: () => void
  /** Chamado após salvar; o pai atualiza o snapshot/look local. */
  onSaved: (look: OfficeAvatarLook) => void
}

const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 360
const CHARACTER_SCALE = 12

function drawPreview(canvas: HTMLCanvasElement, look: OfficeAvatarLook, agent: OfficeAgent): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = PREVIEW_WIDTH * dpr
  canvas.height = PREVIEW_HEIGHT * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

  const backdrop = ctx.createLinearGradient(0, 0, 0, PREVIEW_HEIGHT)
  backdrop.addColorStop(0, '#17222e')
  backdrop.addColorStop(1, '#0b1117')
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)

  const palette = scenePalette()
  const origin = { x: PREVIEW_WIDTH / 2, y: 228, scale: 1.5 }
  const paint = (shapes: ReturnType<typeof floorShapes>): void => {
    for (const shape of shapes) {
      if (shape.kind !== 'poly') continue
      ctx.beginPath()
      ctx.moveTo(shape.points[0].x, shape.points[0].y)
      for (let index = 1; index < shape.points.length; index++) {
        ctx.lineTo(shape.points[index].x, shape.points[index].y)
      }
      ctx.closePath()
      ctx.fillStyle = shape.fill
      ctx.fill()
      if (shape.stroke) {
        ctx.strokeStyle = shape.stroke
        ctx.lineWidth = shape.lineWidth ?? 1
        ctx.stroke()
      }
    }
  }

  paint(floorShapes(origin, 3, 3, palette))
  paint(rugShapes(origin, 3, 3, palette))
  paint(wallShapes(origin, 3, 3, palette))
  paint(frameShapes(origin, 0.9, 12, palette))

  const feet = { x: PREVIEW_WIDTH / 2, y: 300 }
  const shadow = characterShadow(feet, CHARACTER_SCALE / 2, palette)
  if (shadow.kind === 'rect') {
    ctx.beginPath()
    ctx.roundRect(shadow.x, shadow.y, shadow.width, shadow.height, shadow.radius ?? 3)
    ctx.fillStyle = shadow.fill
    ctx.fill()
  }

  const art = composeCharacter(look, agent.status === 'ended' ? 'idle' : agent.status, 0)
  const left = feet.x - (art.width * CHARACTER_SCALE) / 2
  const top = feet.y - art.height * CHARACTER_SCALE
  for (let row = 0; row < art.rows.length; row++) {
    const line = art.rows[row]
    for (let column = 0; column < line.length; column++) {
      const color = art.palette[line[column]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(
        left + column * CHARACTER_SCALE,
        top + row * CHARACTER_SCALE,
        CHARACTER_SCALE,
        CHARACTER_SCALE
      )
    }
  }

  ctx.font = '600 13px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#e8eaed'
  ctx.fillText(agent.name, PREVIEW_WIDTH / 2, PREVIEW_HEIGHT - 26)
  ctx.font = '10px Inter, system-ui, sans-serif'
  ctx.fillStyle = '#7d8894'
  ctx.fillText('Prévia ao vivo', PREVIEW_WIDTH / 2, PREVIEW_HEIGHT - 11)
}

interface SwatchesProps {
  label: string
  colors: readonly OfficeAvatarColor[]
  value: number
  testIdPrefix: string
  onChange: (index: number) => void
}

function Swatches({ label, colors, value, testIdPrefix, onChange }: SwatchesProps): JSX.Element {
  return (
    <section aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
          {label}
        </h3>
        <span className="text-[10.5px] text-ink-secondary">{colors[value]?.name ?? '—'}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {colors.map((color, index) => (
          <button
            key={`${testIdPrefix}-${index}`}
            type="button"
            data-testid={`${testIdPrefix}-${index}`}
            aria-label={`${label}: ${color.name}`}
            aria-pressed={value === index}
            onClick={() => onChange(index)}
            className={`h-7 w-7 rounded-sm border transition-transform duration-1 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
              value === index ? 'border-accent ring-1 ring-accent' : 'border-[var(--border-strong)]'
            }`}
            style={{ backgroundColor: color.c }}
          />
        ))}
      </div>
    </section>
  )
}

export function AvatarEditor({ agent, look, onClose, onSaved }: AvatarEditorProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [draft, setDraft] = useState<OfficeAvatarLook>(look)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawPreview(canvas, draft, agent)
  }, [draft, agent])

  function save(): void {
    if (saving) return
    setSaving(true)
    setError(null)
    void window.api
      .officeAvatarSave({ sessionID: agent.sessionID, look: draft })
      .then((result) => {
        if (!result.ok) {
          setError(result.error ?? 'Não consegui salvar a aparência.')
          return
        }
        onSaved(draft)
        onClose()
      })
      .catch(() => setError('Não consegui falar com o processo principal.'))
      .finally(() => setSaving(false))
  }

  return (
    <Modal
      title={`Aparência de ${agent.name}`}
      onClose={onClose}
      className="max-w-3xl"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => setDraft(defaultLookFor(agent.seed))}
            disabled={saving}
            data-testid="office-avatar-reset"
          >
            <RotateCcw size={13} aria-hidden="true" />
            Restaurar padrão
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={saving}
            data-testid="office-avatar-save"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={13} aria-hidden="true" />
            )}
            Salvar aparência
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="office-avatar-editor">
        <p className="text-[12px] leading-5 text-ink-secondary">
          Cores fixas e curadas: escolha sexo, cabelo, pele, camisa e calça. O personagem fica assim
          em todas as próximas visitas ao escritório.
        </p>

        <div className="grid gap-4 sm:grid-cols-[320px_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-control border border-[var(--border-subtle)] bg-surface-sunken">
            <canvas
              ref={canvasRef}
              className="block h-[360px] w-full"
              data-testid="office-avatar-preview"
              aria-label={`Prévia da aparência de ${agent.name}`}
              role="img"
            />
          </div>

          <div className="space-y-4">
            <section aria-label="Sexo">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                Sexo
              </h3>
              <div className="mt-1.5 flex gap-1.5" role="group" aria-label="Sexo">
                {AVATAR_SEXES.map((sex: OfficeAvatarSex) => (
                  <button
                    key={sex}
                    type="button"
                    data-testid={`office-avatar-sex-${sex}`}
                    aria-pressed={draft.sex === sex}
                    onClick={() => setDraft((current) => ({ ...current, sex }))}
                    className={`h-8 flex-1 rounded-control border text-[11px] font-medium transition-colors duration-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      draft.sex === sex
                        ? 'border-accent-border bg-accent-muted text-ink-primary'
                        : 'border-[var(--border-subtle)] bg-surface-sunken text-ink-secondary hover:text-ink-primary'
                    }`}
                  >
                    {AVATAR_SEX_LABELS[sex]}
                  </button>
                ))}
              </div>
            </section>

            <section aria-label="Estilo de cabelo">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                  Estilo de cabelo
                </h3>
                <span className="text-[10.5px] text-ink-secondary">
                  {HAIR_STYLES[draft.hairStyle]?.name ?? '—'}
                </span>
              </div>
              <div
                className="mt-1.5 flex flex-wrap gap-1.5"
                role="group"
                aria-label="Estilo de cabelo"
              >
                {HAIR_STYLES.map((style, index) => (
                  <button
                    key={style.name}
                    type="button"
                    data-testid={`office-avatar-hairstyle-${index}`}
                    aria-pressed={draft.hairStyle === index}
                    onClick={() => setDraft((current) => ({ ...current, hairStyle: index }))}
                    className={`h-7 rounded-control border px-2 text-[10.5px] transition-colors duration-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      draft.hairStyle === index
                        ? 'border-accent-border bg-accent-muted text-ink-primary'
                        : 'border-[var(--border-subtle)] bg-surface-sunken text-ink-secondary hover:text-ink-primary'
                    }`}
                  >
                    {style.name}
                  </button>
                ))}
              </div>
            </section>

            <Swatches
              label="Cor do cabelo"
              colors={HAIR_COLORS}
              value={draft.hairColor}
              testIdPrefix="office-avatar-haircolor"
              onChange={(index) => setDraft((current) => ({ ...current, hairColor: index }))}
            />
            <Swatches
              label="Cor da pele"
              colors={SKIN_TONES}
              value={draft.skin}
              testIdPrefix="office-avatar-skin"
              onChange={(index) => setDraft((current) => ({ ...current, skin: index }))}
            />
            <Swatches
              label="Cor da camisa"
              colors={SHIRT_COLORS}
              value={draft.shirt}
              testIdPrefix="office-avatar-shirt"
              onChange={(index) => setDraft((current) => ({ ...current, shirt: index }))}
            />
            <Swatches
              label="Cor da calça"
              colors={PANTS_COLORS}
              value={draft.pants}
              testIdPrefix="office-avatar-pants"
              onChange={(index) => setDraft((current) => ({ ...current, pants: index }))}
            />
          </div>
        </div>

        {agent.rolePending && <Badge tone="warning">função {agent.rolePending} pendente</Badge>}

        {error && (
          <p
            role="alert"
            data-testid="office-avatar-error"
            className="rounded-control border border-danger-border bg-danger-bg px-2.5 py-2 text-[11px] leading-snug text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
