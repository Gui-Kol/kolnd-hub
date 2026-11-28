#!/usr/bin/env node
/**
 * capture-avatar.cjs - harness de evidencia visual do Absolem (task 23).
 *
 * O main do app faz a captura com `webContents.capturePage()` quando
 * `ABSOLEM_VISUAL_DIR` esta definido e o app nao esta empacotado. Este script
 * apenas:
 *   1. prepara um userData temporario (fora do perfil real do usuario);
 *   2. sobe o app buildado com um userData temporario. As flags de QA do
 *      renderer sao gated por `import.meta.env.DEV`; no build de producao o
 *      main do harness aplica o mesmo estado/nivel pelos canais de IPC e monta
 *      a rota com as flags para o modo dev;
 *   3. espera o marcador `done.json` e encerra o processo se preciso;
 *   4. valida cada PNG (tamanho > 0, dimensoes, variancia de pixels > 0).
 *
 * Sem dependencia nova: o PNG e decodificado com o `zlib` nativo do Node.
 *
 * Uso:
 *   node scripts/visual/capture-avatar.cjs
 *   node scripts/visual/capture-avatar.cjs --dir C:\Temp\absolem-visual --sizes 320x360
 *
 * Opcoes (as mesmas variaveis tambem podem vir do ambiente):
 *   --dir <path>        diretorio base; um subdiretorio run-* e criado
 *   --states <lista>    default: idle,listening,speaking,thinking,error
 *   --sizes <lista>     default: 320x360,480x560
 *   --look <look>       default: storybook
 *   --fake-voice        acrescenta fakeVoice=1 a rota
 *   --scale <n>         escala do tema (0.8, 1.5) antes da captura
 *   --hold-ms <ms>      mantem o app aberto depois das capturas (perf)
 *   --timeout-ms <ms>   teto total da execucao (default: 180000)
 */

'use strict'

const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const APP_ROOT = path.resolve(__dirname, '..', '..')
const ELECTRON_VITE = path.join(
  APP_ROOT,
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js'
)
const ELECTRON_BIN = path.join(APP_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DEFAULT_STATES = ['idle', 'listening', 'speaking', 'thinking', 'error']
const DEFAULT_SIZES = [
  { width: 320, height: 360 },
  { width: 480, height: 560 }
]
const MIN_WIDTH = 240
const MAX_WIDTH = 480
const MIN_HEIGHT = 260
const MAX_HEIGHT = 560

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }
    options[key] = next
    index += 1
  }
  return options
}

function splitList(value) {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseStates(value) {
  const states = []
  for (const item of splitList(value)) {
    if (!DEFAULT_STATES.includes(item) || states.includes(item)) continue
    states.push(item)
  }
  return states.length > 0 ? states : [...DEFAULT_STATES]
}

function parseSizes(value) {
  const sizes = []
  for (const item of splitList(value)) {
    const match = /^(\d+)x(\d+)$/i.exec(item)
    if (!match) continue
    const width = Number(match[1])
    const height = Number(match[2])
    if (width < MIN_WIDTH || width > MAX_WIDTH) continue
    if (height < MIN_HEIGHT || height > MAX_HEIGHT) continue
    if (sizes.some((size) => size.width === width && size.height === height)) continue
    sizes.push({ width, height })
  }
  return sizes.length > 0 ? sizes : DEFAULT_SIZES.map((size) => ({ ...size }))
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset)
}

