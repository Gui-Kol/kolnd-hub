import { describe, expect, it } from 'vitest'
import {
  buildSkipKloudHubArgs,
  getKloudPartialKind,
  getKloudPartialStatusText,
  getParentDir,
  type KloudDetectionLike
} from './uninstall'

const base: KloudDetectionLike = {
  status: 'missing',
  exePath: null,
  service: 'missing',
  entry: null
}

describe('getKloudPartialKind', () => {
  it('installed → null', () => {
    expect(
      getKloudPartialKind({
        ...base,
        status: 'installed',
        exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe',
        entry: { productCode: '{GUID}' }
      })
    ).toBeNull()
  })

  it('missing → null', () => {
    expect(getKloudPartialKind(base)).toBeNull()
  })

  it('null/undefined → null', () => {
    expect(getKloudPartialKind(null)).toBeNull()
    expect(getKloudPartialKind(undefined)).toBeNull()
  })

  it.each([
    ['exe sem registro e sem serviço', { exePath: 'C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe' }, 'exe-orphan'],
    ['exe sem registro com serviço parado', { exePath: 'C:\\KLOUD_GAMES\\KLOUD_GAMES.exe', service: 'stopped' as const }, 'exe-orphan'],
    ['registro sem exe', { entry: { productCode: '{GUID}' } }, 'registry-orphan'],
    ['registro sem exe e com serviço', { entry: { productCode: '{GUID}' }, service: 'running' as const }, 'registry-orphan'],
    ['só o serviço (rodando)', { service: 'running' as const }, 'service-orphan'],
    ['só o serviço (parado)', { service: 'stopped' as const }, 'service-orphan']
  ] as Array<[string, Partial<KloudDetectionLike>, string]>)(
    'partial: %s → %s',
    (_name, overrides, expected) => {
      expect(getKloudPartialKind({ ...base, status: 'partial', ...overrides })).toBe(expected)
    }
  )

  it('partial sem nada reconhecido → null (estado inconsistente não quebra a UI)', () => {
    expect(getKloudPartialKind({ ...base, status: 'partial' })).toBeNull()
  })
})

describe('getKloudPartialStatusText', () => {
  it('cada órfão tem texto honesto e amigável', () => {
    expect(getKloudPartialStatusText('exe-orphan')).toContain('arquivos sem registro')
    expect(getKloudPartialStatusText('registry-orphan')).toContain('registro sem o programa')
    expect(getKloudPartialStatusText('service-orphan')).toContain('KLOUD_GAMESsvc')
    expect(getKloudPartialStatusText(null)).toContain('parcial')
  })
})

describe('getParentDir', () => {
  it.each([
    ['C:\\Program Files\\KLOUD_GAMES\\KLOUD_GAMES.exe', 'C:\\Program Files\\KLOUD_GAMES'],
    ['C:\\Program Files\\KLOUD_GAMES', 'C:\\Program Files'],
    ['C:\\Program Files\\KLOUD_GAMES\\', 'C:\\Program Files'],
    ['C:\\KLOUD_GAMES.exe', 'C:\\'],
    ['D:\\apps\\kg\\KLOUD_GAMES.exe', 'D:\\apps\\kg'],
    ['', '']
  ] as Array<[string, string]>)('%s → %s', (input, expected) => {
    expect(getParentDir(input)).toBe(expected)
  })
})

describe('buildSkipKloudHubArgs — retry "só o Hub" preserva a escolha do usuário', () => {
  it('skipKloud=true sempre; wipe e backupPath preservados', () => {
    expect(buildSkipKloudHubArgs(true, 'C:\\backup\\kolnd')).toEqual({
      wipeUserData: true,
      skipKloud: true,
      backupPath: 'C:\\backup\\kolnd'
    })
    expect(buildSkipKloudHubArgs(false, null)).toEqual({
      wipeUserData: false,
      skipKloud: true,
      backupPath: null
    })
  })

  it('wipeUserData truthy não-booleano vira false', () => {
    // Defesa contra payload adulterado no IPC.
    expect(buildSkipKloudHubArgs(1 as never, null).wipeUserData).toBe(false)
  })
})
