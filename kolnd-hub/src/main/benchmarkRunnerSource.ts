/**
 * Fonte do runner de benchmark executado em **processo filho**.
 *
 * Por que um processo filho (e não `worker_threads` nem Web Worker):
 * - `worker_threads` no main do Electron é o defeito comprovado: a partir da 2ª
 *   execução na mesma sessão o JS cai para interpretado (~14× mais lento) e sobra
 *   CPU girando em threads órfãs. Um processo novo tem heap/V8 limpos por execução.
 * - Web Worker no renderer é bloqueado em produção (`file://` + CSP `script-src
 *   'self'`).
 *
 * O script é CommonJS autocontido e **só** usa `node:crypto` e `node:os`: ele é
 * gravado em `<userData>/benchmark/kolnd-bench-runner.js` (não há caminho confiável
 * dentro do asar) e executado por `process.execPath` com `ELECTRON_RUN_AS_NODE=1`.
 *
 * Protocolo: uma linha de JSON por evento no stdout; nada de texto livre.
 *   {"type":"ready"}                           → aquecimento concluído; espera `go` no stdin
 *   {"type":"load","id":"integers"}            → carga concluída
 *   {"type":"result","v":1,"loads":[...]}      → resultado final (última linha)
 *   {"type":"error","message":"..."}           → falha da carga
 *   {"type":"stress","checksumOk":true,...}    → amostra do modo `stress`
 *
 * Modos:
 * - `bench` (padrão): aquece as cargas, avisa `ready` e só mede depois do `go`.
 *   A barreira elimina a cauda ociosa do multi (filhos spawnados em sequência
 *   começavam/terminavam em momentos diferentes).
 * - `stress`: carga contínua mista **sem sleep** até o processo ser morto, com
 *   checksum de integridade a cada ~500 ms. Sem duty cycle e sem worker threads:
 *   é a mecânica do CPU-Z (1 processo/thread por núcleo lógico) com prioridade
 *   BELOW_NORMAL, que mantém a CPU em 100% sem matar de fome a janela do Hub
 *   (prioridade normal).
 *
 * Trabalho **fixo** (não duração fixa): o mesmo número de operações em toda
 * repetição, para que o resultado não dependa do relógio do sistema. As
 * constantes de `WORK` foram calibradas nesta máquina (Ryzen 7 5700X) para
 * ~400–500 ms por repetição — ver `BENCHMARK_REFERENCES` em `benchmarkScore.ts`.
 */
