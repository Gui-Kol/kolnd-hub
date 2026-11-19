import { describe, expect, it } from 'vitest'
import {
  MAX_INSTALLER_BYTES,
  compareVersions,
  isAllowedReleaseDownloadUrl,
  isAllowedReleasePageUrl,
  isInstallerSignatureAcceptable,
  isReleaseInstallable,
  isReleaseNewerThanInstalled,
  parseAuthenticodeJson,
  parseRelease,
  parseVersionTag,
  pickInstallerAsset,
  releaseInstallBlocker,
  updateReleaseApiUrl,
  type ParsedVersion,
  type ReleaseInfo
} from './updates'

const RELEASE_URL = 'https://github.com/Gui-Kol/kolnd-hub/releases/tag/v1.0'
const SETUP_URL =
  'https://github.com/Gui-Kol/kolnd-hub/releases/download/v1.0/Kolnd.Hub.Setup.1.0.Estavel.exe'
const PORTABLE_URL =
  'https://github.com/Gui-Kol/kolnd-hub/releases/download/v1.0/Kolnd.Hub.1.0.Estavel.portable.zip'

function asset(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    name: 'Kolnd Hub Setup 1.5.0.exe',
    size: 100,
    browser_download_url: SETUP_URL,
    digest: null,
    ...partial
  }
}

function release(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123,
    tag_name: 'v1.5.0',
    name: 'Kolnd Hub v1.5.0',
    html_url: RELEASE_URL,
    published_at: '2026-11-17T10:00:00Z',
    body: 'Notas',
    assets: [asset({})],
    ...partial
  }
}

describe('pickInstallerAsset', () => {
  it('prefere um .exe com "setup" e ignora o portable zip', () => {
    const picked = pickInstallerAsset([
      asset({ name: 'Kolnd.Hub.1.0.Estavel.portable.zip', browser_download_url: PORTABLE_URL }),
      asset({ name: 'Kolnd.Hub.Setup.1.0.Estavel.exe' }),
      asset({ name: 'outra-ferramenta.exe' })
    ])
    expect(picked).toMatchObject({ name: 'Kolnd.Hub.Setup.1.0.Estavel.exe', size: 100 })
  })

  it('cai para qualquer .exe quando nenhum tem "setup"', () => {
    const picked = pickInstallerAsset([
      asset({ name: 'portable-win.exe' }),
      asset({ name: 'KH-v1.1.0-beta-setup.exe' })
    ])
    expect(picked?.name).toBe('KH-v1.1.0-beta-setup.exe')
  })

  it('devolve null sem .exe válido, com asset grande demais ou URL fora do GitHub', () => {
    expect(pickInstallerAsset(null)).toBeNull()
    expect(pickInstallerAsset([])).toBeNull()
    expect(pickInstallerAsset([asset({ name: 'pacote.zip' })])).toBeNull()
    expect(pickInstallerAsset([asset({ size: MAX_INSTALLER_BYTES + 1 })])).toBeNull()
    expect(
      pickInstallerAsset([asset({ browser_download_url: 'https://evil.example/setup.exe' })])
    ).toBeNull()
  })

  it('mantém o digest sha256 quando o GitHub informa', () => {
    const digest = `sha256:${'a'.repeat(64)}`
    const picked = pickInstallerAsset([asset({ digest })])
    expect(picked?.digest).toBe(digest)
    // Digest malformado não derruba o asset — só vira null.
    expect(pickInstallerAsset([asset({ digest: 'md5:abc' })])?.digest).toBeNull()
  })
})

describe('parseRelease', () => {
  it('normaliza uma release completa', () => {
    const parsed = parseRelease(release())
    expect(parsed).toMatchObject({
      id: 123,
      tag: 'v1.5.0',
      name: 'Kolnd Hub v1.5.0',
      pageUrl: RELEASE_URL,
      publishedAt: '2026-11-17T10:00:00Z'
    })
    expect(parsed?.installer?.name).toBe('Kolnd Hub Setup 1.5.0.exe')
  })

  it('usa a tag como nome e aceita release sem published_at/body', () => {
    const parsed = parseRelease(release({ name: '  ', published_at: 42, body: null }))
    expect(parsed?.name).toBe('v1.5.0')
    expect(parsed?.publishedAt).toBeNull()
    expect(parsed?.notes).toBe('')
  })

  it('rejeita id inválido, tag vazia, página fora do repositório e formato não-objeto', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('texto')).toBeNull()
    expect(parseRelease(release({ id: 0 }))).toBeNull()
    expect(parseRelease(release({ id: 1.5 }))).toBeNull()
    expect(parseRelease(release({ tag_name: '   ' }))).toBeNull()
    expect(parseRelease(release({ tag_name: 'x'.repeat(65) }))).toBeNull()
    expect(
      parseRelease(release({ html_url: 'https://github.com/outro/repo/releases/tag/v1' }))
    ).toBeNull()
  })

  it('aceita release sem instalador (installer null)', () => {
    const parsed = parseRelease(release({ assets: [] }))
    expect(parsed?.installer).toBeNull()
  })
})

