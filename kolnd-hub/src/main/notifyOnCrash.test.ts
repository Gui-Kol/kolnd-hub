import { describe, expect, it } from 'vitest'
import {
  crashNotificationBody,
  resolveCrashNotificationLabel,
  shouldNotifyOnCrash
} from './notifyOnCrash'

describe('shouldNotifyOnCrash', () => {
  it('notifica só na transição para error, com pref ligada e sem desinstalação', () => {
    expect(shouldNotifyOnCrash('error', true, false)).toBe(true)
  })

  it('não notifica quando a pref está desligada (opt-out)', () => {
    expect(shouldNotifyOnCrash('error', false, false)).toBe(false)
  })

  it('não notifica durante desinstalação em andamento', () => {
    expect(shouldNotifyOnCrash('error', true, true)).toBe(false)
  })

  it('não notifica para status que não é error (parada voluntária = stopped)', () => {
    expect(shouldNotifyOnCrash('stopped', true, false)).toBe(false)
    expect(shouldNotifyOnCrash('running', true, false)).toBe(false)
    expect(shouldNotifyOnCrash('', true, false)).toBe(false)
  })

  it('cada guarda isolada é suficiente para suprimir a notificação', () => {
    // pref desligada + desinstalação: ainda não notifica
    expect(shouldNotifyOnCrash('error', false, true)).toBe(false)
    // status não-error + pref ligada + sem desinstalação: ainda não notifica
    expect(shouldNotifyOnCrash('stopped', true, false)).toBe(false)
  })
})

describe('crashNotificationBody', () => {
  it('monta a copy pt-BR com o nome amigável', () => {
    expect(crashNotificationBody('Absolem')).toBe(
      'Absolem parou inesperadamente — clique para reabrir.'
    )
  })
})

describe('resolveCrashNotificationLabel', () => {
  const apps = [
    { id: 'absolem', name: 'Absolem' },
    { id: 'sem-nome', name: '   ' }
  ]

  it('resolve o appId para o nome amigável', () => {
    expect(resolveCrashNotificationLabel(apps, 'absolem')).toBe('Absolem')
  })

  it('fallback para o appId quando o app não está na config', () => {
    expect(resolveCrashNotificationLabel(apps, 'desconhecido')).toBe('desconhecido')
  })

  it('fallback para o appId quando a config é null/undefined ou o nome está vazio', () => {
    expect(resolveCrashNotificationLabel(null, 'app-x')).toBe('app-x')
    expect(resolveCrashNotificationLabel(undefined, 'app-x')).toBe('app-x')
    expect(resolveCrashNotificationLabel(apps, 'sem-nome')).toBe('sem-nome')
  })
})
