import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERMISSION_CATEGORIES,
  PERMISSION_CATEGORIES,
  defaultPermissionCategories,
  effectivePermission,
  effectiveScreenPermission,
  isActionAllowed,
  normalizePermissionsState,
  setPermissionCategory,
  type PermissionsState
} from './permissions'

/**
 * Modelo de permissões da task 08 (T1). Nada aqui toca no disco: o store é
 * exercitado no teste de migração e no teste dos handlers IPC.
 */

function state(overrides: Partial<PermissionsState> = {}): PermissionsState {
  return normalizePermissionsState(overrides)
}

describe('permissões por categoria', () => {
  it('default por categoria', () => {
    const permissions = state()

    expect(permissions.microphone).toBe(true)
    expect(permissions.paused).toBe(false)
    expect(permissions.categories).toEqual(DEFAULT_PERMISSION_CATEGORIES)
    expect(permissions.categories['apps.launch']).toBe('allow')
    expect(permissions.categories['apps.close']).toBe('allow')
    expect(permissions.categories['files.read']).toBe('allow')
    expect(permissions.categories['files.write']).toBe('allow')
    expect(permissions.categories['system.power']).toBe('allow')
    expect(permissions.categories['uia.control']).toBe('allow')
    expect(permissions.categories['web.search']).toBe('allow')
  })

  it('valor inválido cai no default', () => {
    const categories = normalizePermissionsState({
      categories: {
        'apps.launch': 'talvez',
        'apps.close': 42,
        'files.read': 'deny',
        'system.power': 'allow',
        'uia.control': null,
        'web.search': 'perguntar'
      }
    }).categories

    for (const category of PERMISSION_CATEGORIES) {
      const decision = categories[category]
      expect(['allow', 'ask', 'deny']).toContain(decision)
    }
    expect(categories['files.read']).toBe('deny')
    expect(categories['system.power']).toBe('allow')
    expect(categories['apps.launch']).toBe('allow')
    expect(categories['web.search']).toBe('allow')
    expect(categories).toEqual({
      ...defaultPermissionCategories(),
      'files.read': 'deny',
      'system.power': 'allow'
    })
  })

  it('deny nunca executa e a pausa global vence allow', () => {
    const denied = state({
      categories: { ...defaultPermissionCategories(), 'files.write': 'deny' }
    })
    expect(isActionAllowed(denied, 'files.write')).toBe(false)
    expect(effectivePermission(denied, 'files.write')).toBe('deny')

    const paused = state({
      paused: true,
      categories: { ...defaultPermissionCategories(), 'web.search': 'allow' }
    })
    expect(isActionAllowed(paused, 'web.search')).toBe(false)
    expect(effectivePermission(paused, 'web.search')).toBe('deny')
    expect(effectivePermission(paused, 'screen')).toBe('deny')
    expect(effectivePermission(state(), 'screen')).toBe('ask')
    expect(effectivePermission(state(), 'internal')).toBe('allow')
    expect(effectivePermission(paused, 'internal')).toBe('deny')
  })

  it('visão autônoma usa allow, mas ask/off e pausa continuam barreiras', () => {
    const current = state()
    expect(effectiveScreenPermission(current, 'on')).toBe('allow')
    expect(effectiveScreenPermission(current, 'ask')).toBe('ask')
    expect(effectiveScreenPermission(current, 'off')).toBe('deny')
    expect(effectiveScreenPermission({ ...current, paused: true }, 'on')).toBe('deny')
  })

  it('mudança é persistida no estado normalizado', () => {
    const before = state()
    const changed = setPermissionCategory(before, 'files.read', 'deny')
    expect(before.categories['files.read']).toBe('allow')
    expect(changed.categories['files.read']).toBe('deny')
    expect(changed.categories['files.write']).toBe('allow')

    // O normalizador usado pelo store preserva a decisão gravada.
    const persisted = normalizePermissionsState(changed)
    expect(persisted).toEqual(changed)
    expect(persisted.microphone).toBe(true)
  })
})