/** Decodifica PNG 8-bit nao entrelacado (RGBA/RGB/cinza/cinza+alfa). */
function decodePng(buffer) {
  if (buffer.length < 8 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error('assinatura PNG invalida')
  }

  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []

  while (offset + 8 <= buffer.length) {
    const length = readUInt32(buffer, offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length) throw new Error(`chunk PNG truncado: ${type}`)
    const data = buffer.subarray(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = readUInt32(data, 0)
      height = readUInt32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }

  if (!width || !height) throw new Error('IHDR ausente')
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} nao suportado`)
  if (interlace !== 0) throw new Error('PNG entrelacado nao suportado')
  const channelsByType = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const channels = channelsByType[colorType]
  if (!channels) throw new Error(`colorType ${colorType} nao suportado`)
  if (idat.length === 0) throw new Error('IDAT ausente')

  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  let rawOffset = 0
  let pixelOffset = 0

  for (let row = 0; row < height; row += 1) {
    const filter = raw[rawOffset]
    rawOffset += 1
    const line = raw.subarray(rawOffset, rawOffset + stride)
    rawOffset += stride
    for (let column = 0; column < stride; column += 1) {
      const left = column >= channels ? pixels[pixelOffset + column - channels] : 0
      const up = row > 0 ? pixels[pixelOffset + column - stride] : 0
      const upLeft =
        row > 0 && column >= channels ? pixels[pixelOffset + column - stride - channels] : 0
      let value = line[column]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += Math.floor((left + up) / 2)
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const distanceLeft = Math.abs(estimate - left)
        const distanceUp = Math.abs(estimate - up)
        const distanceUpLeft = Math.abs(estimate - upLeft)
        if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) value += left
        else if (distanceUp <= distanceUpLeft) value += up
        else value += upLeft
      } else if (filter !== 0) {
        throw new Error(`filtro PNG desconhecido: ${filter}`)
      }
      pixels[pixelOffset + column] = value & 0xff
    }
    pixelOffset += stride
  }

  return { width, height, channels, pixels }
}

/**
 * Variancia RGB depois de compor sobre branco. Uma janela transparente que
 * capturou so alfa vira branco uniforme e falha aqui, como deve.
 */
function analyzePng(buffer) {
  const image = decodePng(buffer)
  const { width, height, channels, pixels } = image
  let count = 0
  let alphaCount = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumR2 = 0
  let sumG2 = 0
  let sumB2 = 0
  const unique = new Set()

  for (let index = 0; index < pixels.length; index += channels) {
    let r
    let g
    let b
    let alpha = 255
    if (channels === 1) {
      r = g = b = pixels[index]
    } else if (channels === 2) {
      r = g = b = pixels[index]
      alpha = pixels[index + 1]
    } else {
      r = pixels[index]
      g = pixels[index + 1]
      b = pixels[index + 2]
      if (channels === 4) alpha = pixels[index + 3]
    }
    if (alpha > 0) alphaCount += 1
    const rw = Math.round((r * alpha + 255 * (255 - alpha)) / 255)
    const gw = Math.round((g * alpha + 255 * (255 - alpha)) / 255)
    const bw = Math.round((b * alpha + 255 * (255 - alpha)) / 255)
    sumR += rw
    sumG += gw
    sumB += bw
    sumR2 += rw * rw
    sumG2 += gw * gw
    sumB2 += bw * bw
    count += 1
    if (unique.size <= 4096) unique.add((rw << 16) | (gw << 8) | bw)
  }

  const varianceOf = (sum, sumSquares) => {
    const mean = sum / count
    return Math.max(0, sumSquares / count - mean * mean)
  }
  const variance = (varianceOf(sumR, sumR2) + varianceOf(sumG, sumG2) + varianceOf(sumB, sumB2)) / 3

  return {
    width,
    height,
    pixels: count,
    alphaPixels: alphaCount,
    variance,
    uniqueColors: unique.size
  }
}

function formatNumber(value, decimals) {
  return Number(value).toFixed(decimals)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function killTree(pid) {
  if (!pid) return
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const baseDir =
    typeof options.dir === 'string'
      ? path.resolve(options.dir)
      : path.join(os.tmpdir(), 'absolem-visual')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = path.join(baseDir, `run-${stamp}`)
  fs.mkdirSync(runDir, { recursive: true })

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'absolem-visual-userdata-'))
  // Primeira execucao nao deve abrir Configuracoes no meio da captura.
  fs.writeFileSync(path.join(userData, 'first-run-complete.flag'), '1', 'utf8')

  const states = parseStates(options.states ?? process.env.ABSOLEM_VISUAL_STATES)
  const sizes = parseSizes(options.sizes ?? process.env.ABSOLEM_VISUAL_SIZES)
  const look =
    typeof options.look === 'string' ? options.look : process.env.ABSOLEM_VISUAL_LOOK || 'storybook'
  const fakeVoice = options['fake-voice'] === true || process.env.ABSOLEM_VISUAL_FAKE_VOICE === '1'
  const scale =
    typeof options.scale === 'string' ? options.scale : process.env.ABSOLEM_VISUAL_SCALE || ''
  const holdMs =
    Number.parseInt(options['hold-ms'] ?? process.env.ABSOLEM_VISUAL_HOLD_MS ?? '0', 10) || 0
  const timeoutMs = Math.max(
    30_000,
    Number.parseInt(options['timeout-ms'] ?? '180000', 10) || 180_000
  )

  const env = {
    ...process.env,
    ABSOLEM_VISUAL_DIR: runDir,
    ABSOLEM_VISUAL_STATES: states.join(','),
    ABSOLEM_VISUAL_SIZES: sizes.map((size) => `${size.width}x${size.height}`).join(','),
    ABSOLEM_VISUAL_LOOK: look,
    ABSOLEM_TEST_USERDATA: userData,
    ABSOLEM_TEST_TRANSPORT: 'fake'
  }
  if (fakeVoice) env.ABSOLEM_VISUAL_FAKE_VOICE = '1'
  if (scale) env.ABSOLEM_VISUAL_SCALE = String(scale)
  if (holdMs > 0) env.ABSOLEM_VISUAL_HOLD_MS = String(holdMs)

  if (!fs.existsSync(ELECTRON_BIN)) {
    throw new Error(`electron nao encontrado em ${ELECTRON_BIN}`)
  }

  console.log(`[captura] diretorio: ${runDir}`)
  console.log(`[captura] estados: ${states.join(',')}`)
  console.log(
    `[captura] tamanhos: ${sizes.map((size) => `${size.width}x${size.height}`).join(',')}`
  )
  console.log(`[captura] look: ${look}${fakeVoice ? ' (fakeVoice=1)' : ''}`)

  if (options['skip-build'] !== true) {
    console.log('[captura] build do app (electron-vite build)...')
    const build = spawnSync(process.execPath, [ELECTRON_VITE, 'build'], {
      cwd: APP_ROOT,
      stdio: 'inherit',
      windowsHide: false
    })
    if (build.status !== 0) {
      throw new Error(`build falhou com exit code ${build.status}`)
    }
  }

  const child = spawn(ELECTRON_BIN, ['.'], {
    cwd: APP_ROOT,
    env,
    stdio: 'inherit',
    windowsHide: false
  })

  const donePath = path.join(runDir, 'done.json')
  const startedAt = Date.now()
  let finished = false
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(donePath)) {
      finished = true
      break
    }
    if (child.exitCode !== null) break
    await sleep(500)
  }

  if (!finished) {
    console.error('[captura] timeout ou encerramento sem done.json')
  }
  // O app grava done.json e pede o quit; o electron-vite pode ficar vivo por
  // alguns instantes. Damos tempo e derrubamos a arvore para nao deixar orfao.
  await sleep(1500)
  if (child.exitCode === null) killTree(child.pid)
  await sleep(300)

  const expected = []
  for (const size of sizes) {
    for (const state of states) expected.push(`${look}-${state}-${size.width}x${size.height}.png`)
  }

  let report = null
  const metricsPath = path.join(runDir, 'metrics.json')
  if (fs.existsSync(metricsPath)) {
    try {
      report = JSON.parse(fs.readFileSync(metricsPath, 'utf8'))
    } catch (err) {
      console.error(`[captura] metrics.json ilegivel: ${err.message}`)
    }
  }

  const lines = []
  let failures = 0
  for (const file of expected) {
    const filePath = path.join(runDir, file)
    if (!fs.existsSync(filePath)) {
      failures += 1
      lines.push(`FALHA  ${file}  arquivo ausente`)
      continue
    }
    const buffer = fs.readFileSync(filePath)
    if (buffer.length === 0) {
      failures += 1
      lines.push(`FALHA  ${file}  0 byte`)
      continue
    }
    try {
      const stats = analyzePng(buffer)
      const ok = stats.variance > 0 && stats.uniqueColors > 1 && stats.alphaPixels === stats.pixels
      if (!ok) failures += 1
      lines.push(
        `${ok ? 'OK    ' : 'FALHA '} ${file}  bytes=${buffer.length}  ` +
          `pixels=${stats.width}x${stats.height}  variancia=${formatNumber(stats.variance, 4)}  ` +
          `cores=${stats.uniqueColors}  opacos=${stats.alphaPixels}/${stats.pixels}`
      )
    } catch (err) {
      failures += 1
      lines.push(`FALHA  ${file}  PNG invalido: ${err.message}`)
    }
  }

  console.log('\n[captura] validacao:')
  for (const line of lines) console.log(`  ${line}`)

  if (report && Array.isArray(report.captures)) {
    console.log('\n[captura] getMetrics() por arquivo:')
    for (const entry of report.captures) {
      const metrics = entry.metrics
      const metricText = metrics
        ? `fps=${metrics.fps} frameMs=${metrics.frameMs} draws=${metrics.drawCalls} tris=${metrics.triangles} deg=${metrics.degradation}`
        : 'metrics=null'
      console.log(`  ${entry.file}  ${metricText}${entry.error ? `  erro=${entry.error}` : ''}`)
    }
    if (report.finalMetrics) {
      const m = report.finalMetrics
      console.log(
        `  final  fps=${m.fps} frameMs=${m.frameMs} draws=${m.drawCalls} tris=${m.triangles} deg=${m.degradation}`
      )
    }
  }

  try {
    fs.rmSync(userData, { recursive: true, force: true })
  } catch {
    // userData temporario: falha de limpeza nao invalida a evidencia.
  }

  const ok = failures === 0 && report !== null && report.error === null
  console.log(
    `\n[captura] resultado: ${ok ? 'OK' : 'FALHA'} (${expected.length - failures}/${expected.length} PNGs validos)`
  )
  console.log(`[captura] saida: ${runDir}`)
  process.exitCode = ok ? 0 : 1
}

main().catch((err) => {
  console.error(`[captura] erro fatal: ${err && err.stack ? err.stack : err}`)
  process.exitCode = 1
})
