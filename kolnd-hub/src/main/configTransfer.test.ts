import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testes do fluxo exportar/importar (07-7.6).
 *
 * electron-store e electron são simulados no mesmo padrão de store.test.ts:
 * o `store` do módulo é criado em nível de import, então o mock é montado
 * dentro das factories de vi.mock (via globalThis).
 */
vi.mock('electron-store', () => ({
  default: class {
    constructor(options?: unknown) {
      const g = globalThis as any
      g.__kolndStoreOptions = options
      if (!g.__kolndStore) {
        g.__kolndStore = {
          get: vi.fn((_key: string, def: unknown) => def),
          set: vi.fn(),
          delete: vi.fn()
        }
      }
      return g.__kolndStore
    }
  }
}))
vi.mock('electron', () => ({
  app: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() }
}))

let buildExport: typeof import('./configTransfer').buildExport
let validateImport: typeof import('./configTransfer').validateImport
let applyImport: typeof import('./configTransfer').applyImport
let summarizeImport: typeof import('./configTransfer').summarizeImport
let isStoreAvailable: typeof import('./store').isStoreAvailable

beforeAll(async () => {
  const mod = await import('./configTransfer')
  buildExport = mod.buildExport
  validateImport = mod.validateImport
  applyImport = mod.applyImport
  summarizeImport = mod.summarizeImport
  const storeMod = await import('./store')
  isStoreAvailable = storeMod.isStoreAvailable
})

const holder = (): {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
} => (globalThis as any).__kolndStore

beforeEach(() => {
  const h = holder()
  h.get.mockImplementation((_key: string, def: unknown) => def)
  h.set.mockClear()
  h.set.mockImplementation(() => undefined)
  h.delete.mockClear()
})

const validApp = {
  id: 'app-1',
  name: 'App Um',
  description: 'desc',
  icon: '📦',
  color: '#8B5CF6',
  gradient: 'from-violet-500 to-fuchsia-500',
  command: 'app.exe',
  cwd: 'C:\\app',
  category: 'dev' as const,
  tags: ['t1']
}

const validGame = {
  id: 'game-1',
  name: 'Jogo Um',
  exePath: 'C:\\games\\jogo.exe',
  iconPath: null,
  origin: 'custom' as const,
  addedAt: '2026-01-01T00:00:00.000Z'
}

const validGamepad = {
  profile: 'xbox' as const,
  controllerId: 'ctrl-1',
  controllerName: 'Controle X',
  autoMapped: true,
  configuredAt: '2026-01-01T00:00:00.000Z',
  mapping: {
    confirm: 0,
    back: 1,
    up: 12,
    down: 13,
    left: 14,
    right: 15,
    menu: 2,
    options: 3,
    tab_prev: 4,
    tab_next: 5,
    stick_left: null,
    stick_right: null
  }
}

function seedStore(seed: Record<string, unknown>): void {
  holder().get.mockImplementation((key: string, def: unknown) => (key in seed ? seed[key] : def))
}

// ── buildExport ──────────────────────────────────────────────────

describe('buildExport', () => {
  it('monta o envelope com app/version/exportedAt e as 6 seções', () => {
    seedStore({
      apps: [validApp],
      startupImportance: { 'app-1': 'critico' },
      games: [validGame],
      launchKloudOnStart: true,
      bigPicture: { sounds: false },
      gamepad: validGamepad
    })
    const out = buildExport()
    expect(out.app).toBe('kolnd-hub')
    expect(out.version).toBe(1)
    expect(typeof out.exportedAt).toBe('string')
    expect(Number.isNaN(Date.parse(out.exportedAt))).toBe(false)
    expect(out.data.apps).toHaveLength(1)
    expect(out.data.apps[0].id).toBe('app-1')
    expect(out.data.startupImportance).toEqual({ 'app-1': 'critico' })
    expect(out.data.games).toHaveLength(1)
    expect(out.data.launchKloudOnStart).toBe(true)
    expect(out.data.bigPicture).toEqual({ sounds: false })
    expect(out.data.gamepad?.controllerId).toBe('ctrl-1')
  })

  it('store vazio → listas/objetos vazios, sem quebrar', () => {
    const out = buildExport()
    expect(out.data.apps).toEqual([])
    expect(out.data.startupImportance).toEqual({})
    expect(out.data.games).toEqual([])
    expect(out.data.launchKloudOnStart).toBe(false)
    expect(out.data.bigPicture).toEqual({ sounds: true })
    expect(out.data.gamepad).toBeNull()
  })
})

// ── validateImport ───────────────────────────────────────────────

