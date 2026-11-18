import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseLibraryFolders, parseAppManifest, findGameExecutable } from './steamScanner'
import { steamGameRootFromExe } from './games/exeFinder'

// Fixture baseada na libraryfolders.vdf real desta máquina (formato novo).
const LIBRARYFOLDERS_MODERN = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"contentid"\t\t"1401161112026535465"
\t\t"apps"
\t\t{
\t\t\t"228980"\t\t"128606066"
\t\t}
\t}
}
`

const LIBRARYFOLDERS_LEGACY = `"LibraryFolders"
{
\t"TimeNextStatsReport"\t\t"12345"
\t"ContentStatsID"\t\t"123"
\t"1"\t\t"D:\\\\SteamLibrary"
\t"2"\t\t"E:/Jogos/Steam"
}
`

const ACF_BOUND = `"AppState"
{
\t"appid"\t\t"2406770"
\t"name"\t\t"Bodycam"
\t"installdir"\t\t"Bodycam"
}
`

describe('parseLibraryFolders', () => {
  it('extrai caminhos do formato novo e desescapa as barras', () => {
    const libs = parseLibraryFolders(LIBRARYFOLDERS_MODERN)
    expect(libs).toEqual(['C:\\Program Files (x86)\\Steam'])
  })

  it('cai para o formato legado (chaves numéricas) quando não há "path"', () => {
    const libs = parseLibraryFolders(LIBRARYFOLDERS_LEGACY)
    expect(libs).toContain('D:\\SteamLibrary')
    expect(libs).toContain('E:\\Jogos\\Steam')
    expect(libs).not.toContain('12345')
  })

  it('deduplica bibliotecas com barras diferentes (case/estilo)', () => {
    const dup = `"path"\t\t"C:\\\\Games\\\\Steam"\n"path"\t\t"c:/Games/Steam/"\n`
    expect(parseLibraryFolders(dup)).toHaveLength(1)
  })
})

describe('parseAppManifest', () => {
  it('extrai appid, name e installdir', () => {
    expect(parseAppManifest(ACF_BOUND)).toEqual({
      appId: 2406770,
      name: 'Bodycam',
      installDir: 'Bodycam'
    })
  })

  it('rejeita manifesto sem installdir', () => {
    expect(parseAppManifest('"appid"\t\t"123"\n"name"\t\t"X"\n')).toBeNull()
  })

  it('rejeita manifesto sem appid numérico', () => {
    expect(parseAppManifest('"appid"\t\t"abc"\n"name"\t\t"X"\n"installdir"\t\t"Y"\n')).toBeNull()
  })
})

describe('findGameExecutable', () => {
  let root: string | null = null

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  const setup = (): string => {
    root = mkdtempSync(join(tmpdir(), 'kolnd-steam-test-'))
    return root
  }

  it('prefere o exe cujo nome contém o nome da pasta de instalação', () => {
    const dir = setup()
    const gameDir = join(dir, 'Bodycam')
    mkdirSync(gameDir)
    writeFileSync(join(gameDir, 'Bodycam.exe'), 'x')
    writeFileSync(join(gameDir, 'UnityCrashHandler64.exe'), 'x'.repeat(100))
    writeFileSync(join(gameDir, 'setup.exe'), 'x'.repeat(1000))
    expect(findGameExecutable(gameDir)).toBe(join(gameDir, 'Bodycam.exe'))
  })

  it('sem correspondência pelo nome, escolhe o exe de maior tamanho', () => {
    const dir = setup()
    const gameDir = join(dir, 'Some Random Folder')
    mkdirSync(gameDir)
    writeFileSync(join(gameDir, 'a.exe'), 'x')
    writeFileSync(join(gameDir, 'b.exe'), 'x'.repeat(500))
    // unins*/vc_redist* são excluídos da disputa
    writeFileSync(join(gameDir, 'unins000.exe'), 'x'.repeat(5000))
    writeFileSync(join(gameDir, 'vc_redist.x64.exe'), 'x'.repeat(5000))
    expect(findGameExecutable(gameDir)).toBe(join(gameDir, 'b.exe'))
  })

  it('encontra exe em subpastas até profundidade 2', () => {
    const dir = setup()
    const gameDir = join(dir, 'Game')
    mkdirSync(join(gameDir, 'bin', 'x64'), { recursive: true })
    writeFileSync(join(gameDir, 'bin', 'x64', 'Game-Win64-Shipping.exe'), 'x')
    expect(findGameExecutable(gameDir)).toBe(join(gameDir, 'bin', 'x64', 'Game-Win64-Shipping.exe'))
  })

  it('prefere o exe da raiz mesmo menor que ferramentas em subpastas', () => {
    const dir = setup()
    const gameDir = join(dir, 'The Binding of Isaac Rebirth')
    mkdirSync(join(gameDir, 'tools', 'ModUploader'), { recursive: true })
    writeFileSync(join(gameDir, 'isaac-ng.exe'), 'x')
    writeFileSync(join(gameDir, 'tools', 'ModUploader', 'ModUploader.exe'), 'x'.repeat(5000))
    expect(findGameExecutable(gameDir)).toBe(join(gameDir, 'isaac-ng.exe'))
  })

  it('ignora pastas de ferramentas/redistribuíveis', () => {
    const dir = setup()
    const gameDir = join(dir, 'Some Game')
    mkdirSync(join(gameDir, 'Redistributables'), { recursive: true })
    mkdirSync(join(gameDir, '_CommonRedist', 'DirectX'), { recursive: true })
    writeFileSync(join(gameDir, 'Redistributables', 'Launcher.exe'), 'x'.repeat(5000))
    writeFileSync(join(gameDir, '_CommonRedist', 'DirectX', 'dxsetup.exe'), 'x'.repeat(5000))
    expect(findGameExecutable(gameDir)).toBeNull()
  })

  it('devolve null quando não há exe utilizável', () => {
    const dir = setup()
    const gameDir = join(dir, 'Game')
    mkdirSync(gameDir)
    writeFileSync(join(gameDir, 'unins000.exe'), 'x')
    writeFileSync(join(gameDir, 'readme.txt'), 'x')
    expect(findGameExecutable(gameDir)).toBeNull()
  })
})

describe('steamGameRootFromExe', () => {
  it('deriva a raiz da instalação a partir de um exe em subpasta', () => {
    expect(
      steamGameRootFromExe(
        join(
          'C:',
          'Program Files (x86)',
          'Steam',
          'steamapps',
          'common',
          'The Binding of Isaac Rebirth',
          'tools',
          'ModUploader',
          'ModUploader.exe'
        )
      )
    ).toBe(
      join(
        'C:',
        'Program Files (x86)',
        'Steam',
        'steamapps',
        'common',
        'The Binding of Isaac Rebirth'
      )
    )
  })

  it('aceita barras normais e diferenças de caixa', () => {
    expect(steamGameRootFromExe('D:/SteamLibrary/STEAMAPPS/COMMON/Bodycam/Bodycam.exe')).toBe(
      join('D:', 'SteamLibrary', 'STEAMAPPS', 'COMMON', 'Bodycam')
    )
  })

  it('retorna null para caminho fora de steamapps/common', () => {
    expect(steamGameRootFromExe('C:\\Jogos\\Jogo Custom\\jogo.exe')).toBeNull()
  })
})
