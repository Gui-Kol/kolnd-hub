import { useEffect, useRef } from 'react'
import type { OfficeAgent, OfficeAgentStatus, OfficeSnapshot } from '../../../../shared/office'
import {
  AGENT_HEIGHT,
  AGENT_WIDTH,
  FURNITURE,
  agentFrames,
  agentPalette,
  officePalette,
  type Palette,
  type PixelSprite
} from '../../office/art'
import { findAgentAt, spaceLayout, type OfficeLayout, type Rect } from '../../office/layout'

/**
 * Canvas do escritório: 2D puro, pixel art desenhada a partir de `art.ts` e
 * posicionada por `layout.ts`.
 *
 * - Um único `requestAnimationFrame`; pausa quando `document.hidden`.
 * - `devicePixelRatio` respeitado (limitado a 2 para não estourar memória).
 * - Clique faz hit test pelos retângulos do layout e seleciona o personagem.
 * - A acessibilidade real é a lista da sidebar; aqui o canvas é `role="img"`.
 */

const FRAME_MS = 320
const PIXEL_FONT = 'Inter, system-ui, -apple-system, sans-serif'

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

export interface OfficeCanvasProps {
  snapshot: OfficeSnapshot
  selectedID: string | null
  /** Recebe `null` quando o clique cai no vazio (deseleciona). */
  onSelect: (sessionID: string | null) => void
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, r)
}

