import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DISPLAY_CONFIRM_TIMEOUT_MS, type DisplaySetResult } from '../shared/display'
import type { IpcContext } from './ipc/lifecycle'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  once: vi.fn(),
  runPowerShellCommand: vi.fn(),
  send: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle },
  app: { once: mocks.once }
}))
vi.mock('./logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./hwmon/powershell', () => ({
  runPowerShellCommand: mocks.runPowerShellCommand
}))

import {
  parseDisplayProbe,
  registerDisplayIpc,
  resetDisplayConfirmationForTests
} from './displaySettings'

type Handler = (event: unknown, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

const PROBE_TWO_MONITORS = JSON.stringify({
  ok: true,
  displays: [
    {
      id: '\\\\.\\DISPLAY1',
      name: 'DELL U2720Q',
      primary: true,
      width: 1920,
      height: 1080,
      refreshHz: 165,
      modes: [
        { width: 1920, height: 1080, refreshHz: 60 },
        { width: 1920, height: 1080, refreshHz: 165 },
        { width: 1920, height: 1080, refreshHz: 120 },
        { width: 2560, height: 1440, refreshHz: 60 },
        { width: 1280, height: 720, refreshHz: 60 }
      ],
      scale: { minRel: 0, curRel: 0, maxRel: 3 },
      preferred: { width: 1920, height: 1080 }
    },
    {
      id: '\\\\.\\DISPLAY2',
      name: 'Monitor Ação',
      primary: false,
      width: 2560,
      height: 1440,
      refreshHz: 144,
      modes: [
        { width: 2560, height: 1440, refreshHz: 144 },
        { width: 2560, height: 1440, refreshHz: 60 },
        { width: 1280, height: 720, refreshHz: 60 }
      ],
      scale: null,
      preferred: { width: 2560, height: 1440 }
    }
  ]
})

const APPLY_OK = '{"ok":true,"rc":0}'

function ok(stdout: string): {
  stdout: string
  stderr: string
  code: number
  timedOut: boolean
} {
  return { stdout, stderr: '', code: 0, timedOut: false }
}

function getHandler(channel: string): Handler {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} não registrado`)
  return handler
}

function createContext(): IpcContext {
  const window = {
    isDestroyed: () => false,
    webContents: { send: mocks.send }
  }
  return {
    getMainWindow: () => window as unknown as ReturnType<IpcContext['getMainWindow']>,
    processManager: {} as IpcContext['processManager']
  }
}

function register(): void {
  registerDisplayIpc(createContext())
}

/** Deixa as promessas do revert (não aguardado pelo timer) terminarem. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  handlers.clear()
  resetDisplayConfirmationForTests()
  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  // Default: toda aplicação/revert do script responde sucesso; cada teste
  // enfileira o probe (e falhas pontuais) com mockResolvedValueOnce.
  mocks.runPowerShellCommand.mockResolvedValue(ok(APPLY_OK))
})

afterEach(() => {
  resetDisplayConfirmationForTests()
  vi.useRealTimers()
})

describe('parseDisplayProbe', () => {
  it('lê a última linha JSON válida e monta todos os monitores', () => {
    const info = parseDisplayProbe(`ruído do PowerShell\n\n${PROBE_TWO_MONITORS}\n`)
    expect(info.ok).toBe(true)
    expect(info.displays).toHaveLength(2)

    const [primary, secondary] = info.displays
    expect(primary).toMatchObject({
      id: '\\\\.\\DISPLAY1',
      name: 'DELL U2720Q',
      primary: true,
      width: 1920,
      height: 1080,
      refreshHz: 165
    })
    expect(primary.scale).toEqual({
      current: 100,
      recommended: 100,
      options: [100, 125, 150, 175]
    })
    expect(primary.resolutions.map((r) => `${r.width}x${r.height}`)).toEqual([
      '2560x1440',
      '1920x1080',
      '1280x720'
    ])
    expect(primary.resolutions[1].refreshRates).toEqual([165, 120, 60])
    expect(primary.resolutions[1].recommended).toBe(true)

    // Nome acentuado sobrevive ao JSON e a escala ausente vira null.
    expect(secondary.name).toBe('Monitor Ação')
    expect(secondary.primary).toBe(false)
    expect(secondary.scale).toBeNull()
    expect(secondary.resolutions[0].refreshRates).toEqual([144, 60])
    expect(secondary.resolutions[0].recommended).toBe(true)
  })

  it('JSON inválido devolve ok:false sem lançar', () => {
    const info = parseDisplayProbe('{ isso não é json }')
    expect(info.ok).toBe(false)
    expect(info.error).toContain('Não foi possível')
    expect(info.displays).toEqual([])
  })

  it('stdout vazio devolve ok:false sem lançar', () => {
    expect(parseDisplayProbe('').ok).toBe(false)
    expect(parseDisplayProbe('\n  \n').ok).toBe(false)
  })

  it('campos ausentes ou inválidos devolvem ok:false', () => {
    const noDisplays = JSON.stringify({ ok: true })
    expect(parseDisplayProbe(noDisplays).ok).toBe(false)

    const empty = JSON.stringify({ ok: true, displays: [] })
    expect(parseDisplayProbe(empty).ok).toBe(false)

    const malformedId = JSON.stringify({
      ok: true,
      displays: [
        {
          id: "\\\\.\\DISPLAY1'; calc",
          name: 'X',
          primary: true,
          width: 1920,
          height: 1080,
          refreshHz: 60,
          modes: [{ width: 1920, height: 1080, refreshHz: 60 }],
          scale: null,
          preferred: null
        }
      ]
    })
    expect(parseDisplayProbe(malformedId).ok).toBe(false)

    const noModes = JSON.stringify({
      ok: true,
      displays: [
        {
          id: '\\\\.\\DISPLAY1',
          name: 'X',
          primary: true,
          width: 1920,
          height: 1080,
          refreshHz: 60,
          modes: [],
          scale: null,
          preferred: null
        }
      ]
    })
    expect(parseDisplayProbe(noModes).ok).toBe(false)

    const fractional = JSON.stringify({
      ok: true,
      displays: [
        {
          id: '\\\\.\\DISPLAY1',
          name: 'X',
          primary: true,
          width: 1920.5,
          height: 1080,
          refreshHz: 60,
          modes: [{ width: 1920, height: 1080, refreshHz: 60 }],
          scale: null,
          preferred: null
        }
      ]
    })
    expect(parseDisplayProbe(fractional).ok).toBe(false)
  })

  it('traduz o token de erro do PowerShell', () => {
    const info = parseDisplayProbe('{"ok":false,"error":"mode"}')
    expect(info.ok).toBe(false)
    expect(info.error).toContain('monitores')
  })

  it('escala inválida degrada para null sem derrubar o monitor', () => {
    const raw = JSON.stringify({
      ok: true,
      displays: [
        {
          id: '\\\\.\\DISPLAY1',
          name: 'Monitor 1',
          primary: true,
          width: 1920,
          height: 1080,
          refreshHz: 60,
          modes: [{ width: 1920, height: 1080, refreshHz: 60 }],
          scale: { minRel: 0, curRel: 0, maxRel: 99 },
          preferred: null
        }
      ]
    })
    const info = parseDisplayProbe(raw)
    expect(info.ok).toBe(true)
    expect(info.displays[0].scale).toBeNull()
  })

  it('descarta monitores duplicados e completa nome vazio', () => {
    const raw = JSON.stringify({
      ok: true,
      displays: [
        {
          id: '\\\\.\\DISPLAY1',
          name: '',
          primary: true,
          width: 1920,
          height: 1080,
          refreshHz: 60,
          modes: [{ width: 1920, height: 1080, refreshHz: 60 }],
          scale: null,
          preferred: null
        },
        {
          id: '\\\\.\\DISPLAY1',
          name: 'Duplicado',
          primary: false,
          width: 1920,
          height: 1080,
          refreshHz: 60,
          modes: [{ width: 1920, height: 1080, refreshHz: 60 }],
          scale: null,
          preferred: null
        }
      ]
    })
    const info = parseDisplayProbe(raw)
    expect(info.ok).toBe(true)
    expect(info.displays).toHaveLength(1)
    expect(info.displays[0].name).toBe('Monitor 1')
  })
})

describe('registerDisplayIpc', () => {
  it('registra os canais e o will-quit', () => {
    register()
    expect([...handlers.keys()].sort()).toEqual([
      'display:confirm-change',
      'display:get',
      'display:revert-change',
      'display:set-resolution',
      'display:set-scale'
    ])
    expect(mocks.once).toHaveBeenCalledWith('will-quit', expect.any(Function))
  })

  it('display:get devolve todos os monitores', async () => {
    mocks.runPowerShellCommand.mockResolvedValue(ok(PROBE_TWO_MONITORS))
    register()

    const info = (await getHandler('display:get')({})) as { ok: boolean; displays: unknown[] }
    expect(info.ok).toBe(true)
    expect(info.displays).toHaveLength(2)
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)
  })

  it('rejeita displayId inválido sem executar PowerShell', async () => {
    register()
    const handler = getHandler('display:set-resolution')

    const invalidIds: unknown[] = [
      '',
      'DISPLAY1',
      '\\\\.\\DISPLAY1234',
      "\\\\.\\DISPLAY1'; Remove-Item -Recurse C:\\",
      '\\\\.\\DISPLAY1\nStart-Process calc',
      `\\\\.\\DISPLAY${'1'.repeat(40)}`,
      null,
      42
    ]
    for (const displayId of invalidIds) {
      const result = (await handler({}, displayId, 1920, 1080, 60)) as {
        ok: boolean
        error?: string
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Monitor inválido.')
    }
    expect(mocks.runPowerShellCommand).not.toHaveBeenCalled()
  })

  it('rejeita resolução ou taxa inválida sem executar PowerShell', async () => {
    register()
    const handler = getHandler('display:set-resolution')

    const invalidModes: Array<[unknown, unknown, unknown, string]> = [
      [1920.5, 1080, 60, 'Resolução inválida.'],
      ['1920', 1080, 60, 'Resolução inválida.'],
      [100, 1080, 60, 'Resolução inválida.'],
      [1920, 100, 60, 'Resolução inválida.'],
      [20000, 1080, 60, 'Resolução inválida.'],
      [Number.NaN, 1080, 60, 'Resolução inválida.'],
      [1920, 1080, 10, 'Taxa de atualização inválida.'],
      [1920, 1080, 1001, 'Taxa de atualização inválida.'],
      [1920, 1080, 144.5, 'Taxa de atualização inválida.'],
      [1920, 1080, '144', 'Taxa de atualização inválida.']
    ]
    for (const [width, height, hz, message] of invalidModes) {
      const result = (await handler({}, '\\\\.\\DISPLAY1', width, height, hz)) as {
        ok: boolean
        error?: string
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe(message)
    }
    expect(mocks.runPowerShellCommand).not.toHaveBeenCalled()
  })

  it('aplica resolução e taxa no monitor escolhido e devolve o ticket', async () => {
    mocks.runPowerShellCommand
      .mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
      .mockResolvedValueOnce(ok(APPLY_OK))
    register()
    const handler = getHandler('display:set-resolution')

    const result = (await handler({}, '\\\\.\\DISPLAY2', 1920, 1080, 144)) as DisplaySetResult
    expect(result).toEqual({
      ok: true,
      change: {
        id: expect.any(Number),
        timeoutMs: DISPLAY_CONFIRM_TIMEOUT_MS,
        deadline: expect.any(Number)
      }
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
    const command = mocks.runPowerShellCommand.mock.calls[1][0] as string
    expect(command).toContain("$action = 'SetResolution'")
    expect(command).toContain("$argDevice = '\\\\.\\DISPLAY2'")
    expect(command).toContain('$argW = 1920')
    expect(command).toContain('$argH = 1080')
    expect(command).toContain('$argHz = 144')
  })

  it('recusa monitor fora do probe atual', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    register()
    const handler = getHandler('display:set-resolution')

    await expect(handler({}, '\\\\.\\DISPLAY3', 1920, 1080, 60)).resolves.toEqual({
      ok: false,
      error: 'Monitor não encontrado.'
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)
  })

  it('traduz a recusa do Windows e trata timeout/resposta inválida', async () => {
    register()
    const handler = getHandler('display:set-resolution')

    mocks.runPowerShellCommand
      .mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
      .mockResolvedValueOnce(ok('{"ok":false,"rc":-2}'))
    await expect(handler({}, '\\\\.\\DISPLAY1', 1280, 720, 60)).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('não é compatível')
    })

    mocks.runPowerShellCommand
      .mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
      .mockResolvedValueOnce(ok('{"ok":false,"rc":-100}'))
    await expect(handler({}, '\\\\.\\DISPLAY1', 1280, 720, 75)).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('não está disponível')
    })

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS)).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      code: null,
      timedOut: true
    })
    await expect(handler({}, '\\\\.\\DISPLAY1', 1920, 1080, 60)).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('demorou demais')
    })

    mocks.runPowerShellCommand
      .mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
      .mockResolvedValueOnce(ok('lixo'))
    await expect(handler({}, '\\\\.\\DISPLAY1', 1920, 1080, 60)).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('Não foi possível')
    })
  })

  it('rejeita displayId e percentual inválidos sem executar PowerShell', async () => {
    register()
    const handler = getHandler('display:set-scale')

    for (const displayId of ['', 'DISPLAY2', "\\\\.\\DISPLAY2'; calc", null]) {
      const result = (await handler({}, displayId, 125)) as { ok: boolean; error?: string }
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Monitor inválido.')
    }
    for (const percent of [110, 5000, -100, 125.5, '125', null]) {
      const result = (await handler({}, '\\\\.\\DISPLAY1', percent)) as {
        ok: boolean
        error?: string
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe('Escala inválida.')
    }
    expect(mocks.runPowerShellCommand).not.toHaveBeenCalled()
  })

  it('aplica a escala no monitor escolhido e devolve o ticket', async () => {
    mocks.runPowerShellCommand
      .mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
      .mockResolvedValueOnce(ok(APPLY_OK))
    register()
    const handler = getHandler('display:set-scale')

    const result = (await handler({}, '\\\\.\\DISPLAY1', 150)) as DisplaySetResult
    expect(result.ok).toBe(true)
    expect(result.change).toEqual({
      id: expect.any(Number),
      timeoutMs: DISPLAY_CONFIRM_TIMEOUT_MS,
      deadline: expect.any(Number)
    })
    const command = mocks.runPowerShellCommand.mock.calls[1][0] as string
    expect(command).toContain("$action = 'SetScale'")
    expect(command).toContain("$argDevice = '\\\\.\\DISPLAY1'")
    expect(command).toContain('$argRel = 2')
  })

  it('recusa escala sem suporte no monitor escolhido', async () => {
    register()
    const handler = getHandler('display:set-scale')

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    await expect(handler({}, '\\\\.\\DISPLAY2', 125)).resolves.toEqual({
      ok: false,
      error: 'Não foi possível ler a escala atual da tela.'
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    await expect(handler({}, '\\\\.\\DISPLAY1', 500)).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('não é suportada')
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
  })

  it('recusa monitor inexistente e falha de probe na escala', async () => {
    register()
    const handler = getHandler('display:set-scale')

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    await expect(handler({}, '\\\\.\\DISPLAY3', 125)).resolves.toEqual({
      ok: false,
      error: 'Monitor não encontrado.'
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(1)

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(''))
    await expect(handler({}, '\\\\.\\DISPLAY1', 125)).resolves.toEqual({
      ok: false,
      error: 'Não foi possível consultar os monitores.'
    })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
  })
})

describe('confirmação de mudança', () => {
  // Enfileira só o probe; aplicação e revert usam o default (sucesso).
  async function applyMode(): Promise<DisplaySetResult> {
    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    const handler = getHandler('display:set-resolution')
    return (await handler({}, '\\\\.\\DISPLAY1', 1280, 720, 60)) as DisplaySetResult
  }

  it('confirmar cancela o timer e não chama o PowerShell depois', async () => {
    register()
    const result = await applyMode()
    expect(result.change?.id).toBe(1)

    await expect(getHandler('display:confirm-change')({})).resolves.toEqual({
      ok: true,
      confirmed: true
    })
    vi.advanceTimersByTime(DISPLAY_CONFIRM_TIMEOUT_MS + 1_000)
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('timeout reverte o modo anterior e emite o evento', async () => {
    register()
    const result = await applyMode()
    expect(result.change?.id).toBe(1)

    await vi.advanceTimersByTimeAsync(DISPLAY_CONFIRM_TIMEOUT_MS)
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)
    const revertCommand = mocks.runPowerShellCommand.mock.calls[2][0] as string
    expect(revertCommand).toContain("$action = 'SetResolution'")
    expect(revertCommand).toContain("$argDevice = '\\\\.\\DISPLAY1'")
    expect(revertCommand).toContain('$argW = 1920')
    expect(revertCommand).toContain('$argH = 1080')
    expect(revertCommand).toContain('$argHz = 165')
    expect(mocks.send).toHaveBeenCalledWith('display:change-reverted', {
      changeId: 1,
      ok: true
    })
  })

  it('timeout reverte a escala anterior com o índice relativo bruto', async () => {
    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    register()
    const result = (await getHandler('display:set-scale')(
      {},
      '\\\\.\\DISPLAY1',
      150
    )) as DisplaySetResult
    expect(result.change?.id).toBe(1)

    await vi.advanceTimersByTimeAsync(DISPLAY_CONFIRM_TIMEOUT_MS)
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)
    const revertCommand = mocks.runPowerShellCommand.mock.calls[2][0] as string
    expect(revertCommand).toContain("$action = 'SetScale'")
    expect(revertCommand).toContain("$argDevice = '\\\\.\\DISPLAY1'")
    expect(revertCommand).toContain('$argRel = 0')
    expect(mocks.send).toHaveBeenCalledWith('display:change-reverted', {
      changeId: 1,
      ok: true
    })
  })

  it('revert manual executa na hora, limpa o timer e não emite evento', async () => {
    register()
    await applyMode()

    await expect(getHandler('display:revert-change')({})).resolves.toEqual({ ok: true })
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)

    vi.advanceTimersByTime(DISPLAY_CONFIRM_TIMEOUT_MS + 1_000)
    await flush()
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('revert-change sem pendente é idempotente', async () => {
    register()
    await expect(getHandler('display:revert-change')({})).resolves.toEqual({ ok: true })
    expect(mocks.runPowerShellCommand).not.toHaveBeenCalled()
  })

  it('falha no revert automático emite ok:false sem lançar', async () => {
    register()
    await applyMode()
    mocks.runPowerShellCommand.mockResolvedValueOnce(ok('{"ok":false,"rc":-1}'))

    await vi.advanceTimersByTimeAsync(DISPLAY_CONFIRM_TIMEOUT_MS)
    await flush()

    expect(mocks.send).toHaveBeenCalledWith('display:change-reverted', {
      changeId: 1,
      ok: false,
      error: expect.stringContaining('não permitiu')
    })
  })

  it('confirmar depois de decorrido parte do prazo não reverte depois', async () => {
    register()
    await applyMode()

    vi.advanceTimersByTime(2_000)
    await getHandler('display:confirm-change')({})
    vi.advanceTimersByTime(9_000)
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('uma nova alteração confirma a anterior e só reverte a última', async () => {
    register()

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    const first = (await getHandler('display:set-resolution')(
      {},
      '\\\\.\\DISPLAY1',
      1280,
      720,
      60
    )) as DisplaySetResult
    expect(first.change?.id).toBe(1)

    mocks.runPowerShellCommand.mockResolvedValueOnce(ok(PROBE_TWO_MONITORS))
    const second = (await getHandler('display:set-resolution')(
      {},
      '\\\\.\\DISPLAY2',
      1920,
      1080,
      60
    )) as DisplaySetResult
    expect(second.change?.id).toBe(2)

    await vi.advanceTimersByTimeAsync(DISPLAY_CONFIRM_TIMEOUT_MS)
    await flush()

    // probe1, apply1, probe2, apply2, revert2 — o primeiro timer foi confirmado.
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(5)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith('display:change-reverted', {
      changeId: 2,
      ok: true
    })
  })

  it('confirmar exatamente no timeout devolve confirmed:false e espera o revert', async () => {
    register()
    await applyMode()

    // Dispara o timer sem deixar o revert terminar: simula o clique nos 10 s.
    vi.advanceTimersByTime(DISPLAY_CONFIRM_TIMEOUT_MS)

    await expect(getHandler('display:confirm-change')({})).resolves.toEqual({
      ok: true,
      confirmed: false
    })
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)
    expect(mocks.send).toHaveBeenCalledWith('display:change-reverted', {
      changeId: 1,
      ok: true
    })
  })

  it('revert manual durante o revert automático reaproveita o resultado em voo', async () => {
    register()
    await applyMode()

    vi.advanceTimersByTime(DISPLAY_CONFIRM_TIMEOUT_MS)

    await expect(getHandler('display:revert-change')({})).resolves.toEqual({ ok: true })
    await flush()

    // Só o revert do timeout roda — o manual não dispara um segundo.
    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(3)
  })

  it('will-quit confirma a mudança pendente sem reverter', async () => {
    register()
    await applyMode()

    const quit = mocks.once.mock.calls.find(([event]) => event === 'will-quit')?.[1] as
      (() => void) | undefined
    expect(quit).toBeTypeOf('function')
    quit?.()

    vi.advanceTimersByTime(DISPLAY_CONFIRM_TIMEOUT_MS + 1_000)
    await flush()

    expect(mocks.runPowerShellCommand).toHaveBeenCalledTimes(2)
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
