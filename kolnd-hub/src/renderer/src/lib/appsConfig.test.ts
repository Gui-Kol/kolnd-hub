import { describe, it, expect } from 'vitest'
import {
  parseSavedApps,
  mergeAppConfigs,
  migrateLegacyDefaults,
  parseStartupImportance
} from './appsConfig'
import { apps as defaultApps } from '../config/apps'
import type { AppConfig } from '../types'

const app = (over: Partial<AppConfig>): AppConfig => ({
  id: 'x',
  name: 'X',
  description: 'd',
  icon: '📦',
  color: '#000',
  gradient: 'g',
  command: 'x.exe',
  cwd: 'C:\\x',
  category: 'dev',
  tags: [],
  ...over
})

describe('parseSavedApps', () => {
  it('retorna null para JSON corrompido', () => {
    expect(parseSavedApps('{not json')).toBeNull()
    expect(parseSavedApps('')).toBeNull()
    expect(parseSavedApps(null)).toBeNull()
  })

  it('retorna null para estruturas que não são lista', () => {
    expect(parseSavedApps('{"a":1}')).toBeNull()
  })

  it('descarta entradas sem id/command e preserva as válidas', () => {
    const json = JSON.stringify([
      app({ id: 'ok-1', command: 'a.exe' }),
      { id: 'broken' },
      null,
      app({ id: 'ok-2', command: 'b.exe' })
    ])
    const out = parseSavedApps(json)
    expect(out?.map((a) => a.id)).toEqual(['ok-1', 'ok-2'])
  })
})

describe('migrateLegacyDefaults', () => {
  it('não toca em config personalizada', () => {
    const custom = app({ id: 'absolem', command: 'meu-absolem.exe', cwd: 'C:\\opt' })
    expect(migrateLegacyDefaults(custom)).toEqual(custom)
  })

  it('atualiza default legado do Kloud Games (pré-MSI)', () => {
    const legacy = app({
      id: 'kloud-games',
      command: 'KLOUD_GAMES.exe',
      cwd: 'resources/programs/kloud-games'
    })
    const migrated = migrateLegacyDefaults(legacy)
    const def = defaultApps.find((d) => d.id === 'kloud-games')!
    expect(migrated.command).toBe(def.command)
    expect(migrated.cwd).toBe(def.cwd)
  })
})

describe('mergeAppConfigs', () => {
  it('sem entradas salvas retorna os defaults', () => {
    expect(mergeAppConfigs([])).toEqual(defaultApps)
  })

  it('entradas salvas sobrepõem os defaults do mesmo id', () => {
    const merged = mergeAppConfigs([app({ id: 'absolem', command: 'custom.exe' })])
    const absolem = merged.find((a) => a.id === 'absolem')!
    expect(absolem.command).toBe('custom.exe')
  })

  it('campos ausentes na entrada salva caem nos defaults', () => {
    // Entrada parcial (runtime real pode vir incompleta do localStorage)
    const partial = { id: 'absolem', command: 'custom.exe' } as AppConfig
    const merged = mergeAppConfigs([partial])
    const absolem = merged.find((a) => a.id === 'absolem')!
    expect(absolem.command).toBe('custom.exe')
    expect(absolem.name).toBe('Absolem')
    expect(absolem.category).toBe('ai')
  })

  it('descarta entrada salva do Mark LVII (app removido)', () => {
    const merged = mergeAppConfigs([
      app({ id: 'mark-lvi', name: 'Mark LVII (JARVIS)', command: 'MarkLVII.exe' }),
      app({ id: 'kloud-games' })
    ])
    expect(merged.some((a) => a.id === 'mark-lvi')).toBe(false)
  })

  it('preserva apps salvos que não existem mais nos defaults', () => {
    const merged = mergeAppConfigs([app({ id: 'meu-app-pessoal', command: 'pickaxe.exe' })])
    expect(merged.some((a) => a.id === 'meu-app-pessoal')).toBe(true)
    // e os defaults continuam presentes
    expect(merged.length).toBe(defaultApps.length + 1)
  })

  it('não duplica ids', () => {
    const merged = mergeAppConfigs([app({ id: 'absolem' }), app({ id: 'kloud-games' })])
    const ids = merged.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('preserva autoRestart no round-trip parse→merge→save (06-6.4)', () => {
    const parsed = parseSavedApps(
      JSON.stringify([app({ id: 'absolem', autoRestart: true }), app({ id: 'kloud-games' })])
    )
    expect(parsed).not.toBeNull()
    const merged = mergeAppConfigs(parsed!)
    expect(merged.find((a) => a.id === 'absolem')?.autoRestart).toBe(true)
    expect(merged.find((a) => a.id === 'kloud-games')?.autoRestart).toBeUndefined()
  })

  it('preserva persistLogs no round-trip parse→merge→save (05-5.7)', () => {
    const parsed = parseSavedApps(
      JSON.stringify([app({ id: 'absolem', persistLogs: true }), app({ id: 'kloud-games' })])
    )
    expect(parsed).not.toBeNull()
    const merged = mergeAppConfigs(parsed!)
    expect(merged.find((a) => a.id === 'absolem')?.persistLogs).toBe(true)
    expect(merged.find((a) => a.id === 'kloud-games')?.persistLogs).toBeUndefined()
  })

  it('config antiga (só Kloud Games) ganha o Absolem no merge', () => {
    const merged = mergeAppConfigs([app({ id: 'kloud-games' })])
    const absolem = merged.find((a) => a.id === 'absolem')
    expect(absolem).toBeDefined()
    expect(absolem?.name).toBe('Absolem')
    expect(absolem?.category).toBe('ai')
    expect(absolem?.command).toBe('Absolem.exe')
    expect(absolem?.cwd).toBe('resources/programs/Absolem')
  })

  it('default do Absolem é ferramenta de IA apontando para o build embutido', () => {
    const absolem = defaultApps.find((a) => a.id === 'absolem')
    expect(absolem?.category).toBe('ai')
    expect(absolem?.command).toBe('Absolem.exe')
  })
})

describe('parseStartupImportance', () => {
  it('retorna null para JSON corrompido ou não-objeto', () => {
    expect(parseStartupImportance('{broken')).toBeNull()
    expect(parseStartupImportance('[1,2]')).toBeNull()
    expect(parseStartupImportance(null)).toBeNull()
  })

  it('filtra níveis inválidos e mantém os válidos', () => {
    const out = parseStartupImportance(
      JSON.stringify({ a: 'critico', b: 'manter', c: 'inutil', d: 42 })
    )
    expect(out).toEqual({ a: 'critico', c: 'inutil' })
  })

  it('objeto vazio parseia para mapa vazio', () => {
    expect(parseStartupImportance('{}')).toEqual({})
  })
})