describe('allowlists de URL', () => {
  it('aceita download do repositório e do CDN do GitHub', () => {
    expect(isAllowedReleaseDownloadUrl(SETUP_URL)).toBe(true)
    expect(
      isAllowedReleaseDownloadUrl(
        'https://objects.githubusercontent.com/github-production-release-asset/1/setup.exe'
      )
    ).toBe(true)
  })

  it('rejeita http, host estranho e outro repositório', () => {
    expect(isAllowedReleaseDownloadUrl(SETUP_URL.replace('https:', 'http:'))).toBe(false)
    expect(
      isAllowedReleaseDownloadUrl('https://github.com/outro/repo/releases/download/v1/a.exe')
    ).toBe(false)
    expect(isAllowedReleaseDownloadUrl('https://evil.example/setup.exe')).toBe(false)
    expect(isAllowedReleaseDownloadUrl('arquivo.exe')).toBe(false)
  })

  it('página da release só no repositório oficial por https', () => {
    expect(isAllowedReleasePageUrl(RELEASE_URL)).toBe(true)
    expect(isAllowedReleasePageUrl(RELEASE_URL.replace('https:', 'http:'))).toBe(false)
    expect(isAllowedReleasePageUrl('https://github.com/outro/repo/releases/tag/v1')).toBe(false)
  })
})

describe('parseAuthenticodeJson / isInstallerSignatureAcceptable', () => {
  it('interpreta os status que o projeto aceita', () => {
    expect(parseAuthenticodeJson('{"Status":"Valid","Subject":"CN=Kolnd"}')).toEqual({
      status: 'valid',
      signerSubject: 'CN=Kolnd'
    })
    expect(parseAuthenticodeJson('{"Status":"NotSigned","Subject":null}')).toEqual({
      status: 'unsigned',
      signerSubject: null
    })
  })

  it('trata hash quebrado e status desconhecido como recusáveis', () => {
    expect(parseAuthenticodeJson('{"Status":"HashMismatch","Subject":""}')).toEqual({
      status: 'invalid',
      signerSubject: null
    })
    expect(parseAuthenticodeJson('{"Status":"NotTrusted","Subject":"CN=X"}').status).toBe('invalid')
    expect(parseAuthenticodeJson('{"Status":"NotSupported"}').status).toBe('invalid')
    expect(parseAuthenticodeJson('{"Status":"Surpresa"}').status).toBe('unknown')
  })

  it('ignora ruído antes do JSON (última linha útil vence)', () => {
    const raw = [
      'WARNING: aviso qualquer do PowerShell',
      '{"Status":"Valid","Subject":"CN=Kolnd"}',
      ''
    ].join('\r\n')
    expect(parseAuthenticodeJson(raw)).toEqual({ status: 'valid', signerSubject: 'CN=Kolnd' })
  })

  it('devolve unknown para JSON inválido, vazio ou sem Status', () => {
    expect(parseAuthenticodeJson('')).toEqual({ status: 'unknown', signerSubject: null })
    expect(parseAuthenticodeJson('não é json')).toEqual({ status: 'unknown', signerSubject: null })
    expect(parseAuthenticodeJson('{quebrado')).toEqual({ status: 'unknown', signerSubject: null })
    expect(parseAuthenticodeJson('{"Subject":"CN=X"}').status).toBe('unknown')
  })

  it('aceita status sem diferenciar maiúsculas/minúsculas', () => {
    expect(parseAuthenticodeJson('{"Status":"VALID"}').status).toBe('valid')
    expect(parseAuthenticodeJson('{"Status":"notsigned"}').status).toBe('unsigned')
    expect(parseAuthenticodeJson('{"Status":"hashmismatch"}').status).toBe('invalid')
  })

  it('aceita Valid sem Subject (Subject vira null)', () => {
    expect(parseAuthenticodeJson('{"Status":"Valid"}')).toEqual({
      status: 'valid',
      signerSubject: null
    })
  })

  it('só Valid e NotSigned passam na política', () => {
    expect(isInstallerSignatureAcceptable({ status: 'valid', signerSubject: 'CN=X' })).toBe(true)
    expect(isInstallerSignatureAcceptable({ status: 'unsigned', signerSubject: null })).toBe(true)
    expect(isInstallerSignatureAcceptable({ status: 'invalid', signerSubject: null })).toBe(false)
    expect(isInstallerSignatureAcceptable({ status: 'unknown', signerSubject: null })).toBe(false)
  })
})

