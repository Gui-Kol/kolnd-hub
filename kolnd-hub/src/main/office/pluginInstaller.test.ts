import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { OFFICE_PLUGIN_SOURCE, OFFICE_PLUGIN_VERSION } from './pluginSource'
import {
  hasJsonComments,
  installPlugin,
  pluginSnippet,
  pluginStatus,
  readConfigState,
  removePlugin,
  resolveInstallerPaths,
  type PluginInstallerPaths
} from './pluginInstaller'

/**
 * Testes do instalador do plugin (T12a). TODOS trabalham em `%TEMP%` via
 * overrides explícitos de `configDir`/`pluginDir`: nenhum teste encosta no
 * `~/.config/opencode` nem no `%APPDATA%` reais.
 */

const tempRoots: string[] = []

interface Fixture {
  root: string
  configDir: string
  pluginDir: string
  paths: PluginInstallerPaths
}

function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'kolnd-hub-plugin-'))
  tempRoots.push(root)
  const configDir = join(root, 'opencode')
  const pluginDir = join(root, 'userData', 'office', 'plugin')
  return {
    root,
    configDir,
    pluginDir,
    paths: resolveInstallerPaths({ configDir, pluginDir })
  }
}

function writeConfig(fixture: Fixture, content: string, file = 'opencode.json'): string {
  mkdirSync(fixture.configDir, { recursive: true })
  const target = join(fixture.configDir, file)
  writeFileSync(target, content, 'utf8')
  return target
}

function readConfig(paths: PluginInstallerPaths): Record<string, unknown> {
  return JSON.parse(readFileSync(paths.configPath, 'utf8')) as Record<string, unknown>
}

function backupFiles(configDir: string): string[] {
  return readdirSync(configDir).filter((name) => name.includes('.kolnd-backup-'))
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveInstallerPaths', () => {
  it('aceita os overrides de ambiente só para config e plugin', () => {
    const base = join(tmpdir(), 'kolnd-env-fixture')
    const paths = resolveInstallerPaths({
      env: {
        KOLDND_HUB_OPENCODE_CONFIG_DIR: join(base, 'config'),
        KOLDND_HUB_OFFICE_PLUGIN_DIR: join(base, 'plugin')
      }
    })
    expect(paths.configDir).toBe(join(base, 'config'))
    expect(paths.pluginDir).toBe(join(base, 'plugin'))
    expect(paths.configPath).toBe(join(base, 'config', 'opencode.json'))

    const defaults = resolveInstallerPaths({
      configDir: join(base, 'config-padrao'),
      env: { APPDATA: join(base, 'appdata') }
    })
    expect(defaults.pluginDir).toBe(join(base, 'appdata', 'kolnd-hub', 'office', 'plugin'))
  })
})