/** Desenha um sprite de grade dentro do retângulo (escala independente X/Y). */
function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: PixelSprite | { width: number; height: number; rows: string[] },
  palette: Palette,
  rect: Rect,
  alpha = 1
): void {
  if (rect.width <= 0 || rect.height <= 0) return
  const scaleX = rect.width / sprite.width
  const scaleY = rect.height / sprite.height
  ctx.save()
  ctx.globalAlpha = alpha
  for (let row = 0; row < sprite.rows.length; row++) {
    const line = sprite.rows[row]
    for (let col = 0; col < line.length; col++) {
      const color = palette[line[col]]
      if (!color) continue
      ctx.fillStyle = color
      ctx.fillRect(
        rect.x + col * scaleX,
        rect.y + row * scaleY,
        Math.ceil(scaleX),
        Math.ceil(scaleY)
      )
    }
  }
  ctx.restore()
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

function drawHeader(ctx: CanvasRenderingContext2D, room: OfficeLayout['rooms'][number]): void {
  const { header } = room
  // A pasta âmbar identifica a sala sem depender de cor de marca.
  ctx.fillStyle = '#c98d2f'
  ctx.fillRect(header.x + 9, header.y + Math.max(5, header.height / 2 - 5), 6, 4)
  ctx.fillStyle = '#e2a33f'
  ctx.fillRect(header.x + 9, header.y + Math.max(7, header.height / 2 - 2), 10, 7)

  ctx.font = `600 11px ${PIXEL_FONT}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e8eaed'
  const labelWidth = Math.max(0, header.width - 62)
  ctx.fillText(fitText(ctx, room.label, labelWidth), header.x + 24, header.y + header.height / 2)

  ctx.font = `10px ${PIXEL_FONT}`
  ctx.textAlign = 'right'
  ctx.fillStyle = '#7d8894'
  ctx.fillText(`${room.seats.length}`, header.x + header.width - 10, header.y + header.height / 2)
  ctx.textAlign = 'left'
}

function drawSeat(
  ctx: CanvasRenderingContext2D,
  agent: OfficeAgent,
  seat: OfficeLayout['seats'][number],
  palette: Palette,
  selected: boolean,
  time: number
): void {
  const status = agent.status

  if (selected) {
    roundRect(ctx, seat.cell.x, seat.cell.y, seat.cell.width, seat.cell.height, 8)
    ctx.fillStyle = 'rgba(226, 163, 63, 0.08)'
    ctx.fill()
    ctx.strokeStyle = '#e2a33f'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  const frames = agentFrames(status)
  const frame = frames[frames.length > 1 ? Math.floor(time / FRAME_MS) % frames.length : 0]
  drawSprite(
    ctx,
    { width: AGENT_WIDTH, height: AGENT_HEIGHT, rows: frame },
    agentPalette(agent.seed, status),
    seat.sprite,
    status === 'ended' ? 0.55 : 1
  )

  // Monitor apoiado no tampo, antes da mesa (a mesa cobre a base do suporte).
  const monitorWidth = Math.max(8, Math.min(30, seat.desk.width * 0.5))
  const monitorHeight = monitorWidth * (FURNITURE.monitor.height / FURNITURE.monitor.width)
  drawSprite(ctx, FURNITURE.monitor, palette, {
    x: seat.desk.x + (seat.desk.width - monitorWidth) / 2,
    y: seat.desk.y - monitorHeight + 2,
    width: monitorWidth,
    height: monitorHeight
  })

  drawSprite(ctx, FURNITURE.desk, palette, seat.desk)

  // Bolha de atividade: só quando há altura suficiente para ler.
  if (seat.bubble.height >= 9 && seat.bubble.width >= 24) {
    const needs = status === 'needsYou'
    roundRect(ctx, seat.bubble.x, seat.bubble.y, seat.bubble.width, seat.bubble.height, 5)
    ctx.fillStyle = '#222d3a'
    ctx.fill()
    ctx.strokeStyle = needs ? 'rgba(245, 215, 110, 0.55)' : 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = STATUS_COLORS[status]
    ctx.fillRect(seat.bubble.x + 4, seat.bubble.y + seat.bubble.height / 2 - 1.5, 3, 3)

    ctx.font = `9px ${PIXEL_FONT}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = needs ? '#f5d76e' : '#a8b3bd'
    const text = agent.activity?.label ?? STATUS_HINTS[status]
    ctx.fillText(
      fitText(ctx, text, seat.bubble.width - 12),
      seat.bubble.x + 10,
      seat.bubble.y + seat.bubble.height / 2
    )
  }

  // Plaquinha com o nome sobre a mesa (não vaza da célula).
  const plaqueWidth = Math.max(18, Math.min(seat.cell.width - 2, seat.desk.width * 0.9))
  const plaqueHeight = Math.min(11, Math.max(8, seat.desk.height - 1))
  const plaqueX = seat.cell.x + (seat.cell.width - plaqueWidth) / 2
  const plaqueY = seat.desk.y + 1
  ctx.font = `9px ${PIXEL_FONT}`
  const name = agent.parentID ? `${agent.name} · sub` : agent.name
  const label = fitText(ctx, name, plaqueWidth - 6)
  roundRect(ctx, plaqueX, plaqueY, plaqueWidth, plaqueHeight, 3)
  ctx.fillStyle = 'rgba(14, 20, 27, 0.78)'
  ctx.fill()

  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = '#e8eaed'
  ctx.fillText(label, plaqueX + plaqueWidth / 2, plaqueY + plaqueHeight / 2)
  ctx.textAlign = 'left'
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  layout: OfficeLayout,
  snapshot: OfficeSnapshot,
  selectedID: string | null,
  time: number
): void {
  const { width, height, corridor } = layout
  const palette = officePalette()

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#0e141b'
  ctx.fillRect(0, 0, width, height)

  const agentByID = new Map<string, OfficeAgent>()
  for (const agent of snapshot.agents) agentByID.set(agent.sessionID, agent)

  // Corredor no rodapé: mesma linguagem da grade, com portas nas pontas.
  roundRect(ctx, corridor.x, corridor.y, corridor.width, corridor.height, 10)
  ctx.fillStyle = '#121a23'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.save()
  roundRect(ctx, corridor.x, corridor.y, corridor.width, corridor.height, 10)
  ctx.clip()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)'
  for (let x = corridor.x + 26; x < corridor.x + corridor.width; x += 26) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, corridor.y)
    ctx.lineTo(x + 0.5, corridor.y + corridor.height)
    ctx.stroke()
  }
  const doorHeight = Math.max(0, corridor.height - 12)
  const doorWidth = doorHeight * (FURNITURE.door.width / FURNITURE.door.height)
  if (doorHeight > 4) {
    const doorY = corridor.y + (corridor.height - doorHeight) / 2
    drawSprite(ctx, FURNITURE.door, palette, {
      x: corridor.x + 10,
      y: doorY,
      width: doorWidth,
      height: doorHeight
    })
    drawSprite(ctx, FURNITURE.door, palette, {
      x: corridor.x + corridor.width - doorWidth - 10,
      y: doorY,
      width: doorWidth,
      height: doorHeight
    })
  }
  ctx.restore()

  ctx.font = `10px ${PIXEL_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#7d8894'
  ctx.fillText('CORREDOR', corridor.x + corridor.width / 2, corridor.y + corridor.height / 2)
  ctx.textAlign = 'left'

  for (const room of layout.rooms) {
    // Casca arredondada da sala.
    roundRect(ctx, room.bounds.x, room.bounds.y, room.bounds.width, room.bounds.height, 12)
    ctx.fillStyle = '#151d26'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Cabeçalho com superfície levemente mais clara.
    ctx.save()
    roundRect(ctx, room.bounds.x, room.bounds.y, room.bounds.width, room.bounds.height, 12)
    ctx.clip()
    ctx.fillStyle = '#1b2430'
    ctx.fillRect(room.header.x, room.header.y, room.header.width, room.header.height)
    ctx.restore()

    // Piso + grade sutil, recortados no retângulo da sala.
    ctx.save()
    roundRect(ctx, room.bounds.x, room.bounds.y, room.bounds.width, room.bounds.height, 12)
    ctx.clip()
    ctx.fillStyle = '#111923'
    ctx.fillRect(room.floor.x, room.floor.y, room.floor.width, room.floor.height)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)'
    ctx.lineWidth = 1
    for (let x = room.floor.x + 24; x < room.floor.x + room.floor.width; x += 24) {
      ctx.beginPath()
      ctx.moveTo(x + 0.5, room.floor.y)
      ctx.lineTo(x + 0.5, room.floor.y + room.floor.height)
      ctx.stroke()
    }
    for (let y = room.floor.y + 24; y < room.floor.y + room.floor.height; y += 24) {
      ctx.beginPath()
      ctx.moveTo(room.floor.x, y + 0.5)
      ctx.lineTo(room.floor.x + room.floor.width, y + 0.5)
      ctx.stroke()
    }

    // Planta decorativa no canto inferior direito (atrás dos assentos).
    const plantHeight = Math.min(18, Math.max(0, room.floor.height * 0.35))
    const plantWidth = plantHeight * (FURNITURE.plant.width / FURNITURE.plant.height)
    if (plantHeight >= 8 && room.floor.width > plantWidth + 12) {
      drawSprite(ctx, FURNITURE.plant, palette, {
        x: room.floor.x + room.floor.width - plantWidth - 6,
        y: room.floor.y + room.floor.height - plantHeight,
        width: plantWidth,
        height: plantHeight
      })
    }

    if (room.seats.length === 0) {
      ctx.font = `10px ${PIXEL_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#7d8894'
      ctx.fillText(
        'mesa livre',
        room.floor.x + room.floor.width / 2,
        room.floor.y + room.floor.height / 2
      )
      ctx.textAlign = 'left'
    }

    for (const seat of room.seats) {
      const agent = agentByID.get(seat.sessionID)
      if (!agent) continue
      drawSeat(ctx, agent, seat, palette, selectedID === seat.sessionID, time)
    }
    ctx.restore()

    drawHeader(ctx, room)
  }
}

