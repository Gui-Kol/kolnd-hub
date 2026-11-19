import { useEffect, useRef, useState } from 'react'
import type { OfficeAgent, OfficeAgentStatus, OfficeSnapshot } from '../../../../shared/office'
import type { OfficeAvatarLook } from '../../../../shared/officeAvatar'
import type { Point } from '../../office/iso'
import {
  characterShadow,
  chairShapes,
  composeCharacter,
  deskShapes,
  floorShapes,
  frameShapes,
  plantSprite,
  rugShapes,
  scenePalette,
  wallShapes,
  type IsoArtOrigin,
  type IsoShape,
  type IsoSprite,
  type ScenePalette
} from '../../office/isoArt'
import {
  findAgentAt,
  findRoomAt,
  ISLAND_DEPTH,
  ISLAND_WIDTH,
  layoutOffice,
  type IsoOfficeLayout,
  type IsoSeatPlacement
} from '../../office/layout'

/**
 * Canvas do escritório isométrico.
 *
 * - Um único `requestAnimationFrame`, pausado quando `document.hidden`.
 * - Cena estática (piso/paredes/móveis/chips) pré-renderizada num canvas
 *   offscreen; cada quadro só redesenha os personagens animados e as bolhas.
 * - `devicePixelRatio` respeitado (limitado a 2).
 * - Clique no boneco → popover; na sala (piso/chip/parede) → configurações;
 *   no vazio → desmarca. A lista da sidebar continua sendo a via acessível.
 * - Marcadores invisíveis (`pointer-events-none`) expõem os alvos do canvas
 *   para o e2e/inspeção — o canvas em si é decorativo (`aria-hidden`).
 */

const FRAME_MS = 320
const PIXEL_FONT = 'Inter, system-ui, -apple-system, sans-serif'
const MAX_SPRITE_CACHE = 240

const STATUS_COLORS: Record<OfficeAgentStatus, string> = {
  working: '#47c476',
  needsYou: '#f5d76e',
  idle: '#7d8894',
  ended: '#47525e',
  unknown: '#7d8894'
}

const STATUS_HINTS: Record<OfficeAgentStatus, string> = {
  working: 'Trabalhando…',
  needsYou: 'Precisa de você',
  idle: 'Ocioso',
  ended: 'Encerrado',
  unknown: 'Sem dados'
}

export interface OfficeAgentAnchor {
  x: number
  y: number
}

export interface OfficeCanvasProps {
  snapshot: OfficeSnapshot
  selectedID: string | null
  selectedRoomID?: string | null
  /** Abre o popover do personagem ancorado no boneco. */
  onSelectAgent: (sessionID: string, anchor: OfficeAgentAnchor) => void
  /** Abre as configurações da sala clicada. */
  onSelectRoom: (roomID: string) => void
  /** Clique em piso vazio/corredor: fecha popover e desmarca. */
  onSelectEmpty: () => void
  /** Mapa `sessionID → anchor` e tamanho do canvas para a sidebar/popover. */
  onLayout?: (
    anchors: ReadonlyMap<string, OfficeAgentAnchor>,
    size: { width: number; height: number }
  ) => void
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)))
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = text
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1)
  }
  return `${out}…`
}