describe('installPlugin', () => {
  it('sem config: cria opencode.json com $schema e a entrada file:///', () => {
    const fixture = makeFixture()
    const result = installPlugin(fixture.paths)

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.configPath).toBe(join(fixture.configDir, 'opencode.json'))
    expect(result.entry).toBe(pathToFileURL(fixture.pluginDir).href)

    const config = readConfig(fixture.paths)
    expect(config.$schema).toBe('https://opencode.ai/config.json')
    expect(config.plugins).toEqual([pathToFileURL(fixture.pluginDir).href])

    expect(readFileSync(join(fixture.pluginDir, 'index.js'), 'utf8')).toBe(OFFICE_PLUGIN_SOURCE)
    const state = readConfigState(fixture.paths)
    expect(state.exists).toBe(true)
    expect(state.kind).toBe('json')
    expect(state.entry).toBe(pathToFileURL(fixture.pluginDir).href)
  })

  it('config sem plugins: adiciona o array preservando as outras chaves', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  "theme": "dark",\n  "autoupdate": true\n}\n')

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)

    const config = readConfig(fixture.paths)
    expect(config.theme).toBe('dark')
    expect(config.autoupdate).toBe(true)
    expect(config.plugins).toEqual([result.entry])
  })

  it('config com plugins existentes: preserva todos e acrescenta no fim', () => {
    const fixture = makeFixture()
    writeConfig(
      fixture,
      JSON.stringify(
        {
          theme: 'dark',
          plugins: ['C:\\outro\\plugin.js', 'file:///C:/outro/plugin-dois/index.js']
        },
        null,
        2
      )
    )

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)

    const config = readConfig(fixture.paths)
    expect(config.plugins).toEqual([
      'C:\\outro\\plugin.js',
      'file:///C:/outro/plugin-dois/index.js',
      result.entry
    ])
    expect(config.theme).toBe('dark')
  })

  it('config com comentários: recusa, devolve o snippet e não altera um byte', () => {
    const fixture = makeFixture()
    const original = '{\n  // meus plugins\n  "theme": "dark"\n}\n'
    const configPath = writeConfig(fixture, original)
    const before = readFileSync(configPath)

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('comentarios')
    expect(result.snippet).toContain('"plugins"')
    expect(result.snippet).toContain(result.entry)

    expect(readFileSync(configPath).equals(before)).toBe(true)
    expect(readdirSync(fixture.configDir).some((name) => name.includes('backup'))).toBe(false)
    // O config não muda, mas os arquivos do plugin são gravados para o trecho
    // colado manualmente já apontar para algo existente.
    expect(readFileSync(join(fixture.pluginDir, 'index.js'), 'utf8')).toBe(OFFICE_PLUGIN_SOURCE)
  })

  it('config com comentários já contendo nossa entrada: atualiza só os arquivos', () => {
    const fixture = makeFixture()
    const entry = pathToFileURL(fixture.pluginDir).href
    const original = `{\n  // plugins\n  "plugins": [${JSON.stringify(entry)}]\n}\n`
    const configPath = writeConfig(fixture, original)
    const before = readFileSync(configPath)

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
    expect(readFileSync(configPath).equals(before)).toBe(true)
    expect(readFileSync(join(fixture.pluginDir, 'index.js'), 'utf8')).toBe(OFFICE_PLUGIN_SOURCE)
  })

  it('JSON inválido: recusa com json-invalido e deixa o arquivo intacto', () => {
    const fixture = makeFixture()
    const original = '{ "plugins": [ }\n'
    const configPath = writeConfig(fixture, original)
    const before = readFileSync(configPath)

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('json-invalido')
    expect(result.message).toBeTruthy()
    expect(readFileSync(configPath).equals(before)).toBe(true)
  })

  it('cria backup com o conteúdo original antes de reescrever', () => {
    const fixture = makeFixture()
    const original = '{\n  "theme": "dark"\n}\n'
    writeConfig(fixture, original)

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.backupPath).toBeTruthy()

    const backups = backupFiles(fixture.configDir)
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(fixture.configDir, backups[0]), 'utf8')).toBe(original)
  })

  it('instalar duas vezes é idempotente (uma entrada e um backup só)', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  "theme": "dark"\n}\n')

    const first = installPlugin(fixture.paths)
    const second = installPlugin(fixture.paths)

    expect(first.ok).toBe(true)
    expect(first.changed).toBe(true)
    expect(second.ok).toBe(true)
    expect(second.changed).toBe(false)

    const config = readConfig(fixture.paths)
    expect(config.plugins).toEqual([first.entry])
    expect(backupFiles(fixture.configDir)).toHaveLength(1)
  })

  it('config .jsonc sem comentários é respeitado', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  "theme": "dark"\n}\n', 'opencode.jsonc')

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.configPath).toBe(join(fixture.configDir, 'opencode.jsonc'))

    const state = readConfigState(fixture.paths)
    expect(state.kind).toBe('jsonc')
    expect(state.entry).toBe(result.entry)
  })

  it('aceita a entrada já presente apontando para o index.js do plugin', () => {
    const fixture = makeFixture()
    const indexEntry = pathToFileURL(join(fixture.pluginDir, 'index.js')).href
    writeConfig(fixture, JSON.stringify({ plugins: [indexEntry] }, null, 2))

    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.changed).toBe(false)
    expect(readConfig(fixture.paths).plugins).toEqual([indexEntry])
    expect(pluginStatus(fixture.paths).installed).toBe(true)
  })
})

describe('removePlugin', () => {
  it('remove só a nossa entrada e mantém as demais', () => {
    const fixture = makeFixture()
    writeConfig(
      fixture,
      JSON.stringify(
        { theme: 'dark', plugins: ['C:\\outro\\plugin.js', 'file:///C:/outro/dois.js'] },
        null,
        2
      )
    )
    const installed = installPlugin(fixture.paths)
    expect(installed.ok).toBe(true)

    const result = removePlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.removed).toBe(true)

    const config = readConfig(fixture.paths)
    expect(config.plugins).toEqual(['C:\\outro\\plugin.js', 'file:///C:/outro/dois.js'])
    expect(config.theme).toBe('dark')
    expect(pluginStatus(fixture.paths).installed).toBe(false)
  })

  it('sem instalação: no-op com removed false e arquivo intacto', () => {
    const fixture = makeFixture()
    const configPath = writeConfig(fixture, '{\n  "theme": "dark"\n}\n')
    const before = readFileSync(configPath)

    const result = removePlugin(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.removed).toBe(false)
    expect(readFileSync(configPath).equals(before)).toBe(true)
  })

  it.runIf(process.platform === 'win32')(
    'reconhece a entrada com caixa diferente no Windows',
    () => {
      const fixture = makeFixture()
      const entry = pathToFileURL(fixture.pluginDir).href.toUpperCase()
      writeConfig(fixture, JSON.stringify({ plugins: [entry] }, null, 2))

      const result = removePlugin(fixture.paths)
      expect(result.ok).toBe(true)
      expect(result.removed).toBe(true)
      expect(readConfig(fixture.paths).plugins).toEqual([])
    }
  )

  it('config com comentários: recusa a remoção sem tocar no arquivo', () => {
    const fixture = makeFixture()
    const configPath = writeConfig(fixture, '{\n  /* plugins */\n  "plugins": []\n}\n')
    const before = readFileSync(configPath)

    const result = removePlugin(fixture.paths)
    expect(result.ok).toBe(false)
    expect(result.removed).toBe(false)
    expect(result.reason).toBe('comentarios')
    expect(readFileSync(configPath).equals(before)).toBe(true)
  })
})

