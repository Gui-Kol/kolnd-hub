import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRunnerLine, runRunner, RunnerError } from './benchmarkRunner'
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
        'process.stdout.write(\'{"type":"load","id":"aes"}\\n\')',
        'process.stdout.write(\'{"type":"result","v":1,"loads":[{"id":"aes","ops":[1000000],"ms":[500],"guard":"x"}]}\')'
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
