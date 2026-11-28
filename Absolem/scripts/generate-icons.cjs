/*
 * Gera os ícones finais do Absolem 100% por código (sem dependências novas,
 * sem asset de terceiros). Node builtins apenas.
 *
 * Saída em resources/:
 *   - icon.ico           (entradas PNG 256,128,64,48,32,16)
 *   - icon.png           (512x512, opcional)
 *   - tray-icon.png      (32x32)
 *   - tray-icon@2x.png   (64x64)
 *
 * Desenho: lagarta azul holográfica em estilo simples, legível em 16 px.
 * Rodar: node scripts/generate-icons.cjs
 */
'use strict'

const { deflateSync } = require('node:zlib')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = join(__dirname, '..')
const OUT_DIR = join(ROOT, 'resources')

// Paleta própria (sem asset de terceiros). Azul lagarta + realce holográfico.
const BODY = [63, 169, 245, 255] // azul lagarta
const HEAD = [91, 184, 255, 255] // cabeça levemente mais clara
const OUTLINE = [232, 251, 255, 255] // contorno holográfico claro
const HOLO = [168, 225, 255, 255] // realce holográfico
const EYE = [255, 255, 255, 255]
const PUPIL = [10, 61, 102, 255]
const ANTENNA = [168, 225, 255, 255]

// ---------------------------------------------------------------------------
// PNG mínimo (8-bit RGBA, filtro 0). CRC32 + chunks com Node zlib.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------------------
// Rasterização com supersampling (SS x SS) + box downsample para anti-alias.
// ---------------------------------------------------------------------------

const SS = 4

function makeCanvas(size) {
  const px = size * SS
  return { size, px, data: Buffer.alloc(px * px * 4, 0) }
}

function setPx(canvas, x, y, color) {
  if (x < 0 || y < 0 || x >= canvas.px || y >= canvas.px) return
  const i = (y * canvas.px + x) * 4
  canvas.data[i] = color[0]
  canvas.data[i + 1] = color[1]
  canvas.data[i + 2] = color[2]
  canvas.data[i + 3] = color[3]
}

function fillCircle(canvas, cx, cy, r, color) {
  const x0 = Math.floor(cx - r)
  const x1 = Math.ceil(cx + r)
  const y0 = Math.floor(cy - r)
  const y1 = Math.ceil(cy + r)
  const r2 = r * r
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy <= r2) setPx(canvas, x, y, color)
    }
  }
}

