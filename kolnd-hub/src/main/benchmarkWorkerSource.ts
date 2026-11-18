/**
 * Fonte do worker do **teste de estresse** (carga contínua, sem pontuação).
 *
 * O benchmark de CPU deixou de usar `worker_threads`: a partir da 2ª execução
 * na mesma sessão do app o JS dos workers caía para interpretado e sobrava CPU
 * girando (defeito comprovado). A medição agora roda em processo filho — ver
 * `benchmarkRunnerSource.ts`. O estresse continua em worker porque ele não mede
 * desempenho: precisa apenas de carga contínua e cancelamento imediato.
 *
 * Por que uma string CommonJS e não um arquivo importado: com `eval: true` o
 * worker compila a string diretamente — nada de caminho dentro do asar. O
 * worker nunca toca em Electron, disco ou rede.
 */
export const BENCHMARK_STRESS_SOURCE = `
'use strict'

const { parentPort } = require('node:worker_threads')

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
  runStress()
}
`