describe('pluginStatus', () => {
  it('reflete instalado, versão e desatualização', () => {
    const fixture = makeFixture()

    const empty = pluginStatus(fixture.paths)
    expect(empty.installed).toBe(false)
    expect(empty.pluginDirExists).toBe(false)
    expect(empty.versionInstalled).toBeNull()
    expect(empty.versionBundled).toBe(OFFICE_PLUGIN_VERSION)
    expect(empty.stale).toBe(false)
    expect(empty.configKind).toBe('none')
    expect(empty.needsManual).toBe(false)

    const installed = installPlugin(fixture.paths)
    const status = pluginStatus(fixture.paths)
    expect(status.installed).toBe(true)
    expect(status.pluginDirExists).toBe(true)
    expect(status.versionInstalled).toBe(OFFICE_PLUGIN_VERSION)
    expect(status.stale).toBe(false)
    expect(status.configKind).toBe('json')
    expect(status.entry).toBe(installed.entry)
    expect(status.needsManual).toBe(false)

    // Cópia antiga no disco (ex.: plugin atualizado no Hub, arquivos idosos).
    writeFileSync(
      join(fixture.pluginDir, 'version.json'),
      `${JSON.stringify({ version: '0.0.1', installedAt: new Date().toISOString() })}\n`,
      'utf8'
    )
    expect(pluginStatus(fixture.paths).stale).toBe(true)
  })

  it('config com comentários: needsManual e kind jsonc', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  // sem a entrada\n  "theme": "dark"\n}\n', 'opencode.jsonc')

    const status = pluginStatus(fixture.paths)
    expect(status.installed).toBe(false)
    expect(status.configKind).toBe('jsonc')
    expect(status.needsManual).toBe(true)
  })
})

describe('version.json', () => {
  it('grava a versão do Hub e o instante da instalação', () => {
    const fixture = makeFixture()
    const result = installPlugin(fixture.paths)
    expect(result.ok).toBe(true)

    const version = JSON.parse(
      readFileSync(join(fixture.pluginDir, 'version.json'), 'utf8')
    ) as Record<string, unknown>
    expect(version.version).toBe(OFFICE_PLUGIN_VERSION)
    expect(typeof version.installedAt).toBe('string')
    expect(Number.isNaN(Date.parse(String(version.installedAt)))).toBe(false)

    const pkg = JSON.parse(readFileSync(join(fixture.pluginDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(pkg.name).toBe('kolnd-office')
    expect(pkg.type).toBe('module')
    expect(pkg.exports).toEqual({ '.': './index.js' })
  })
})

describe('pluginSnippet', () => {
  it('devolve o item para colar quando a lista já existe', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  // comentário\n  "plugins": []\n}\n', 'opencode.jsonc')

    const result = pluginSnippet(fixture.paths)
    expect(result.ok).toBe(true)
    expect(result.snippet).toBe(JSON.stringify(result.entry))
    expect(dirname(result.configPath)).toBe(fixture.configDir)
  })

  it('devolve a chave plugins completa quando ela não existe', () => {
    const fixture = makeFixture()
    writeConfig(fixture, '{\n  // comentário\n  "theme": "dark"\n}\n', 'opencode.jsonc')

    const result = pluginSnippet(fixture.paths)
    expect(result.snippet).toContain('"plugins"')
    expect(result.snippet).toContain(JSON.stringify(result.entry))
  })
})

describe('hasJsonComments', () => {
  it('ignora // e /* */ dentro de strings (URLs e escapes) e detecta os reais', () => {
    expect(hasJsonComments('{"url": "https://example.com/a//b"}')).toBe(false)
    expect(hasJsonComments('{"a": "diga \\"// não é comentário\\""}')).toBe(false)
    expect(hasJsonComments('{"a": "/* também não */"}')).toBe(false)
    expect(hasJsonComments('{\n  // real\n  "a": 1\n}')).toBe(true)
    expect(hasJsonComments('{\n  /* real */\n  "a": 1\n}')).toBe(true)
    expect(hasJsonComments('{"caminho": "C:\\\\pasta\\\\arquivo"}')).toBe(false)
  })
})
