import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

import {
  buildCollectorScript,
  COLLECTOR_PREFIX,
  HwCollector,
  parseCollectorLine,
  type HwCollectorChild,
  type HwCollectorClock,
  type HwCollectorSpawn
} from './collector'

describe('parseCollectorLine', () => {
  it('lê uma linha válida com id e JSON', () => {
    expect(parseCollectorLine('KOLND-HWM 7 {"gpuUsagePercent":2}')).toEqual({
      id: 7,
      payload: { gpuUsagePercent: 2 }
    })
  })

  it('aceita null como JSON válido (job sem dados)', () => {
    expect(parseCollectorLine('KOLND-HWM 2 null')).toEqual({ id: 2, payload: null })
  })

  it('ignora lixo antes do prefixo (avisos do PowerShell)', () => {
    const raw = 'WARNING: progresso\r\noutra linha\r\nKOLND-HWM 3 {"ok":true}\r\n'
    expect(parseCollectorLine(raw)).toEqual({ id: 3, payload: { ok: true } })
  })

  it('descarta a resposta de um id desconhecido', () => {
    expect(parseCollectorLine('KOLND-HWM 4 {"ok":true}', 9)).toBeNull()
    expect(parseCollectorLine('KOLND-HWM 9 {"ok":true}', 9)).toEqual({
      id: 9,
      payload: { ok: true }
    })
  })

  it('devolve null para JSON inválido', () => {
    expect(parseCollectorLine('KOLND-HWM 1 {quebrado')).toBeNull()
    expect(parseCollectorLine('KOLND-HWM 1 ')).toBeNull()
  })

  it('tolera BOM no começo da linha', () => {
    expect(parseCollectorLine('\uFEFFKOLND-HWM 5 {"a":1}')).toEqual({ id: 5, payload: { a: 1 } })
  })

  it('processa múltiplas linhas no mesmo chunk e escolhe o id esperado', () => {
    const chunk = [
      'KOLND-HWM 1 {"job":"static"}',
      'ruído entre respostas',
      'KOLND-HWM 2 {"job":"dynamic"}',
      'KOLND-HWM 3 {"job":"nvml"}'
    ].join('\n')
    expect(parseCollectorLine(chunk, 2)).toEqual({ id: 2, payload: { job: 'dynamic' } })
    expect(parseCollectorLine(chunk)).toEqual({ id: 1, payload: { job: 'static' } })
  })

  it('ignora linha vazia, entrada nula e prefixo sem id', () => {
    expect(parseCollectorLine('')).toBeNull()
    expect(parseCollectorLine('   \r\n\r\n')).toBeNull()
    expect(parseCollectorLine(null)).toBeNull()
    expect(parseCollectorLine(undefined)).toBeNull()
    expect(parseCollectorLine('KOLND-HWM')).toBeNull()
    expect(parseCollectorLine('KOLND-HWM abc {}')).toBeNull()
  })

  it('preserva espaços dentro do JSON (só separa id e carga)', () => {
    expect(parseCollectorLine('KOLND-HWM 8 {"name":"Placa Y"}')).toEqual({
      id: 8,
      payload: { name: 'Placa Y' }
    })
  })
})

describe('buildCollectorScript', () => {
  it('é ASCII puro (PowerShell 5.1 lê como ANSI)', () => {
    const script = buildCollectorScript()
    const onlyAscii = [...script].every((char) => char.charCodeAt(0) < 128)
    expect(onlyAscii).toBe(true)
  })

  it('abre a CimSession uma vez e usa o cmdlet com sessão', () => {
    const script = buildCollectorScript()
    expect(script).toContain('New-CimSession')
    expect(script).toContain('function Get-KolndCim')
    expect(script).toContain('-CimSession $script:session')
    expect(script).toContain('Win32_PhysicalMemory')
    expect(script).toContain('Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory')
  })

  it('carrega o C#/NVML no start e responde available:false sem NVIDIA', () => {
    const script = buildCollectorScript()
    expect(script).toContain('Add-Type -Path $env:KOLND_HWM_NVML_ASSEMBLY')
    expect(script).toContain('[KolndNvml]::Init($env:KOLND_HWM_NVML_DLL)')
    expect(script).toContain('[KolndNvml]::ReadFans()')
    expect(script).toContain('"available":false')
    expect(script).toContain('fanCount')
  })

  it('inclui o GPUEngine apenas no corpo dinâmico com motor 3D', () => {
    const script = buildCollectorScript()
    expect(script.match(/_engtype_3D/g)).toHaveLength(1)
    expect(script).toContain('function Get-KolndDynamic')
    expect(script).toContain('function Get-KolndDynamicNoEngine')
  })

  it('loop do protocolo responde com o prefixo e aceita quit', () => {
    const script = buildCollectorScript()
    expect(script).toContain(`${COLLECTOR_PREFIX}`)
    expect(script).toContain('KOLND-HWM ')
    expect(script).toContain('[Console]::In.ReadLine()')
    expect(script).toContain('$line -eq "quit"')
    expect(script).toContain('[KolndNvml]::Shutdown()')
    expect(script).toContain('Remove-CimSession')
  })
})

class FakeClock implements HwCollectorClock {
  private readonly timers: Array<{
    id: number
    callback: () => void
    ms: number
    cleared: boolean
  }> = []
  private nextId = 1

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId
    this.nextId += 1
    this.timers.push({ id, callback, ms, cleared: false })
    return id
  }

  clearTimeout(handle: unknown): void {
    const timer = this.timers.find((entry) => entry.id === handle)
    if (timer) timer.cleared = true
  }

  delays(): number[] {
    return this.timers.map((entry) => entry.ms)
  }

  activeTimers(): number {
    return this.timers.filter((entry) => !entry.cleared).length
  }

  /** Dispara o timer ativo mais recente (o request ou o kill de segurança). */
  fire(): void {
    const timer = [...this.timers].reverse().find((entry) => !entry.cleared)
    if (!timer) throw new Error('nenhum timer ativo')
    timer.cleared = true
    timer.callback()
  }
}