describe('validateImport', () => {
  it('round-trip buildExport → validateImport é aceito', () => {
    seedStore({
      apps: [validApp],
      startupImportance: { 'app-1': 'recomendado' },
      games: [validGame],
      launchKloudOnStart: true,
      bigPicture: { sounds: false },
      gamepad: validGamepad
    })
    const exported = JSON.parse(JSON.stringify(buildExport())) as unknown
    const result = validateImport(exported)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rejected).toEqual([])
    expect(result.data.apps?.[0].id).toBe('app-1')
    expect(result.data.games?.[0].id).toBe('game-1')
    expect(result.data.startupImportance).toEqual({ 'app-1': 'recomendado' })
    expect(result.data.launchKloudOnStart).toBe(true)
    expect(result.data.bigPicture).toEqual({ sounds: false })
    expect(result.data.gamepad?.controllerName).toBe('Controle X')
    // Contagem do resumo reflete o arquivo (usado na confirmação do import).
    expect(summarizeImport(result.data)).toEqual({
      apps: 1,
      games: 1,
      sections: [
        'apps',
        'startupImportance',
        'games',
        'launchKloudOnStart',
        'bigPicture',
        'gamepad'
      ]
    })
  })

  it('JSON quebrado (não-objeto) → ok: false', () => {
    expect(validateImport('{ inválido').ok).toBe(false)
    expect(validateImport(null).ok).toBe(false)
    expect(validateImport(42).ok).toBe(false)
    expect(validateImport([1, 2]).ok).toBe(false)
  })

  it('app ou version errados → rejeitado', () => {
    const wrongApp = validateImport({ app: 'outro-app', version: 1, data: {} })
    expect(wrongApp.ok).toBe(false)
    const wrongVersion = validateImport({ app: 'kolnd-hub', version: 2, data: {} })
    expect(wrongVersion.ok).toBe(false)
    const stringVersion = validateImport({ app: 'kolnd-hub', version: '1', data: {} })
    expect(stringVersion.ok).toBe(false)
  })

  it('seções ausentes são toleradas (arquivo mínimo é válido)', () => {
    const result = validateImport({ app: 'kolnd-hub', version: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toEqual({})
    expect(result.rejected).toEqual([])
  })

  it('campos/seções desconhecidos são tolerados (forward-compat)', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      futureField: { nested: true },
      data: { apps: [validApp], futureSection: [1, 2, 3] }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.apps).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('"data" com tipo errado → ok: false', () => {
    const result = validateImport({ app: 'kolnd-hub', version: 1, data: 'texto' })
    expect(result.ok).toBe(false)
  })

  it('gamepad inválido → seção recusada sem derrubar as outras', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      data: {
        apps: [validApp],
        games: [validGame],
        gamepad: { invalido: true }
      }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.apps).toHaveLength(1)
    expect(result.data.games).toHaveLength(1)
    expect(result.data.gamepad).toBeUndefined()
    expect(result.rejected).toEqual([
      { section: 'gamepad', error: 'Configuração de controle inválida.' }
    ])
  })

  it('gamepad null explícito é válido (restaura "sem controle")', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      data: { gamepad: null }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.gamepad).toBeNull()
  })

  it('apps com tipo errado → seção recusada, games seguem válidas', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      data: { apps: 'não-é-lista', games: [validGame] }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.apps).toBeUndefined()
    expect(result.data.games).toHaveLength(1)
    expect(result.rejected.map((r) => r.section)).toEqual(['apps'])
  })

  it('launchKloudOnStart não-booleano → seção recusada', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      data: { launchKloudOnStart: 'sim' }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.launchKloudOnStart).toBeUndefined()
    expect(result.rejected.map((r) => r.section)).toEqual(['launchKloudOnStart'])
  })

  it('bigPicture.sounds não-booleano → seção recusada', () => {
    const result = validateImport({
      app: 'kolnd-hub',
      version: 1,
      data: { bigPicture: { sounds: 'alto' } }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.bigPicture).toBeUndefined()
    expect(result.rejected.map((r) => r.section)).toEqual(['bigPicture'])
  })
})

// ── applyImport ──────────────────────────────────────────────────

describe('applyImport', () => {
  it('aplica todas as seções presentes e reporta applied', () => {
    const report = applyImport({
      apps: [validApp],
      startupImportance: { 'app-1': 'critico' },
      games: [validGame],
      launchKloudOnStart: true,
      bigPicture: { sounds: false },
      gamepad: validGamepad
    })
    expect(report.failed).toEqual([])
    expect(report.applied).toEqual([
      'apps',
      'startupImportance',
      'games',
      'launchKloudOnStart',
      'bigPicture',
      'gamepad'
    ])
    // O que foi gravado passou pelos normalizadores do store.
    expect(holder().set).toHaveBeenCalledWith('apps', [expect.objectContaining({ id: 'app-1' })])
    expect(holder().set).toHaveBeenCalledWith('games', [expect.objectContaining({ id: 'game-1' })])
  })

  it('uma seção que falha não derruba as outras (relatório parcial)', () => {
    holder().set.mockImplementation((key: string) => {
      if (key === 'games') throw new Error('disco indisponível')
    })
    const report = applyImport({ apps: [validApp], games: [validGame] })
    expect(report.applied).toEqual(['apps'])
    expect(report.failed).toEqual([{ section: 'games', error: 'disco indisponível' }])
  })

  it('gamepad null aplica como reset da chave gamepad', () => {
    const report = applyImport({ gamepad: null })
    expect(report.failed).toEqual([])
    expect(report.applied).toEqual(['gamepad'])
    expect(holder().delete).toHaveBeenCalledWith('gamepad')
  })

  it('seções ausentes não são aplicadas nem reportadas', () => {
    const report = applyImport({ apps: [validApp] })
    expect(report.applied).toEqual(['apps'])
    expect(report.failed).toEqual([])
    expect(holder().set).not.toHaveBeenCalledWith('games', expect.anything())
  })
})

// ── isStoreAvailable (novo export mecânico do store) ─────────────

describe('isStoreAvailable', () => {
  it('retorna true quando o store mockado abriu', () => {
    expect(isStoreAvailable()).toBe(true)
  })
})