export function OfficeCanvas({ snapshot, selectedID, onSelect }: OfficeCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layoutRef = useRef<OfficeLayout | null>(null)
  const onSelectRef = useRef(onSelect)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // Desenho: um único rAF, pausado enquanto a aba/janela está oculta.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let frame = 0
    let stopped = false

    const render = (time: number): void => {
      if (stopped) return
      const parent = canvas.parentElement
      if (parent) {
        const cssWidth = Math.max(1, Math.floor(parent.clientWidth))
        const cssHeight = Math.max(1, Math.floor(parent.clientHeight))
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
        const layout = spaceLayout(snapshot, { width: cssWidth, height: cssHeight })
        layoutRef.current = layout
        drawScene(context, layout, snapshot, selectedID, time)
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

  // Clique/hover imperativos: o canvas é decorativo para leitores de tela,
  // então não vira um elemento interativo no JSX (a lista da sidebar é a via
  // acessível). O main não recebe evento nenhum — só muda a seleção local.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const locate = (event: MouseEvent): { x: number; y: number } | null => {
      const layout = layoutRef.current
      if (!layout) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return {
        x: ((event.clientX - rect.left) / rect.width) * layout.width,
        y: ((event.clientY - rect.top) / rect.height) * layout.height
      }
    }

    const onClick = (event: MouseEvent): void => {
      const layout = layoutRef.current
      const point = locate(event)
      if (!layout || !point) return
      onSelectRef.current(findAgentAt(layout, point.x, point.y))
    }
    const onMove = (event: MouseEvent): void => {
      const layout = layoutRef.current
      const point = locate(event)
      canvas.style.cursor =
        layout && point && findAgentAt(layout, point.x, point.y) ? 'pointer' : 'default'
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
      : `Escritório com ${snapshot.rooms.length} ${
          snapshot.rooms.length === 1 ? 'sala' : 'salas'
        } e ${snapshot.agents.length} ${snapshot.agents.length === 1 ? 'sessão' : 'sessões'}.`

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={`${summary} Selecione uma sessão na lista ao lado para ver os detalhes.`}
      className="block h-full w-full"
    />
  )
}
