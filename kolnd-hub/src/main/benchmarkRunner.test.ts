import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRunnerLine, runRunner, RunnerError, startRunner } from './benchmarkRunner'
import { BENCHMARK_RUNNER_SOURCE } from './benchmarkRunnerSource'

/**
 * Testes do runner em processo filho.
 *
 * Aqui o executável é o `node` do Vitest (mesmo protocolo do
 * `electron.exe` com `ELECTRON_RUN_AS_NODE=1`), então o spawn, o parse do
 * stdout, o timeout e o kill são exercitados de verdade — não com mock.
 */
const workDir = mkdtempSync(join(tmpdir(), 'kolnd-bench-runner-'))

function writeScript(name: string, source: string): string {
  const file = join(workDir, name)
  writeFileSync(file, source, 'utf8')
  return file
}

const runnerPath = writeScript('runner.js', BENCHMARK_RUNNER_SOURCE)

function isAlive(pid: number): boolean {
  try {
    // Sinal 0 só testa existência; no Windows o Node mapeia para OpenProcess.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !isAlive(pid)
}

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

describe('parser do protocolo do runner', () => {
  it('aceita evento de carga, resultado completo e erro', () => {
    expect(parseRunnerLine('{"type":"load","id":"integers"}')).toEqual({
      type: 'load',
      id: 'integers'
    })

    const result = parseRunnerLine(
      JSON.stringify({
        type: 'result',
        v: 1,
        loads: [{ id: 'sha', ops: [10, 11, 12], ms: [400, 401, 402], guard: 'abc' }]
      })
    )
    expect(result).toEqual({
      type: 'result',
      loads: [{ id: 'sha', ops: [10, 11, 12], ms: [400, 401, 402], guard: 'abc' }]
    })

    expect(parseRunnerLine('{"type":"error","message":"falhou"}')).toEqual({
      type: 'error',
      message: 'falhou'
    })
  })

  it('aceita ready e amostras do estresse (checksum só vale se for true explícito)', () => {
    expect(parseRunnerLine('{"type":"ready"}')).toEqual({ type: 'ready' })
    expect(parseRunnerLine('{"type":"stress","elapsedMs":501,"checksumOk":true}')).toEqual({
      type: 'stress',
      elapsedMs: 501,
      checksumOk: true
    })
    // Checksum ausente/estranho nunca vira "ok" por omissão.
    expect(parseRunnerLine('{"type":"stress","elapsedMs":10}')).toEqual({
      type: 'stress',
      elapsedMs: 10,
      checksumOk: false
    })
    // Tempo inválido é linha descartada.
    expect(parseRunnerLine('{"type":"stress","checksumOk":true}')).toBeNull()
    expect(parseRunnerLine('{"type":"stress","elapsedMs":-1,"checksumOk":true}')).toBeNull()
  })

  it('ignora linha parcial, texto solto e resultado inconsistente', () => {
    expect(parseRunnerLine('')).toBeNull()
    expect(parseRunnerLine('{"type":"result","loads":[{"id":"a","ops":[1]')).toBeNull()
    expect(parseRunnerLine('aviso do sistema: nada a ver')).toBeNull()
    expect(parseRunnerLine('null')).toBeNull()
    expect(parseRunnerLine('[]')).toBeNull()
    expect(parseRunnerLine('{"type":"outro"}')).toBeNull()
    // ops e ms de tamanhos diferentes, valores não positivos ou id vazio.
    expect(
      parseRunnerLine('{"type":"result","loads":[{"id":"a","ops":[1,2],"ms":[1],"guard":"g"}]}')
    ).toBeNull()
    expect(
      parseRunnerLine('{"type":"result","loads":[{"id":"a","ops":[0],"ms":[10],"guard":"g"}]}')
    ).toBeNull()
    expect(
      parseRunnerLine('{"type":"result","loads":[{"id":"","ops":[1],"ms":[10],"guard":"g"}]}')
    ).toBeNull()
    expect(parseRunnerLine('{"type":"result","loads":[]}')).toBeNull()
  })

  it('erro sem mensagem vira mensagem amigável (nunca undefined na interface)', () => {
    expect(parseRunnerLine('{"type":"error"}')).toEqual({
      type: 'error',
      message: 'Falha ao executar uma das cargas de CPU.'
    })
  })
})

describe('runner real em processo filho', () => {
  it('roda uma carga com trabalho fixo e devolve ops/ms/guard', async () => {
    const events: string[] = []
    const loads = await runRunner({
      scriptPath: runnerPath,
      config: { loads: ['integers'], repeats: 2 },
      timeoutMs: 30_000,
      onEvent: (event) => events.push(event.type)
    })

    expect(loads).toHaveLength(1)
    expect(loads[0].id).toBe('integers')
    expect(loads[0].ops).toHaveLength(2)
    expect(loads[0].ms).toHaveLength(2)
    expect(loads[0].ops[0]).toBeGreaterThan(0)
    expect(loads[0].ms[0]).toBeGreaterThan(0)
    expect(loads[0].guard.length).toBeGreaterThan(0)
    // Mesmo trabalho fixo ⇒ as duas repetições contam as mesmas operações.
    expect(loads[0].ops[0]).toBe(loads[0].ops[1])
    expect(events).toContain('load')
    expect(events[events.length - 1]).toBe('result')
  }, 60_000)

  it('tolera stderr e última linha sem quebra (stdout fechado)', async () => {
    const scriptPath = writeScript(
      'noisy.js',
      [
        "process.stderr.write('aviso irrelevante\\n')",
        'process.stdout.write(\'{"type":"ready"}\\n\')',
        "process.stdin.on('data', function (chunk) {",
        "  if (chunk.toString().indexOf('go') < 0) return",
        '  process.stdout.write(\'{"type":"load","id":"aes"}\\n\')',
        '  process.stdout.write(\'{"type":"result","v":1,"loads":[{"id":"aes","ops":[1000000],"ms":[500],"guard":"x"}]}\')',
        '  process.stdin.destroy()',
        '})',
        'process.stdin.resume()'
      ].join('\n')
    )

    const loads = await runRunner({
      scriptPath,
      config: { loads: ['aes'], repeats: 1 },
      timeoutMs: 5000
    })
    expect(loads).toEqual([{ id: 'aes', ops: [1_000_000], ms: [500], guard: 'x' }])
  }, 15_000)

  it('rejeita com mensagem amigável quando o stdout não segue o protocolo', async () => {
    const scriptPath = writeScript('garbage.js', "process.stdout.write('nada de util\\n')")
    await expect(
      runRunner({ scriptPath, config: { loads: ['aes'], repeats: 1 }, timeoutMs: 5000 })
    ).rejects.toBeInstanceOf(RunnerError)
  }, 15_000)

  it('mata o filho quando o timeout estoura', async () => {
    const scriptPath = writeScript('stuck.js', 'setInterval(function () {}, 1000)')
    let pid = 0
    const startedAt = Date.now()

    await expect(
      runRunner({
        scriptPath,
        config: { loads: ['aes'], repeats: 1 },
        timeoutMs: 400,
        onChild: (child) => {
          pid = child.pid ?? 0
        }
      })
    ).rejects.toBeInstanceOf(RunnerError)

    expect(Date.now() - startedAt).toBeLessThan(10_000)
    expect(pid).toBeGreaterThan(0)
    // O processo não pode continuar vivo depois da rejeição (sem órfãos).
    expect(await waitUntilDead(pid)).toBe(true)
  }, 20_000)
})

describe('barreira ready/go do benchmark', () => {
  it('só mede depois do go: o resultado não aparece antes da liberação', async () => {
    const session = startRunner({
      scriptPath: runnerPath,
      config: { mode: 'bench', loads: ['integers'], repeats: 1 },
      readyTimeoutMs: 60_000,
      timeoutMs: 60_000
    })

    try {
      await session.ready
      // Sem `go` o filho fica parado na barreira: nada de resultado por 500 ms.
      const beforeGo = await Promise.race([
        session.result.then(() => 'resultado'),
        new Promise<string>((resolve) => setTimeout(() => resolve('parado'), 500))
      ])
      expect(beforeGo).toBe('parado')

      session.sendGo()
      const loads = await session.result
      expect(loads).toHaveLength(1)
      expect(loads[0].id).toBe('integers')
      expect(loads[0].ops[0]).toBeGreaterThan(0)
    } finally {
      session.kill()
    }
  }, 60_000)

  it('o timeout do spawn/aquecimento é separado do timeout da medição', async () => {
    // Ready demora 600 ms (~2× o timeout da medição). Como o timer da medição
    // só começa no `go`, a execução precisa concluir mesmo assim.
    const scriptPath = writeScript(
      'slow-ready.js',
      [
        'setTimeout(function () {',
        "  process.stdin.on('data', function () {",
        '    process.stdout.write(\'{"type":"result","v":1,"loads":[{"id":"aes","ops":[1],"ms":[10],"guard":"x"}]}\\n\')',
        '    process.stdin.destroy()',
        '  })',
        '  process.stdin.resume()',
        '  process.stdout.write(\'{"type":"ready"}\\n\')',
        '}, 600)'
      ].join('\n')
    )

    const session = startRunner({
      scriptPath,
      config: { loads: ['aes'], repeats: 1 },
      readyTimeoutMs: 5000,
      timeoutMs: 300
    })
    try {
      await session.ready
      session.sendGo()
      const loads = await session.result
      expect(loads[0].id).toBe('aes')
    } finally {
      session.kill()
    }
  }, 20_000)

  it('falha e mata o filho quando o timeout do ready vence', async () => {
    const scriptPath = writeScript('never-ready.js', 'setInterval(function () {}, 1000)')
    let pid = 0
    const session = startRunner({
      scriptPath,
      config: { loads: ['aes'], repeats: 1 },
      readyTimeoutMs: 400,
      timeoutMs: 5000,
      onChild: (child) => {
        pid = child.pid ?? 0
      }
    })

    await expect(session.ready).rejects.toBeInstanceOf(RunnerError)
    await expect(session.result).rejects.toBeInstanceOf(RunnerError)
    expect(pid).toBeGreaterThan(0)
    expect(await waitUntilDead(pid)).toBe(true)
  }, 20_000)

  it('o timeout da medição conta do go e mata o filho que não responde', async () => {
    const scriptPath = writeScript(
      'hangs-after-go.js',
      [
        'process.stdout.write(\'{"type":"ready"}\\n\')',
        "process.stdin.on('data', function () {})",
        'process.stdin.resume()',
        'setInterval(function () {}, 1000)'
      ].join('\n')
    )
    let pid = 0
    const startedAt = Date.now()
    const session = startRunner({
      scriptPath,
      config: { loads: ['aes'], repeats: 1 },
      readyTimeoutMs: 10_000,
      timeoutMs: 400,
      onChild: (child) => {
        pid = child.pid ?? 0
      }
    })

    await session.ready
    session.sendGo()
    await expect(session.result).rejects.toBeInstanceOf(RunnerError)
    expect(Date.now() - startedAt).toBeLessThan(10_000)
    expect(await waitUntilDead(pid)).toBe(true)
  }, 20_000)

  it('o filho do estresse morre sozinho quando o processo pai desaparece (sem órfão)', async () => {
    // "Pai" descartável: spawna o runner em modo stress, grava o PID do filho
    // e sai na hora — simula o Hub morrendo pelo Task Manager/crash, sem
    // `will-quit`. O filho precisa detectar a morte do pai e sair sozinho.
    const pidFile = join(workDir, `stress-child-${Date.now()}.pid`)
    const parentPath = writeScript(
      'stress-parent.js',
      [
        "const { spawn } = require('node:child_process')",
        "const fs = require('node:fs')",
        'const child = spawn(process.execPath, [process.argv[2], JSON.stringify({ mode: "stress" })], {',
        '  stdio: "ignore",',
        '  detached: true',
        '})',
        'fs.writeFileSync(process.argv[3], String(child.pid))',
        'child.unref()',
        'process.exit(0)'
      ].join('\n')
    )

    const parent = spawn(process.execPath, [parentPath, runnerPath, pidFile], { stdio: 'ignore' })
    const parentCode = await new Promise<number | null>((resolve) => parent.once('close', resolve))
    expect(parentCode).toBe(0)

    const pid = Number.parseInt(readFileSync(pidFile, 'utf8'), 10)
    expect(pid).toBeGreaterThan(0)

    try {
      // O filho é separado do pai (detached) e continua vivo depois que o pai
      // sai — o cenário do Hub morto no Task Manager. Só a checagem de ppid
      // dentro do loop de carga pode encerrá-lo, a cada ~2 s.
      expect(isAlive(pid)).toBe(true)
      expect(await waitUntilDead(pid, 6000)).toBe(true)
    } finally {
      try {
        process.kill(pid)
      } catch {
        // já encerrado
      }
      rmSync(pidFile, { force: true })
    }
  }, 20_000)
})