export const BENCHMARK_RUNNER_SOURCE = `'use strict'

/**
 * Runner do benchmark de CPU do Kolnd Hub (processo filho, sem Electron).
 * Gerado pelo app; não editar à mão — o main reescreve o arquivo quando a fonte
 * embutida muda.
 */

const crypto = require('node:crypto')
const os = require('node:os')

const DEFAULT_LOADS = ['integers', 'floats', 'memory', 'aes', 'sha']
const DEFAULT_REPEATS = 3
const REPS_MIN = 1
const REPS_MAX = 5

/**
 * Prioridade BELOW_NORMAL desde o início do processo.
 *
 * É a peça que substitui o duty cycle antigo: numa máquina ociosa o processo
 * continua recebendo 100% de um núcleo, mas quando a janela do Hub (prioridade
 * normal) precisa de tempo ela passa na frente. Nunca limitamos a carga.
 */
try {
  os.setPriority(process.pid, os.constants.priority.PRIORITY_BELOW_NORMAL)
} catch (err) {
  // Sem permissão para mudar prioridade o teste continua (só não terá a folga).
}

/**
 * Trabalho fixo por carga, em unidades do kernel (iterações ou blocos de
 * criptografia). Calibrado para ~450 ms por repetição nesta máquina; o valor
 * nunca depende do relógio, então duas execuções medem exatamente o mesmo
 * trabalho. O aquecimento usa frações deste valor (descartadas).
 */
const WORK = {
  integers: 57000000,
  floats: 35000000,
  memory: 440000000,
  aes: 1000,
  sha: 16000
}

/** Unidades de "operação" por unidade de trabalho — documentadas na interface. */
const OPS_PER_WORK = {
  integers: 8, // 3 deslocamentos/xor + 2 multiply-add por rodada ARX
  floats: 5, // sin, cos, sqrt, abs e divisão por rodada
  memory: 2, // leitura + escrita por stride
  aes: 65536, // blocos de 16 bytes em um chunk de 1 MiB
  sha: 1024 // blocos de 64 bytes em um chunk de 64 KiB
}

function readConfig() {
  const raw = process.argv[2]
  const fallback = { mode: 'bench', loads: DEFAULT_LOADS.slice(), repeats: DEFAULT_REPEATS }
  if (!raw) return fallback
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (!parsed || typeof parsed !== 'object') return fallback
  const requested = Array.isArray(parsed.loads) ? parsed.loads : []
  const loads = requested.filter(
    (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(WORK, id)
  )
  const repeats = Math.min(
    REPS_MAX,
    Math.max(REPS_MIN, Math.trunc(Number(parsed.repeats)) || DEFAULT_REPEATS)
  )
  return {
    mode: parsed.mode === 'stress' ? 'stress' : 'bench',
    loads: loads.length > 0 ? loads : DEFAULT_LOADS.slice(),
    repeats: repeats
  }
}

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\\n')
}

function nowNs() {
  return process.hrtime.bigint()
}

function elapsedMs(startedAt) {
  return Number(nowNs() - startedAt) / 1e6
}

// ── Cargas determinísticas ───────────────────────────────────────
// Cada kernel devolve o número de operações do trabalho e um "guard" derivado
// dos acumuladores: sem consumir o estado, o JIT poderia eliminar o laço e o
// tempo medido deixaria de representar a carga.

/** Inteiros: xorshift32 + multiply-add (ARX), sem ponto flutuante. */
function runIntegers(work) {
  let x = 0x9e3779b9 | 0
  let y = 0x243f6a88 | 0
  let z = 0x85a308d3 | 0
  for (let i = 0; i < work; i++) {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    y = (Math.imul(y ^ x, 0x5bd1e995) + z) | 0
    z = (z + Math.imul(x ^ y, 0x27d4eb2d)) | 0
  }
  return { ops: work * OPS_PER_WORK.integers, guard: ((x ^ y ^ z) >>> 0).toString(16) }
}

/** Ponto flutuante/transcendentes: sin, cos, sqrt e divisão em cadeia. */
function runFloats(work) {
  let a = 0.5
  let b = 1.5
  let c = 2.5
  for (let i = 0; i < work; i++) {
    a = Math.sin(a + 0.001) * Math.cos(b)
    b = Math.sqrt(Math.abs(b) + 1.000001) + 0.25
    c = c * 0.999999 + a / (b + 1)
  }
  return { ops: work * OPS_PER_WORK.floats, guard: String(Math.round((a + b + c) * 1000)) }
}

/**
 * Memória: strides de 512 bytes (cache lines distintas) sobre 256 KiB.
 *
 * Por que 256 KiB por processo: o kernel roda em N processos simultâneos no
 * multi; um working set de 4 MiB por processo (64 MiB no total) não cabe no L3
 * e cada stride vira uma espera de DRAM, fazendo o multi medir latência de
 * memória em vez de CPU (medido: 1,1 GMops single → 0,15 no agregado). Com
 * 256 KiB cada thread fica na própria L2 e o multi escala com os núcleos.
 */
function runMemory(work) {
  const length = 1 << 15 // 32.768 elementos × 8 bytes = 256 KiB
  const mask = length - 1
  const buffer = new Float64Array(length)
  for (let i = 0; i < length; i++) buffer[i] = i + 1
  let index = 0
  for (let i = 0; i < work; i++) {
    index = (index + 64) & mask
    buffer[index] = buffer[index] * 1.0000001 + 1
  }
  return { ops: work * OPS_PER_WORK.memory, guard: String(Math.round(buffer[index] * 1000)) }
}

/**
 * AES-256-CTR com chunks de 1 MiB. O gargalo antigo (176 MB/s) era alocação de
 * buffer por chamada de update com chunk de 16 KiB, não CPU: com 1 MiB o AES-NI
 * domina o tempo.
 */
function runAes(work) {
  const key = Buffer.alloc(32, 7)
  const iv = Buffer.alloc(16, 3)
  const chunk = Buffer.alloc(1 << 20, 1)
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv)
  let last = chunk
  for (let i = 0; i < work; i++) last = cipher.update(chunk)
  return {
    ops: work * OPS_PER_WORK.aes,
    guard: last.length.toString(16) + ':' + last.readUInt32LE(0).toString(16)
  }
}

/** SHA-256 em chunks de 64 KiB (um bloco de 64 bytes = uma operação). */
function runSha(work) {
  const chunk = Buffer.alloc(64 * 1024, 9)
  const hash = crypto.createHash('sha256')
  for (let i = 0; i < work; i++) hash.update(chunk)
  return { ops: work * OPS_PER_WORK.sha, guard: hash.digest('hex').slice(0, 16) }
}

const KERNELS = {
  integers: runIntegers,
  floats: runFloats,
  memory: runMemory,
  aes: runAes,
  sha: runSha
}

/**
 * Aquece uma carga com dois trabalhos descartados (frações 1/16 e 1/4) para dar
 * tempo de o V8 otimizar os laços. Roda inteiro **antes** do ready, para que
 * o go libere todos os filhos já otimizados.
 */
function warmLoad(id) {
  const kernel = KERNELS[id]
  const work = WORK[id]
  kernel(Math.max(1, work >> 4))
  kernel(Math.max(1, work >> 2))
}

/** Mede as repetições pedidas (o aquecimento já aconteceu antes do ready). */
function measureLoad(id, repeats) {
  const kernel = KERNELS[id]
  const work = WORK[id]
  const ops = []
  const ms = []
  let guard = ''
  for (let rep = 0; rep < repeats; rep++) {
    const startedAt = nowNs()
    const result = kernel(work)
    const elapsed = elapsedMs(startedAt)
    ops.push(result.ops)
    ms.push(Math.round(elapsed * 1000) / 1000)
    guard = result.guard
  }
  return { id: id, ops: ops, ms: ms, guard: guard }
}

/**
 * Aquece o motor criptográfico **antes de qualquer carga**.
 *
 * Medido nesta máquina (Electron 28 / Node 18): quando a primeira operação de
 * node:crypto do processo é um hash SHA-256, o processo inteiro usa o caminho
 * sem SHA-NI (~0,5 GB/s); se um AES-CTR inicializa o contexto antes, o SHA-256
 * usa SHA-NI (~2,2 GB/s). Sem este aquecimento, a carga sha medida sozinha
 * (a repetição por instabilidade roda só ela) valia 1/4 da medida depois do AES
 * — um artefato de inicialização, não da CPU. É determinístico e custa ~0.
 */
function primeCrypto() {
  const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.alloc(32, 7), Buffer.alloc(16, 3))
  cipher.update(Buffer.alloc(16, 1))
  cipher.final()
}

/** Espera a linha go no stdin (barreira do main) e chama callback uma vez. */
function waitForGo(callback) {
  let started = false
  let buffer = ''
  const start = function () {
    if (started) return
    started = true
    process.stdin.removeAllListeners('data')
    process.stdin.pause()
    // Libera o handle do stdin: sem isso o processo não termina depois do
    // resultado (o pipe aberto mantém o event loop vivo).
    process.stdin.destroy()
    callback()
  }
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', function (chunk) {
    buffer += chunk
    let newline = buffer.indexOf('\\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line === 'go') {
        start()
        return
      }
      newline = buffer.indexOf('\\n')
    }
  })
  process.stdin.on('end', function () {
    // O main fechou o stdin sem liberar a medição: não há mais dono, encerra.
    process.exit(0)
  })
  process.stdin.resume()
}

/**
 * Amostra determinística: se o mesmo cálculo com a mesma semente divergir do
 * baseline, algo inconsistente aconteceu na CPU (erro de hardware, throttling
 * agressivo). O custo é irrisório perto da carga contínua.
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

/**
 * Carga contínua mista (inteiro + ponto flutuante) até o main matar o processo.
 *
 * Sem pausa de propósito: é um teste de estresse (a mecânica do CPU-Z é a mesma).
 * A fluidez da interface vem da prioridade BELOW_NORMAL definida no topo do
 * script — o renderer (prioridade normal) passa na frente quando disputa o
 * núcleo, e a carga nunca é capada.
 */
function runStress() {
  const seed = 0x51ed270b
  const baseline = sampleChecksum(seed)
  const startedAt = nowNs()
  let lastReportAt = startedAt
  let lastParentCheckAt = startedAt
  let x = 123456789
  let f = 1.5
  let integrous = true

  for (;;) {
    // Bloco fixo de trabalho entre verificações de relógio (~microssegundos).
    for (let i = 0; i < 8192; i++) {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      f = f * 0.9999999 + (x & 255) * 0.000001
      if (f > 1e6) f = f - 1e6
    }
    if (!Number.isFinite(f)) {
      f = 1.5
      integrous = false
    }
    const now = nowNs()
    // A cada ~2 s confere se o Hub (processo pai) ainda existe. Se ele morrer
    // sem passar pelo encerramento normal (Task Manager/crash), ninguém mais
    // vai nos matar: sem esta checagem os N processos continuariam girando a
    // CPU para sempre. Não usamos timer porque o loop é síncrono — setTimeout
    // nunca rodaria.
    if (now - lastParentCheckAt >= 2000000000n) {
      lastParentCheckAt = now
      try {
        process.kill(process.ppid, 0)
      } catch (err) {
        process.exit(0)
      }
    }
    if (now - lastReportAt >= 500000000n) {
      lastReportAt = now
      const checksumOk = integrous && sampleChecksum(seed) === baseline
      emit({
        type: 'stress',
        elapsedMs: Math.round(Number(now - startedAt) / 1e6),
        checksumOk: checksumOk
      })
    }
  }
}

function main() {
  const config = readConfig()
  if (config.mode === 'stress') {
    emit({ type: 'ready' })
    runStress()
    return
  }

  primeCrypto()
  for (let i = 0; i < config.loads.length; i++) warmLoad(config.loads[i])
  emit({ type: 'ready' })
  waitForGo(function () {
    const loads = []
    for (let i = 0; i < config.loads.length; i++) {
      const id = config.loads[i]
      emit({ type: 'load', id: id })
      loads.push(measureLoad(id, config.repeats))
    }
    emit({ type: 'result', v: 1, loads: loads })
  })
}

try {
  main()
} catch (err) {
  emit({ type: 'error', message: 'falha ao executar o runner: ' + String((err && err.message) || err) })
}
`