interface FakeChild extends HwCollectorChild {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: EventEmitter & {
    write: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  kill: ReturnType<typeof vi.fn>
  emit(event: string): boolean
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as unknown as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() })
  child.kill = vi.fn()
  return child
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function buildCollector(clock: FakeClock): {
  collector: HwCollector
  children: FakeChild[]
  spawn: ReturnType<typeof vi.fn>
} {
  const children: FakeChild[] = []
  const spawn = vi.fn<HwCollectorSpawn>(() => {
    const child = fakeChild()
    children.push(child)
    return child
  })
  const collector = new HwCollector({
    spawn,
    clock,
    powershellPath: () => 'C:\\ps.exe',
    loadNvmlAssets: async () => null
  })
  return { collector, children, spawn }
}

describe('HwCollector — transporte', () => {
  it('monta a resposta em partes e resolve o request pendente', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('static')
    await tick()

    expect(children).toHaveLength(1)
    expect(children[0].stdin.write).toHaveBeenCalledWith('{"id":1,"job":"static"}\n')
    children[0].stdout.emit('data', 'lixo do PowerShell\r\nKOLND-HWM 1 {"ok"')
    children[0].stdout.emit('data', ':true}\r\n')

    await expect(promise).resolves.toEqual({ ok: true })
  })

  it('serializa chamadas concorrentes (1 request em voo)', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const first = collector.request('static')
    const second = collector.request('nvml')
    await tick()

    expect(children[0].stdin.write).toHaveBeenCalledTimes(1)
    children[0].stdout.emit('data', 'KOLND-HWM 1 {"ok":true}\n')
    await expect(first).resolves.toEqual({ ok: true })
    await tick()

    expect(children[0].stdin.write).toHaveBeenCalledTimes(2)
    children[0].stdout.emit('data', 'KOLND-HWM 2 {"available":false}\n')
    await expect(second).resolves.toEqual({ available: false })
  })

  it('timeout mata o helper e a próxima chamada recria o processo', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('cim-dynamic', { includeGpuEngine: true })
    await tick()

    // O primeiro request usa o orçamento de start (8 s).
    expect(clock.delays()).toContain(8000)
    clock.fire()
    await expect(promise).rejects.toThrow('timeout de 8000 ms')
    expect(children[0].kill).toHaveBeenCalled()
    expect(collector.isDisabled()).toBe(false)

    const retry = collector.request('cim-dynamic')
    await tick()
    expect(children).toHaveLength(2)
    children[1].stdout.emit('data', 'KOLND-HWM 2 {"gpuUsagePercent":1}\n')
    await expect(retry).resolves.toEqual({ gpuUsagePercent: 1 })
    expect(collector.isDisabled()).toBe(false)
  })

  it('morre no meio do request: rejeita e permite recriar sem desativar', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('static')
    await tick()
    children[0].emit('exit')
    await expect(promise).rejects.toThrow('encerrou')

    const retry = collector.request('static')
    await tick()
    expect(children).toHaveLength(2)
    children[1].stdout.emit('data', 'KOLND-HWM 2 null\n')
    await expect(retry).resolves.toBeNull()
  })

  it('após 2 falhas seguidas desativa e não torra mais processos', async () => {
    const clock = new FakeClock()
    const { collector, children, spawn } = buildCollector(clock)

    const first = collector.request('static')
    await tick()
    clock.fire()
    await expect(first).rejects.toThrow('timeout')

    const second = collector.request('static')
    await tick()
    clock.fire()
    await expect(second).rejects.toThrow('timeout')

    expect(collector.isDisabled()).toBe(true)
    await expect(collector.request('static')).rejects.toThrow('desativado')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(children).toHaveLength(2)
  })

  it('erro de stdout inválido não desativa (só o timeout conta)', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('static')
    await tick()
    children[0].stdout.emit('data', 'KOLND-HWM 1 {quebrado\n')
    clock.fire()
    await expect(promise).rejects.toThrow('timeout')
    expect(collector.isDisabled()).toBe(false)
  })
})

describe('HwCollector — ciclo de vida (quit)', () => {
  it('stop manda quit, rejeita o request e mata à força após 1 s', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('static')
    await tick()

    collector.stop()
    await expect(promise).rejects.toThrow('encerrado')
    expect(children[0].stdin.write).toHaveBeenCalledWith('quit\n')
    expect(children[0].stdin.end).toHaveBeenCalled()
    expect(children[0].kill).not.toHaveBeenCalled()

    clock.fire()
    expect(children[0].kill).toHaveBeenCalled()
    await expect(collector.request('static')).rejects.toThrow('encerrado')
  })

  it('se o filho sair sozinho, o kill de segurança é cancelado', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    const promise = collector.request('static')
    await tick()

    collector.stop()
    await expect(promise).rejects.toThrow('encerrado')
    children[0].emit('exit')
    // O listener de exit cancela o kill de segurança agendado pelo stop.
    expect(clock.activeTimers()).toBe(0)
    expect(children[0].kill).not.toHaveBeenCalled()
  })

  it('stop sem processo é no-op e reset libera uma nova sessão', async () => {
    const clock = new FakeClock()
    const { collector, children } = buildCollector(clock)
    collector.stop()

    collector.reset()
    const promise = collector.request('static')
    await tick()
    expect(children).toHaveLength(1)
    children[0].stdout.emit('data', 'KOLND-HWM 1 null\n')
    await expect(promise).resolves.toBeNull()
  })
})