describe('isReleaseInstallable / releaseInstallBlocker', () => {
  const digest = `sha256:${'a'.repeat(64)}`

  function info(installer: ReleaseInfo['installer']): ReleaseInfo {
    return {
      id: 123,
      tag: 'v1.5.0',
      name: 'Kolnd Hub v1.5.0',
      pageUrl: RELEASE_URL,
      publishedAt: null,
      notes: '',
      installer
    }
  }

  it('aceita build empacotado com instalador e hash publicado', () => {
    const release = info({ name: 'setup.exe', size: 100, downloadUrl: SETUP_URL, digest })
    expect(isReleaseInstallable(release, true)).toBe(true)
    expect(releaseInstallBlocker(release)).toBeNull()
  })

  it('recusa fora do app instalado mesmo com release perfeita', () => {
    const release = info({ name: 'setup.exe', size: 100, downloadUrl: SETUP_URL, digest })
    expect(isReleaseInstallable(release, false)).toBe(false)
  })

  it('recusa release sem hash publicado (motivo cita o SHA-256)', () => {
    const release = info({ name: 'setup.exe', size: 100, downloadUrl: SETUP_URL, digest: null })
    expect(isReleaseInstallable(release, true)).toBe(false)
    expect(releaseInstallBlocker(release)).toContain('SHA-256')
  })

  it('recusa release sem instalador .exe', () => {
    const release = info(null)
    expect(isReleaseInstallable(release, true)).toBe(false)
    expect(releaseInstallBlocker(release)).toContain('instalador')
  })
})

describe('updateReleaseApiUrl', () => {
  it('monta a URL de consulta por ID', () => {
    expect(updateReleaseApiUrl(42)).toBe(
      'https://api.github.com/repos/Gui-Kol/kolnd-hub/releases/42'
    )
  })
})

describe('parseVersionTag', () => {
  it('interpreta tag com/sem "v" e com prerelease', () => {
    expect(parseVersionTag('v1.5.0')).toEqual({ major: 1, minor: 5, patch: 0, prerelease: [] })
    expect(parseVersionTag('1.4.0')).toEqual({ major: 1, minor: 4, patch: 0, prerelease: [] })
    expect(parseVersionTag('v1.5.0-beta.1')).toEqual({
      major: 1,
      minor: 5,
      patch: 0,
      prerelease: ['beta', '1']
    })
    expect(parseVersionTag('  v2.0.1-rc.2  ')).toMatchObject({ major: 2, prerelease: ['rc', '2'] })
  })

  it('ignora build metadata (não muda precedência)', () => {
    expect(parseVersionTag('v1.4.0+sha.abc123')).toEqual({
      major: 1,
      minor: 4,
      patch: 0,
      prerelease: []
    })
  })

  it('devolve null para tag fora do SemVer', () => {
    for (const tag of ['v1.0', '1.4', 'v1.4.0.1', 'release-1', '', 'v1.4.0-a..b', 'v1.4.0+']) {
      expect(parseVersionTag(tag)).toBeNull()
    }
  })
})

describe('compareVersions', () => {
  function version(tag: string): ParsedVersion {
    const parsed = parseVersionTag(tag)
    if (!parsed) throw new Error(`tag de teste inválida: ${tag}`)
    return parsed
  }

  it('compara major/minor/patch numericamente', () => {
    expect(compareVersions(version('v1.5.0'), version('1.4.0'))).toBe(1)
    expect(compareVersions(version('v1.9.0'), version('1.10.0'))).toBe(-1)
    expect(compareVersions(version('1.4.0'), version('v1.4.0'))).toBe(0)
  })

  it('prerelease ordena antes da release correspondente', () => {
    expect(compareVersions(version('v1.5.0-beta.1'), version('v1.5.0'))).toBe(-1)
    expect(compareVersions(version('v1.5.0'), version('v1.5.0-beta.1'))).toBe(1)
    expect(compareVersions(version('1.5.0-beta.2'), version('1.5.0-beta.10'))).toBe(-1)
  })
})

describe('isReleaseNewerThanInstalled', () => {
  const cases: Array<[string, string, boolean]> = [
    ['v1.5.0', '1.4.0', true],
    ['1.4.0', 'v1.4.0', false],
    ['v1.3.9', '1.4.0', false],
    ['v1.5.0-beta.1', '1.4.0', true],
    ['v1.5.0-beta.1', 'v1.5.0', false],
    ['v1.0', '1.4.0', false],
    ['1.4', 'v1.4.0', false],
    ['v1.4.0.1', '1.4.0', false],
    ['release-1', '1.4.0', false],
    ['', '1.4.0', false],
    ['v1.5.0', 'release-1', false]
  ]

  it.each(cases)('%s contra %s → %s', (releaseTag, installedVersion, expected) => {
    expect(isReleaseNewerThanInstalled(releaseTag, installedVersion)).toBe(expected)
  })

  it('tag que não parseia nunca é atualização (sem banner)', () => {
    expect(isReleaseNewerThanInstalled('v1.0', '1.4.0')).toBe(false)
    expect(isReleaseNewerThanInstalled('', '')).toBe(false)
  })
})
