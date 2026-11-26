import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageEvent } from '../shared/usage'

const mocks = vi.hoisted(() => ({
  logWarn: vi.fn(),
  logError: vi.fn()
}))

// O módulo resolve o diretório via `app.getPath` só quando não há override de
// teste — o mock garante que os testes nunca toquem no Electron real.
vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('sem Electron nos testes')
    }
  }
}))
vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: mocks.logWarn, error: mocks.logError, debug: vi.fn() }
}))

import {
  appendUsageEvent,
  buildUsageEvent,
  clearUsageFiles,
  isUsageFileName,
  normalizeUsageEvent,
  readUsageEvents,
  setUsageDepsForTests,
  setUsageDirForTests,
  setUsageEnabledProvider,
  setUsageRetentionProvider,
  summarizeUsage,
  usageDateKey,
  usageToCsv
} from './usageLog'
import { USAGE_MAX_FILE_BYTES } from '../shared/usage'

let dir: string
let nowMs: number

function setNow(date: Date): void {
  nowMs = date.getTime()
}

function writeRaw(dayKey: string, lines: string[]): void {
  writeFileSync(join(dir, `usage-${dayKey}.jsonl`), `${lines.join('\n')}\n`, 'utf8')
}

function eventFor(type: UsageEvent['type'], ts: Date, extra: Partial<UsageEvent> = {}): UsageEvent {
  return { ts: ts.toISOString(), type, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  dir = mkdtempSync(join(tmpdir(), 'kolnd-usage-'))
  nowMs = new Date(2026, 10, 25, 10, 0, 0).getTime()
  setUsageDirForTests(dir)
  setUsageDepsForTests({
    now: () => new Date(nowMs),
    logger: { warn: mocks.logWarn, error: mocks.logError }
  })
  setUsageEnabledProvider(null)
})

