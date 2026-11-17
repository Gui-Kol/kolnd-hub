/**
 * Fonte do worker de benchmark e teste de estresse.
 *
 * Por que uma string CommonJS e não um arquivo importado?
 * - Como o worker recebe `eval: true`, esta versão do electron-vite (2.3) não
 *   precisa resolver `?nodeWorker` (não suportado) nem carregar um caminho
 *   separado dentro do `.asar` no app empacotado — o código viaja junto do
 *   bundle do main e o `Worker` compila a string diretamente.
 * - No modo `eval`, o worker roda como CommonJS e `require` continua
 *   disponível (validado em `benchmark.test.ts`), então `node:worker_threads`
 *   e `node:crypto` funcionam sem `import`.
 *
 * O worker nunca toca em Electron, disco ou rede: só computa, mede com
 * `process.hrtime.bigint()` e posta mensagens para o main.
 */
export const BENCHMARK_WORKER_SOURCE = `
'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const crypto = require('node:crypto')

const data = workerData && typeof workerData === 'object' ? workerData : {}
const mode = data.mode === 'stress' ? 'stress' : 'bench'
const testId = typeof data.testId === 'string' ? data.testId : 'integers'
// Limites defensivos: o renderer nunca escolhe a duração, mas o worker também
// não confia em workerData (defesa em profundidade).
const durationMs = Math.min(10000, Math.max(50, Number(data.durationMs) || 600))
const warmupMs = Math.min(200, Math.max(10, Number(data.warmupMs) || 80))

/** Deadline absoluto em nanossegundos — evita medir a duração do próprio check. */
function deadlineAfter(ms) {
  return process.hrtime.bigint() + BigInt(Math.round(ms * 1e6))
}

// ── Cargas determinísticas (implementação própria) ──────────────
// A unidade "operação" é a contagem elementar de cada kernel; o score usa a
// mesma unidade nos cinco testes para que a média geométrica seja comparável
// dentro desta máquina (e não com escalas de terceiros).

/** Inteiros: xorshift32 + multiply-add (ARX), sem ponto flutuante. */
function integers(endNs) {
  let ops = 0
  let x = 0x9e3779b9 | 0
  let y = 0x243f6a88 | 0
  let z = 0x85a308d3 | 0
  while (process.hrtime.bigint() < endNs) {
    for (let i = 0; i < 2048; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      y = (Math.imul(y ^ x, 0x5bd1e995) + z) | 0
      z = (z + Math.imul(x ^ y, 0x27d4eb2d)) | 0
      ops += 8
    }
  }
  // Consome os acumuladores: sem isso o JIT poderia eliminar o laço inteiro.
  if ((x ^ y ^ z) === 0x12345678) ops += 1
  return ops
}

/** Ponto flutuante/transcendentes: sin, cos, sqrt e divisão em cadeia. */
function floats(endNs) {
  let ops = 0
  let a = 0.5
  let b = 1.5
  let c = 2.5
  while (process.hrtime.bigint() < endNs) {
    for (let i = 0; i < 2048; i++) {
      a = Math.sin(a + 0.001) * Math.cos(b)
      b = Math.sqrt(Math.abs(b) + 1.000001) + 0.25
      c = c * 0.999999 + a / (b + 1)
      ops += 5
    }
  }
  if (a + b + c === Infinity) ops += 1
  return ops
}

/** Memória: banda com strides sobre um Float64Array (cache lines distintas). */
function memory(endNs) {
  const length = 1 << 19 // 524.288 elementos × 8 bytes = 4 MiB
  const mask = length - 1
  const buf = new Float64Array(length)
  for (let i = 0; i < length; i++) buf[i] = i + 1
  let ops = 0
  let idx = 0
  while (process.hrtime.bigint() < endNs) {
    for (let i = 0; i < 8192; i++) {
      idx = (idx + 64) & mask
      buf[idx] = buf[idx] * 1.0000001 + 1
      ops += 2 // leitura + escrita
    }
  }
  if (Number.isNaN(buf[idx])) ops += 1
  return ops
}

/** AES-256-CTR: uma operação por bloco de 16 bytes (usa AES-NI quando há). */
function aes(endNs) {
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(16, 3)
  const chunk = Buffer.alloc(16 * 1024, 1)
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv)
  let ops = 0
  while (process.hrtime.bigint() < endNs) {
    cipher.update(chunk)
    ops += chunk.length / 16
  }
  return ops
}

/** SHA-256: uma operação por bloco de 64 bytes. */
function sha(endNs) {
  const chunk = Buffer.alloc(64 * 1024, 9)
  const hash = crypto.createHash('sha256')
  let ops = 0
  while (process.hrtime.bigint() < endNs) {
    hash.update(chunk)
    ops += chunk.length / 64
  }
  hash.digest() // fecha o estado; o resultado em si é descartado
  return ops
}

const KERNELS = {
  integers: integers,
  floats: floats,
  memory: memory,
  aes: aes,
  sha: sha
}

/**
 * Amostra determinística usada só pelo teste de estresse: se o mesmo cálculo
 * com a mesma semente divergir do baseline, algo inconsistente aconteceu na CPU
 * (por exemplo, erro de hardware ou throttling agressivo). O custo é irrisório
 * perto da carga contínua.
 */
function sampleChecksum(seed) {
  let x = seed | 0
  let f = 0.25
  for (let i = 0; i < 512; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    f = f * 1.0000001 + (x & 1023) / 1024
    if (f > 1000) f = f - 999
  }
  return (x >>> 0) * 1000003 + Math.round(f * 1000)
}

/** Mede uma carga: warmup curto descartado e depois a duração pedida. */
function runBench() {
  const kernel = KERNELS[testId]
  if (typeof kernel !== 'function') {
    parentPort.postMessage({ type: 'error', message: 'Carga de benchmark desconhecida.' })
    return
  }
  try {
    kernel(deadlineAfter(warmupMs))
    const startedAt = process.hrtime.bigint()
    const ops = kernel(startedAt + BigInt(Math.round(durationMs * 1e6)))
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
    parentPort.postMessage({
      type: 'result',
      testId: testId,
      ops: ops,
      elapsedMs: elapsedMs
    })
  } catch (err) {
    parentPort.postMessage({
      type: 'error',
      message: 'Falha ao executar a carga de benchmark.'
    })
  }
}

/**
 * Carga contínua mista (inteiro + ponto flutuante) até o main chamar
 * terminate(). A cada ~500 ms reporta o checksum de integridade.
 *
 * Por que existe o duty cycle (e por que o loop NÃO fica 100 % do tempo
 * computando): sem nenhuma pausa, N threads girando em ponto livre saturam
 * todos os núcleos lógicos e o renderer do Electron passa a perder timeslice
 * por segundos — a janela "não responde" (reproduzido em teste E2E com travas
 * de 1,5–3,1 s). Dormir alguns ms por fatia mantém a carga alta e o app
 * utilizável. Atomics.wait bloqueia o thread do worker sem timer, então o
 * sleep é preciso e não gera wakeups de event loop.
 */
function runStress() {
  const seed = 0x51ed270b
  const baseline = sampleChecksum(seed)
  const startedAt = process.hrtime.bigint()
  const sleepCell = new Int32Array(new SharedArrayBuffer(4))
  // 12 ms computando + 3 ms dormindo ≈ 80 % de carga por thread.
  const computeNs = 12000000n
  const sleepMs = 3
  let lastReportAt = startedAt
  let x = 123456789
  let f = 1.5
  let integrous = true

  while (true) {
    const sliceEnd = process.hrtime.bigint() + computeNs
    while (process.hrtime.bigint() < sliceEnd) {
      for (let i = 0; i < 4096; i++) {
        x ^= x << 13
        x ^= x >>> 17
        x ^= x << 5
        f = f * 0.9999999 + (x & 255) * 0.000001
        if (f > 1e6) f = f - 1e6
      }
    }
    if (!Number.isFinite(f)) {
      f = 1.5
      integrous = false
    }
    const now = process.hrtime.bigint()
    if (now - lastReportAt >= 500000000n) {
      lastReportAt = now
      const checksumOk = integrous && sampleChecksum(seed) === baseline
      parentPort.postMessage({
        type: 'stress',
        elapsedMs: Number(now - startedAt) / 1e6,
        checksumOk: checksumOk
      })
    }
    Atomics.wait(sleepCell, 0, 0, sleepMs)
  }
}

if (parentPort) {
  parentPort.postMessage({ type: 'ready' })
  if (mode === 'stress') runStress()
  else runBench()
}
`