function drawShape(ctx: CanvasRenderingContext2D, shape: IsoShape): void {
  if (shape.kind === 'poly') {
    if (shape.points.length < 3) return
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
    return
  }

  if (shape.radius && shape.radius > 0) {
    roundRect(ctx, shape.x, shape.y, shape.width, shape.height, shape.radius)
    ctx.fillStyle = shape.fill
    ctx.fill()
  } else {
    ctx.fillStyle = shape.fill
    ctx.fillRect(shape.x, shape.y, shape.width, shape.height)
  }
  if (shape.stroke) {
    ctx.strokeStyle = shape.stroke
    ctx.lineWidth = shape.lineWidth ?? 1
    if (shape.radius && shape.radius > 0) {
      roundRect(ctx, shape.x, shape.y, shape.width, shape.height, shape.radius)
      ctx.stroke()
    } else {
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height)
    }
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, sprite: IsoSprite): void {
  if (sprite.width <= 0 || sprite.height <= 0) return
  const scaleX = sprite.width / (sprite.rows[0]?.length || 1)
  const scaleY = sprite.height / sprite.rows.length
  ctx.save()
  if (sprite.alpha !== undefined) ctx.globalAlpha = sprite.alpha
  for (let row = 0; row < sprite.rows.length; row++) {
    const line = sprite.rows[row]
    for (let column = 0; column < line.length; column++) {
      const color = sprite.palette[line[column]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(
        sprite.x + column * scaleX,
        sprite.y + row * scaleY,
        Math.ceil(scaleX),
        Math.ceil(scaleY)
      )
    }
  }
  ctx.restore()
}

function drawRoomChip(
  ctx: CanvasRenderingContext2D,
  chip: { x: number; y: number; width: number; height: number },
  label: string,
  count: number,
  more: number,
  selected: boolean
): void {
  roundRect(ctx, chip.x, chip.y, chip.width, chip.height, 5)
  ctx.fillStyle = selected ? '#2b3644' : '#1b2430'
  ctx.fill()
  ctx.strokeStyle = selected ? '#e2a33f' : 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Pasta âmbar: identifica a sala sem depender de cor de marca.
  ctx.fillStyle = '#c98d2f'
  ctx.fillRect(chip.x + 6, chip.y + 8, 5, 3)
  ctx.fillStyle = '#e2a33f'
  ctx.fillRect(chip.x + 6, chip.y + 10, 8, 5)

  ctx.font = `600 10.5px ${PIXEL_FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e8eaed'
  const moreLabel = more > 0 ? ` +${more}` : ''
  const counter = `${count}${moreLabel}`
  ctx.font = `9px ${PIXEL_FONT}`
  const counterWidth = ctx.measureText(counter).width + 6
  ctx.font = `600 10.5px ${PIXEL_FONT}`
  ctx.fillText(
    fitText(ctx, label, chip.width - 30 - counterWidth),
    chip.x + 18,
    chip.y + chip.height / 2
  )
  ctx.font = `9px ${PIXEL_FONT}`
  ctx.textAlign = 'right'
  ctx.fillStyle = more > 0 ? '#f5d76e' : '#7d8894'
  ctx.fillText(counter, chip.x + chip.width - 6, chip.y + chip.height / 2)
  ctx.textAlign = 'left'
}

/** Cena estática: chão, paredes, móveis, plantas, quadros e chips. */
function paintStaticScene(
  scene: HTMLCanvasElement,
  layout: IsoOfficeLayout,
  snapshot: OfficeSnapshot,
  selectedRoomID: string | null | undefined,
  dpr: number
): void {
  const width = Math.max(1, layout.width)
  const height = Math.max(1, layout.height)
  scene.width = Math.round(width * dpr)
  scene.height = Math.round(height * dpr)
  const ctx = scene.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  // Fundo com vinheta suave (a cena nunca fica "chapada").
  const background = ctx.createLinearGradient(0, 0, 0, height)
  background.addColorStop(0, '#111a23')
  background.addColorStop(1, '#0b1117')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  const palette = scenePalette()
  const byID = new Map(snapshot.agents.map((agent) => [agent.sessionID, agent]))
  const orderedRooms = [...layout.rooms].sort((left, right) => left.depth - right.depth)

  for (const room of orderedRooms) {
    const origin: IsoArtOrigin = room.artOrigin
    const floor = floorShapes(origin, ISLAND_WIDTH, ISLAND_DEPTH, palette)
    for (const shape of floor) drawShape(ctx, shape)

    const rug = rugShapes(origin, ISLAND_WIDTH, ISLAND_DEPTH, palette)
    for (const shape of rug) drawShape(ctx, shape)

    const walls = wallShapes(origin, ISLAND_WIDTH, ISLAND_DEPTH, palette)
    for (const shape of walls) drawShape(ctx, shape)

    const frames = frameShapes(origin, 1.6, 18, palette)
    for (const shape of frames) drawShape(ctx, shape)

    // Cadeiras atrás e mesas na frente; depois a planta, sempre à frente.
    // A arte usa coordenadas LOCAIS da ilha; `deskWorld` é a posição global.
    for (const seat of room.seats) {
      const deskX = seat.deskWorld.x - room.world.x
      const deskY = seat.deskWorld.y - room.world.y
      for (const shape of chairShapes(origin, deskX, deskY, palette)) {
        drawShape(ctx, shape)
      }
    }
    for (const seat of room.seats) {
      const deskX = seat.deskWorld.x - room.world.x
      const deskY = seat.deskWorld.y - room.world.y
      for (const shape of deskShapes(origin, deskX, deskY, palette)) {
        drawShape(ctx, shape)
      }
    }

    // Vaso pequeno no canto (sem asset de imagem).
    const plant = plantSprite(origin, ISLAND_WIDTH - 1.05, ISLAND_DEPTH - 0.85, palette)
    drawSprite(ctx, plant)

    const agentIDs = room.room.agentIDs.filter((sessionID) => byID.has(sessionID))
    drawRoomChip(
      ctx,
      room.chip,
      room.label,
      agentIDs.length,
      room.more,
      selectedRoomID === room.room.id
    )
  }
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  image: HTMLCanvasElement,
  seat: IsoSeatPlacement,
  scale: number
): void {
  const width = 16 * scale
  const height = 24 * scale
  ctx.drawImage(image, seat.anchor.x - width / 2, seat.anchor.y - height, width, height)
}

function drawAgentDetails(
  ctx: CanvasRenderingContext2D,
  agent: OfficeAgent,
  seat: IsoSeatPlacement,
  scale: number,
  selected: boolean,
  palette: ScenePalette
): void {
  const shadow = characterShadow(seat.anchor, scale, palette)
  drawShape(ctx, shadow)

  if (selected) {
    roundRect(ctx, seat.hit.x, seat.hit.y, seat.hit.width, seat.hit.height, 6)
    ctx.fillStyle = 'rgba(226, 163, 63, 0.10)'
    ctx.fill()
    ctx.strokeStyle = '#e2a33f'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  if (scale < 0.5) return

  // Plaquinha com o nome (abaixo dos pés, para não cobrir o sprite).
  const name = agent.parentID ? `${agent.name} · sub` : agent.name
  ctx.font = `500 9px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(9, 14, 19, 0.72)'
  const nameWidth = Math.min(96, ctx.measureText(name).width + 10)
  roundRect(ctx, seat.anchor.x - nameWidth / 2, seat.anchor.y + 2, nameWidth, 11, 3)
  ctx.fill()
  ctx.fillStyle = agent.rolePending ? '#f5d76e' : '#e8eaed'
  ctx.fillText(fitText(ctx, name, nameWidth - 6), seat.anchor.x, seat.anchor.y + 8)

  const pending = agent.rolePending
  const hint = pending
    ? `Função ${pending} pendente`
    : (agent.activity?.label ?? STATUS_HINTS[agent.status])
  const bubbleWidth = Math.min(150, Math.max(84, hint.length * 5.2 + 22))
  const bubbleHeight = 16
  const bubbleX = seat.anchor.x - bubbleWidth / 2
  const bubbleY = seat.popover.y - bubbleHeight - 4
  if (bubbleY < 2) return

  roundRect(ctx, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 5)
  ctx.fillStyle = '#121b24'
  ctx.fill()
  ctx.strokeStyle =
    agent.status === 'needsYou' || pending
      ? 'rgba(245, 215, 110, 0.55)'
      : 'rgba(255, 255, 255, 0.10)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = pending ? '#f5d76e' : STATUS_COLORS[agent.status]
  ctx.fillRect(bubbleX + 5, bubbleY + bubbleHeight / 2 - 1.5, 3, 3)

  ctx.font = `9px ${PIXEL_FONT}`
  ctx.textAlign = 'left'
  ctx.fillStyle = agent.status === 'needsYou' || pending ? '#f5d76e' : '#a8b3bd'
  ctx.fillText(fitText(ctx, hint, bubbleWidth - 14), bubbleX + 12, bubbleY + bubbleHeight / 2)
  ctx.textAlign = 'left'
}

export function OfficeCanvas({
  snapshot,
  selectedID,
  selectedRoomID,
  onSelectAgent,
  onSelectRoom,
  onSelectEmpty,
  onLayout
}: OfficeCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef<IsoOfficeLayout | null>(null)
  const spritesRef = useRef(new Map<string, HTMLCanvasElement>())
  const [layout, setLayout] = useState<IsoOfficeLayout | null>(null)

  const callbacks = useRef({ onSelectAgent, onSelectRoom, onSelectEmpty, onLayout })
  useEffect(() => {
    callbacks.current = { onSelectAgent, onSelectRoom, onSelectEmpty, onLayout }
  }, [onSelectAgent, onSelectRoom, onSelectEmpty, onLayout])

  // Mede o container e recalcula o layout quando o snapshot ou o tamanho muda.
  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const update = (): void => {
      const width = Math.max(1, Math.floor(parent.clientWidth))
      const height = Math.max(1, Math.floor(parent.clientHeight))
      const next = layoutOffice(snapshot, { width, height })
      layoutRef.current = next
      setLayout(next)
      const anchors = new Map<string, OfficeAgentAnchor>()
      for (const seat of next.seats) anchors.set(seat.sessionID, seat.popover)
      callbacks.current.onLayout?.(anchors, { width, height })
    }

    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [snapshot])

  // Cena estática em canvas offscreen (recriada só quando layout/sala ativa muda).
  useEffect(() => {
    if (!layout) return
    const scene = sceneRef.current ?? document.createElement('canvas')
    sceneRef.current = scene
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    paintStaticScene(scene, layout, snapshot, selectedRoomID, dpr)
    spritesRef.current.clear()
  }, [layout, snapshot, selectedRoomID])

  // Loop único de desenho: personagens, seleção e bolhas sobre a cena estática.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    let stopped = false

    const ensureSprite = (
      agent: OfficeAgent,
      look: OfficeAvatarLook,
      frameIndex: number,
      scale: number,
      dpr: number
    ): HTMLCanvasElement => {
      const key = [
        agent.sessionID,
        look.sex,
        look.hairStyle,
        look.hairColor,
        look.skin,
        look.shirt,
        look.pants,
        agent.status,
        frameIndex,
        scale.toFixed(3),
        dpr
      ].join('|')
      const cached = spritesRef.current.get(key)
      if (cached) return cached

      const art = composeCharacter(look, agent.status, frameIndex)
      const pixel = Math.max(1, Math.round(scale * dpr))
      const sprite = document.createElement('canvas')
      sprite.width = art.width * pixel
      sprite.height = art.height * pixel
      const spriteCtx = sprite.getContext('2d')
      if (spriteCtx) {
        spriteCtx.imageSmoothingEnabled = false
        for (let row = 0; row < art.rows.length; row++) {
          const line = art.rows[row]
          for (let column = 0; column < line.length; column++) {
            const color = art.palette[line[column]]
            if (!color) continue
            spriteCtx.fillStyle = color
            spriteCtx.fillRect(column * pixel, row * pixel, pixel, pixel)
          }
        }
      }
      spritesRef.current.set(key, sprite)
      if (spritesRef.current.size > MAX_SPRITE_CACHE) {
        const first = spritesRef.current.keys().next()
        if (!first.done) spritesRef.current.delete(first.value)
      }
      return sprite
    }

    const render = (time: number): void => {
      if (stopped) return
      const current = layoutRef.current
      const parent = canvas.parentElement
      if (current && parent) {
        const cssWidth = Math.max(1, parent.clientWidth)
        const cssHeight = Math.max(1, parent.clientHeight)
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const pixelWidth = Math.round(cssWidth * dpr)
        const pixelHeight = Math.round(cssHeight * dpr)
        if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
          canvas.width = pixelWidth
          canvas.height = pixelHeight
          canvas.style.width = `${cssWidth}px`
          canvas.style.height = `${cssHeight}px`
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.clearRect(0, 0, cssWidth, cssHeight)

        const scene = sceneRef.current
        if (scene && scene.width > 0) {
          context.drawImage(scene, 0, 0, scene.width, scene.height, 0, 0, cssWidth, cssHeight)
        }

        const palette = scenePalette()
        const agentByID = new Map(snapshot.agents.map((agent) => [agent.sessionID, agent]))
        const ordered = [...current.seats].sort((left, right) => left.depth - right.depth)
        for (const seat of ordered) {
          const agent = agentByID.get(seat.sessionID)
          if (!agent) continue
          const look = snapshot.avatars[seat.sessionID]
          if (!look) continue
          drawAgentDetails(
            context,
            agent,
            seat,
            current.camera.scale,
            selectedID === seat.sessionID,
            palette
          )
          const frames = agent.status === 'working' ? 3 : 1
          const frameIndex = frames > 1 ? Math.floor(time / FRAME_MS) % frames : 0
          const sprite = ensureSprite(agent, look, frameIndex, current.camera.scale, dpr)
          drawCharacter(context, sprite, seat, current.camera.scale)
        }
      }
      frame = window.requestAnimationFrame(render)
    }

    const start = (): void => {
      if (stopped || frame !== 0) return
      frame = window.requestAnimationFrame(render)
    }
    const stop = (): void => {
      if (frame === 0) return
      window.cancelAnimationFrame(frame)
      frame = 0
    }
    const onVisibility = (): void => {
      if (document.hidden) stop()
      else start()
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()

    return () => {
      stopped = true
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [snapshot, selectedID])

  // Clique/hover: boneco → popover; sala → configurações; vazio → desmarca.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const locate = (event: MouseEvent): Point | null => {
      const current = layoutRef.current
      if (!current) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return {
        x: ((event.clientX - rect.left) / rect.width) * current.width,
        y: ((event.clientY - rect.top) / rect.height) * current.height
      }
    }

    const onClick = (event: MouseEvent): void => {
      const current = layoutRef.current
      const point = locate(event)
      if (!current || !point) return
      const sessionID = findAgentAt(current, point.x, point.y)
      if (sessionID) {
        const seat = current.seats.find((entry) => entry.sessionID === sessionID)
        callbacks.current.onSelectAgent(sessionID, seat?.popover ?? point)
        return
      }
      const roomID = findRoomAt(current, point.x, point.y)
      if (roomID) {
        callbacks.current.onSelectRoom(roomID)
        return
      }
      callbacks.current.onSelectEmpty()
    }
    const onMove = (event: MouseEvent): void => {
      const current = layoutRef.current
      const point = locate(event)
      canvas.style.cursor =
        current &&
        point &&
        (findAgentAt(current, point.x, point.y) || findRoomAt(current, point.x, point.y))
          ? 'pointer'
          : 'default'
    }

    canvas.addEventListener('click', onClick)
    canvas.addEventListener('mousemove', onMove)
    return () => {
      canvas.removeEventListener('click', onClick)
      canvas.removeEventListener('mousemove', onMove)
    }
  }, [])

  const summary =
    snapshot.rooms.length === 0
      ? 'Escritório vazio.'
      : `Escritório isométrico com ${snapshot.rooms.length} ${
          snapshot.rooms.length === 1 ? 'sala' : 'salas'
        } e ${snapshot.agents.length} ${snapshot.agents.length === 1 ? 'sessão' : 'sessões'}.`

  return (
    <div className="relative h-full w-full" data-testid="office-canvas-wrap">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-testid="office-canvas"
        data-iso="true"
        className="block h-full w-full"
      />
      <p className="sr-only">{summary}</p>
      {layout && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {layout.rooms.map((room) => (
            <span
              key={`room-${room.room.id}`}
              data-testid="office-room-hit"
              data-room-id={room.room.id}
              className="absolute"
              style={{
                left: room.chip.x,
                top: room.chip.y,
                width: room.chip.width,
                height: room.chip.height
              }}
            />
          ))}
          {layout.seats.map((seat) => (
            <span
              key={`seat-${seat.sessionID}`}
              data-testid="office-seat"
              data-session-id={seat.sessionID}
              className="absolute"
              style={{
                left: seat.hit.x,
                top: seat.hit.y,
                width: seat.hit.width,
                height: seat.hit.height
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