afterEach(() => {
  setUsageDirForTests(null)
  setUsageDepsForTests(null)
  setUsageEnabledProvider(null)
  setUsageRetentionProvider(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('isUsageFileName / usageDateKey', () => {
  it('aceita só usage-AAAA-MM-DD.jsonl', () => {
    expect(isUsageFileName('usage-2026-11-25.jsonl')).toBe(true)
    expect(isUsageFileName('kolnd-hub.log')).toBe(false)
    expect(isUsageFileName('usage-2026-11-25.log')).toBe(false)
    expect(isUsageFileName('usage-25-11-2026.jsonl')).toBe(false)
    expect(isUsageFileName('usage-2026-11-25.jsonl.1')).toBe(false)
    expect(isUsageFileName(42)).toBe(false)
  })

  it('usa a data LOCAL (não UTC) para a chave do dia', () => {
    expect(usageDateKey(new Date(2026, 0, 5, 23, 30, 0))).toBe('2026-01-05')
    expect(usageDateKey(new Date(2026, 10, 1, 0, 0, 1))).toBe('2026-11-01')
  })
})

describe('buildUsageEvent / normalizeUsageEvent', () => {
  it('monta o evento com o relógio injetado e sanitiza nome/duração', () => {
    const event = buildUsageEvent('session-end', {
      sessionId: 'abc-123',
      durationSeconds: 12.9,
      name: 'App\ncom\tquebra   '
    })
    expect(event.ts).toBe(new Date(nowMs).toISOString())
    expect(event).toMatchObject({
      type: 'session-end',
      sessionId: 'abc-123',
      durationSeconds: 12,
      name: 'App com quebra'
    })
  })

  it('ignora página/ação fora da whitelist e campos inválidos', () => {
    const event = buildUsageEvent('action', {
      page: 'inexistente' as never,
      action: 'outra' as never,
      durationSeconds: Number.NaN
    })
    expect(event.page).toBeUndefined()
    expect(event.action).toBeUndefined()
    expect(event.durationSeconds).toBeUndefined()
  })

  it('normalizeUsageEvent recusa linha sem ts/type válidos', () => {
    expect(normalizeUsageEvent(null)).toBeNull()
    expect(normalizeUsageEvent({ ts: '2026-11-25T10:00:00.000Z', type: 'outro' })).toBeNull()
    expect(normalizeUsageEvent({ ts: 'ontem', type: 'page-view' })).toBeNull()
    expect(
      normalizeUsageEvent({ ts: '2026-11-25T10:00:00.000Z', type: 'page-view', page: 'x' })
    ).toEqual({ ts: '2026-11-25T10:00:00.000Z', type: 'page-view' })
  })
})

describe('appendUsageEvent', () => {
  it('grava uma linha JSON no arquivo do dia local', () => {
    const event = buildUsageEvent('page-view', { page: 'dashboard' })
    expect(appendUsageEvent(event)).toBe(true)

    const raw = readUsageEvents()
    expect(raw).toHaveLength(1)
    expect(raw[0]).toEqual(event)
  })

  it('não grava quando a preferência está desligada', () => {
    setUsageEnabledProvider(() => false)
    expect(appendUsageEvent(buildUsageEvent('page-view', { page: 'settings' }))).toBe(false)
    setUsageEnabledProvider(() => true)
    expect(readUsageEvents()).toEqual([])
  })

  it('evento inválido não cria arquivo', () => {
    const invalid = { ts: 'x', type: 'page-view' } as unknown as UsageEvent
    expect(appendUsageEvent(invalid)).toBe(false)
    expect(readUsageEvents()).toEqual([])
  })

  it('falha de disco é engolida e vira log de erro', () => {
    // Um arquivo comum no lugar do diretório: mkdirSync falha (ENOTDIR).
    const blocker = join(dir, 'bloqueio')
    writeFileSync(blocker, 'x', 'utf8')
    setUsageDirForTests(join(blocker, 'logs'))

    expect(appendUsageEvent(buildUsageEvent('page-view', { page: 'dashboard' }))).toBe(false)
    expect(mocks.logError).toHaveBeenCalled()
  })

  it('poda pela retenção sem tocar em kolnd-hub.log', () => {
    writeFileSync(join(dir, 'kolnd-hub.log'), 'log do app', 'utf8')
    writeFileSync(join(dir, 'kolnd-hub.1.log'), 'log rotacionado', 'utf8')
    writeFileSync(join(dir, 'usage-2026-11-24.jsonl'), '', 'utf8')
    writeFileSync(join(dir, 'usage-2026-11-20.jsonl'), '', 'utf8')
    writeFileSync(join(dir, 'usage-2026-08-01.jsonl'), '', 'utf8')

    // Retenção 30: mantém de 27/10 em diante; 01/08 sai.
    expect(appendUsageEvent(buildUsageEvent('page-view'), { retentionDays: 30 })).toBe(true)

    expect(() => statSync(join(dir, 'usage-2026-08-01.jsonl'))).toThrow()
    expect(() => statSync(join(dir, 'usage-2026-11-24.jsonl'))).not.toThrow()
    expect(() => statSync(join(dir, 'usage-2026-11-20.jsonl'))).not.toThrow()
    expect(() => statSync(join(dir, 'kolnd-hub.log'))).not.toThrow()
    expect(() => statSync(join(dir, 'kolnd-hub.1.log'))).not.toThrow()
  })

  it('retenção 7 apaga arquivos com mais de uma semana', () => {
    writeFileSync(join(dir, 'usage-2026-11-10.jsonl'), '', 'utf8')
    writeFileSync(join(dir, 'usage-2026-11-19.jsonl'), '', 'utf8')

    appendUsageEvent(buildUsageEvent('page-view'), { retentionDays: 7 })

    expect(() => statSync(join(dir, 'usage-2026-11-10.jsonl'))).toThrow()
    expect(() => statSync(join(dir, 'usage-2026-11-19.jsonl'))).not.toThrow()
  })

  it('usa a retenção injetada pela preferência quando não há opção explícita', () => {
    writeFileSync(join(dir, 'usage-2026-11-10.jsonl'), '', 'utf8')
    writeFileSync(join(dir, 'usage-2026-11-19.jsonl'), '', 'utf8')
    setUsageRetentionProvider(() => 7)

    appendUsageEvent(buildUsageEvent('page-view'))

    expect(() => statSync(join(dir, 'usage-2026-11-10.jsonl'))).toThrow()
    expect(() => statSync(join(dir, 'usage-2026-11-19.jsonl'))).not.toThrow()
  })

  it('guarda de 2 MB para de anexar e avisa uma única vez', () => {
    const file = join(dir, 'usage-2026-11-25.jsonl')
    writeFileSync(file, Buffer.alloc(USAGE_MAX_FILE_BYTES + 1, 97))

    expect(appendUsageEvent(buildUsageEvent('page-view'))).toBe(false)
    expect(appendUsageEvent(buildUsageEvent('page-view'))).toBe(false)
    expect(statSync(file).size).toBe(USAGE_MAX_FILE_BYTES + 1)
    expect(mocks.logWarn).toHaveBeenCalledTimes(1)

    // No dia seguinte o registro volta a funcionar normalmente.
    setNow(new Date(2026, 10, 26, 9, 0, 0))
    expect(appendUsageEvent(buildUsageEvent('page-view'))).toBe(true)
  })
})

describe('readUsageEvents', () => {
  it('ignora linhas corrompidas e eventos com forma inválida', () => {
    writeRaw('2026-11-25', [
      JSON.stringify({ ts: '2026-11-25T10:00:00.000Z', type: 'page-view', page: 'dashboard' }),
      '{ linha quebrada',
      '',
      JSON.stringify({ ts: '2026-11-25T10:05:00.000Z', type: 'tipo-invalido' })
    ])

    const events = readUsageEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'page-view', page: 'dashboard' })
  })

  it('filtra por tipo, página, período e limite (mais recente primeiro)', () => {
    writeRaw('2026-11-24', [
      JSON.stringify({ ts: '2026-11-24T09:00:00.000Z', type: 'page-view', page: 'settings' })
    ])
    writeRaw('2026-11-25', [
      JSON.stringify({ ts: '2026-11-25T09:00:00.000Z', type: 'page-view', page: 'dashboard' }),
      JSON.stringify({ ts: '2026-11-25T10:00:00.000Z', type: 'game-launch', gameId: 'g1' }),
      JSON.stringify({ ts: '2026-11-25T11:00:00.000Z', type: 'page-view', page: 'biblioteca' })
    ])

    const all = readUsageEvents()
    expect(all.map((event) => event.ts)).toEqual([
      '2026-11-25T11:00:00.000Z',
      '2026-11-25T10:00:00.000Z',
      '2026-11-25T09:00:00.000Z',
      '2026-11-24T09:00:00.000Z'
    ])

    expect(readUsageEvents({ type: 'page-view' })).toHaveLength(3)
    expect(readUsageEvents({ page: 'settings' })).toHaveLength(1)
    expect(readUsageEvents({ from: '2026-11-25' })).toHaveLength(3)
    expect(readUsageEvents({ to: '2026-11-24' })).toHaveLength(1)
    expect(readUsageEvents({ limit: 2 })).toHaveLength(2)
  })

  it('diretório inexistente devolve lista vazia', () => {
    setUsageDirForTests(join(dir, 'nao-existe'))
    expect(readUsageEvents()).toEqual([])
  })
})

describe('summarizeUsage', () => {
  it('agrega sessões, duração, top apps/jogos e visualizações de página', () => {
    const at = (hour: number): Date => new Date(2026, 10, 25, hour, 0, 0)
    const events: UsageEvent[] = [
      eventFor('session-start', at(8)),
      eventFor('session-end', at(9), { durationSeconds: 3600 }),
      eventFor('app-launch', at(8), { appId: 'a1', name: 'App Um' }),
      eventFor('app-launch', at(9), { appId: 'a1', name: 'App Um' }),
      eventFor('app-launch', at(9), { appId: 'a2', name: 'App Dois' }),
      eventFor('game-launch', at(10), { gameId: 'g1', name: 'Jogo Um' }),
      eventFor('page-view', at(8), { page: 'dashboard' }),
      eventFor('page-view', at(9), { page: 'dashboard' }),
      eventFor('page-view', at(10), { page: 'settings' })
    ]

    const summary = summarizeUsage(events)
    expect(summary.totalSessions).toBe(1)
    expect(summary.totalSeconds).toBe(3600)
    expect(summary.topApps).toEqual([
      { id: 'a1', name: 'App Um', launches: 2 },
      { id: 'a2', name: 'App Dois', launches: 1 }
    ])
    expect(summary.topGames).toEqual([{ id: 'g1', name: 'Jogo Um', launches: 1 }])
    expect(summary.pageViews).toEqual({
      dashboard: 2,
      settings: 1,
      inicializacao: 0,
      biblioteca: 0,
      chat: 0
    })
    expect(summary.byDay).toEqual([{ date: '2026-11-25', events: 9, seconds: 3600 }])
  })
})

describe('usageToCsv', () => {
  it('escapa vírgula, aspas e quebras de linha', () => {
    const csv = usageToCsv([
      eventFor('app-launch', new Date('2026-11-25T10:00:00.000Z'), {
        appId: 'a,1',
        name: 'App "Um"'
      }),
      eventFor('page-view', new Date('2026-11-25T11:00:00.000Z'), {
        page: 'dashboard'
      })
    ])

    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(
      'data_hora,tipo,sessao,pagina,app_id,nome,jogo_id,versao,acao,duracao_segundos'
    )
    expect(lines[1]).toContain('"a,1"')
    expect(lines[1]).toContain('"App ""Um"""')
    expect(lines[2]).toContain(',page-view,,dashboard,')
  })

  it('mantém intactos valores simples', () => {
    const csv = usageToCsv([
      eventFor('action', new Date('2026-11-25T10:00:00.000Z'), { action: 'config-export' })
    ])
    expect(csv).toContain('2026-11-25T10:00:00.000Z,action,,,,,,,config-export,')
  })
})

describe('clearUsageFiles', () => {
  it('apaga só arquivos usage-*.jsonl', () => {
    writeRaw('2026-11-24', ['{}'])
    writeRaw('2026-11-25', ['{}'])
    writeFileSync(join(dir, 'kolnd-hub.log'), 'log', 'utf8')
    writeFileSync(join(dir, 'outro.txt'), 'x', 'utf8')

    expect(clearUsageFiles()).toEqual({ success: true, removed: 2 })
    expect(readUsageEvents()).toEqual([])
    expect(() => statSync(join(dir, 'kolnd-hub.log'))).not.toThrow()
    expect(() => statSync(join(dir, 'outro.txt'))).not.toThrow()
  })
})