function drawLine(canvas, x0, y0, x1, y1, color) {
  // Bresenham; espessura 1 no buffer supersampled.
  let x = Math.round(x0)
  let y = Math.round(y0)
  const xEnd = Math.round(x1)
  const yEnd = Math.round(y1)
  const dx = Math.abs(xEnd - x)
  const dy = Math.abs(yEnd - y)
  const sx = x < xEnd ? 1 : -1
  const sy = y < yEnd ? 1 : -1
  let err = dx - dy
  for (;;) {
    setPx(canvas, x, y, color)
    if (x === xEnd && y === yEnd) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

function downsample(canvas) {
  const { size, px, data } = canvas
  const out = Buffer.alloc(size * size * 4, 0)
  const n = SS * SS
  for (let oy = 0; oy < size; oy += 1) {
    for (let ox = 0; ox < size; ox += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const i = ((oy * SS + sy) * px + (ox * SS + sx)) * 4
          // alpha-premultiplied accumulate para bordas limpas
          const alpha = data[i + 3] / 255
          r += data[i] * alpha
          g += data[i + 1] * alpha
          b += data[i + 2] * alpha
          a += data[i + 3]
        }
      }
      const o = (oy * size + ox) * 4
      const outA = a / n
      const covered = a > 0 ? a / (255 * n) : 0
      out[o] = covered > 0 ? Math.round(r / (a / 255)) : 0
      out[o + 1] = covered > 0 ? Math.round(g / (a / 255)) : 0
      out[o + 2] = covered > 0 ? Math.round(b / (a / 255)) : 0
      out[o + 3] = Math.round(outA)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Desenho da lagarta holográfica (coordenadas normalizadas 0..1).
// ---------------------------------------------------------------------------

function drawCaterpillar(canvas) {
  const W = canvas.px
  const u = (v) => v * W

  // Segmentos do corpo + cabeça à direita, leve ondulação. r em unidades u.
  const segments = [
    { x: 0.2, y: 0.55, r: 0.1, color: BODY },
    { x: 0.335, y: 0.515, r: 0.115, color: BODY },
    { x: 0.47, y: 0.53, r: 0.115, color: BODY },
    { x: 0.605, y: 0.515, r: 0.115, color: BODY },
    { x: 0.74, y: 0.54, r: 0.125, color: HEAD } // cabeça
  ]

  // Contorno holográfico claro (desenhado por baixo).
  for (const s of segments) {
    fillCircle(canvas, u(s.x), u(s.y), u(s.r + 0.016), OUTLINE)
  }
  // Corpo.
  for (const s of segments) {
    fillCircle(canvas, u(s.x), u(s.y), u(s.r), s.color)
  }

  // Antenas na cabeça (recuadas para dentro da cabeça no topo).
  const head = segments[segments.length - 1]
  const hx = u(head.x)
  const hy = u(head.y)
  const hr = u(head.r)
  drawLine(canvas, hx + hr * 0.25, hy - hr * 0.75, hx + hr * 0.55, hy - hr * 1.55, ANTENNA)
  drawLine(canvas, hx - hr * 0.15, hy - hr * 0.8, hx - hr * 0.35, hy - hr * 1.55, ANTENNA)
  fillCircle(canvas, hx + hr * 0.55, hy - hr * 1.55, u(0.014), HOLO)
  fillCircle(canvas, hx - hr * 0.35, hy - hr * 1.55, u(0.014), HOLO)

  // Olhos (dois pontos claros + pupila) na cabeça.
  const eyeDx = hr * 0.42
  const eyeDy = hr * 0.28
  const eyeR = Math.max(1, u(0.018))
  for (const ex of [hx + eyeDx, hx - eyeDx * 0.15]) {
    fillCircle(canvas, ex, hy - eyeDy, eyeR, EYE)
    fillCircle(canvas, ex, hy - eyeDy, Math.max(1, eyeR * 0.5), PUPIL)
  }

  // Realce holográfico curto no primeiro segmento.
  const first = segments[0]
  drawLine(
    canvas,
    u(first.x - first.r * 0.4),
    u(first.y - first.r * 0.45),
    u(first.x + first.r * 0.3),
    u(first.y - first.r * 0.45),
    HOLO
  )
}

function renderIcon(size) {
  const canvas = makeCanvas(size)
  drawCaterpillar(canvas)
  return downsample(canvas)
}

// ---------------------------------------------------------------------------
// ICO (ICONDIR + entradas PNG). Sem dependências.
// ---------------------------------------------------------------------------

function buildIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePng(size, size, renderIcon(size)) }))
  const count = images.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)

  const entries = []
  let offset = 6 + count * 16
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size // height
    entry[2] = 0 // color count
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(png.length, 8) // bytes in resource
    entry.writeUInt32LE(offset, 12) // offset
    entries.push(entry)
    offset += png.length
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

// ---------------------------------------------------------------------------

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const icoSizes = [256, 128, 64, 48, 32, 16]
  const ico = buildIco(icoSizes)
  writeFileSync(join(OUT_DIR, 'icon.ico'), ico)

  writeFileSync(join(OUT_DIR, 'icon.png'), encodePng(512, 512, renderIcon(512)))
  writeFileSync(join(OUT_DIR, 'tray-icon.png'), encodePng(32, 32, renderIcon(32)))
  writeFileSync(join(OUT_DIR, 'tray-icon@2x.png'), encodePng(64, 64, renderIcon(64)))

  process.stdout.write('[generate-icons] icon.ico entradas: ' + icoSizes.join(',') + '\n')
  process.stdout.write('[generate-icons] icon.png 512x512\n')
  process.stdout.write('[generate-icons] tray-icon.png 32x32\n')
  process.stdout.write('[generate-icons] tray-icon@2x.png 64x64\n')
  process.stdout.write('[generate-icons] saida: ' + OUT_DIR + '\n')
}

main()
