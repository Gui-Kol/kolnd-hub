import { describe, expect, it, vi } from 'vitest'
import type { StoredGame } from '../store'
import {
  findGameIconAssets,
  GAME_ASSET_SCAN_MAX_FILES,
  iconOriginForResolvedSource,
  resolveGameIcon,
  shortcutMatchesExe,
  type AssetScanFs,
  type IconResolveDeps,
  type LocalIconCandidate,
  type ShortcutEntry
} from './iconResolve'

const EXE = 'C:\\Jogos\\Jogo\\jogo.exe'

function game(overrides: Partial<StoredGame> = {}): StoredGame {
  return {
    id: 'game-1',
    name: 'Jogo',
    exePath: EXE,
    iconPath: null,
    origin: 'custom',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function deps(overrides: Partial<IconResolveDeps> = {}): IconResolveDeps {
  return {
    game: game(),
    localCandidates: [],
    vaultRead: () => null,
    fileExists: () => false,
    readFile: () => null,
    readImageFile: async () => null,
    readExeIconPng: async () => null,
    shortcuts: async () => [],
    readShortcutIconPng: async () => null,
    gameRoot: null,
    scanGameAssets: () => [],
    getFileIconPng: async () => null,
    ...overrides
  }
}

const local = (path: string, source: LocalIconCandidate['source'] = 'canonical') => ({
  path,
  source
})

describe('resolveGameIcon — ordem das fontes', () => {
  it('cofre vence todas as fontes locais', async () => {
    const result = await resolveGameIcon(
      deps({
        game: game({ iconSha: 'a'.repeat(64), iconExt: '.png' }),
        vaultRead: () => Buffer.from('vault'),
        localCandidates: [local('C:\\ud\\game-icons\\game-1.png')],
        fileExists: () => true,
        readFile: () => Buffer.from('local'),
        readExeIconPng: async () => Buffer.from('pe')
      })
    )
    expect(result).toMatchObject({ source: 'vault', ext: '.png' })
    expect(result!.buffer.toString()).toBe('vault')
  })

  it('arquivo local (iconPath → canônico → legado) vem antes do exe', async () => {
    const result = await resolveGameIcon(
      deps({
        localCandidates: [
          local('C:\\ud\\game-icons\\manual.jpg', 'icon-path'),
          local('C:\\ud\\game-icons\\game-1.png')
        ],
        fileExists: (path) => path.endsWith('manual.jpg') || path.endsWith('game-1.png'),
        readFile: () => Buffer.from('local'),
        readExeIconPng: async () => Buffer.from('pe')
      })
    )
    expect(result).toMatchObject({ source: 'icon-path', ext: '.jpg' })
  })

  it('converte .ico local antes de servir', async () => {
    const readImageFile = vi.fn(async () => ({ buffer: Buffer.from('png'), ext: '.png' }))
    const result = await resolveGameIcon(
      deps({
        localCandidates: [local('C:\\ud\\game-icons\\antigo.ico', 'icon-path')],
        fileExists: () => true,
        readFile: () => Buffer.from('ico-cru'),
        readImageFile
      })
    )
    expect(result).toMatchObject({ source: 'icon-path', ext: '.png' })
    expect(readImageFile).toHaveBeenCalledWith('C:\\ud\\game-icons\\antigo.ico')
  })

  it('ignora candidato local com extensão desconhecida', async () => {
    const readFile = vi.fn(() => Buffer.from('x'))
    const result = await resolveGameIcon(
      deps({
        localCandidates: [local('C:\\ud\\game-icons\\game-1.txt')],
        fileExists: () => true,
        readFile,
        getFileIconPng: async () => Buffer.from('shell')
      })
    )
    expect(result).toMatchObject({ source: 'file-icon' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('recursos PE vêm antes de atalho/assets/shell', async () => {
    const result = await resolveGameIcon(
      deps({
        fileExists: (path) => path === EXE,
        readExeIconPng: async () => Buffer.from('pe'),
        shortcuts: async () => [{ linkPath: 'C:\\a.lnk', target: EXE }],
        readShortcutIconPng: async () => Buffer.from('lnk'),
        getFileIconPng: async () => Buffer.from('shell')
      })
    )
    expect(result).toMatchObject({ source: 'exe-pe', ext: '.png' })
  })

  it('atalho só é usado quando o target casa com o executável', async () => {
    const readShortcutIconPng = vi.fn(async (linkPath: string) =>
      linkPath === 'C:\\match.lnk' ? Buffer.from('lnk') : null
    )
    const shortcuts: ShortcutEntry[] = [
      { linkPath: 'C:\\outro.lnk', target: 'C:\\Outro\\jogo.exe' },
      { linkPath: 'C:\\match.lnk', target: 'c:/jogos/jogo/jogo.EXE' }
    ]
    const result = await resolveGameIcon(
      deps({
        fileExists: (path) => path === EXE,
        shortcuts: async () => shortcuts,
        readShortcutIconPng
      })
    )
    expect(result).toMatchObject({ source: 'shortcut' })
    expect(readShortcutIconPng).toHaveBeenCalledTimes(1)
    expect(readShortcutIconPng).toHaveBeenCalledWith('C:\\match.lnk')
  })

  it('assets da pasta do jogo convertem .ico em png', async () => {
    const result = await resolveGameIcon(
      deps({
        gameRoot: 'C:\\Jogos\\Jogo',
        scanGameAssets: () => ['C:\\Jogos\\Jogo\\icon.ico'],
        readImageFile: async () => ({ buffer: Buffer.from('png-do-ico'), ext: '.png' })
      })
    )
    expect(result).toMatchObject({ source: 'game-assets', ext: '.png' })
  })

  it('app.getFileIcon é o último recurso', async () => {
    const result = await resolveGameIcon(
      deps({
        fileExists: (path) => path === EXE,
        getFileIconPng: async () => Buffer.from('shell')
      })
    )
    expect(result).toMatchObject({ source: 'file-icon' })
  })

  it('devolve null quando nenhuma fonte entrega um ícone válido', async () => {
    await expect(resolveGameIcon(deps())).resolves.toBeNull()
  })

  it('fonte que lança não interrompe a cascata', async () => {
    const result = await resolveGameIcon(
      deps({
        fileExists: (path) => path === EXE,
        shortcuts: async () => {
          throw new Error('sem permissão')
        },
        readExeIconPng: async () => null,
        getFileIconPng: async () => Buffer.from('shell')
      })
    )
    expect(result).toMatchObject({ source: 'file-icon' })
  })

  it('descarta buffers vazios/grandes e segue para a próxima fonte', async () => {
    const result = await resolveGameIcon(
      deps({
        localCandidates: [local('C:\\ud\\game-icons\\game-1.png')],
        fileExists: () => true,
        readFile: () => Buffer.alloc(0),
        readExeIconPng: async () => Buffer.alloc(4 * 1024 * 1024 + 1),
        getFileIconPng: async () => Buffer.from('ok')
      })
    )
    expect(result).toMatchObject({ source: 'file-icon' })
  })
})

describe('shortcutMatchesExe', () => {
  it('compara caminhos ignorando caixa e separador', () => {
    expect(shortcutMatchesExe('C:/Jogos/Jogo/JOGO.exe', 'c:\\jogos\\jogo\\jogo.exe')).toBe(true)
    expect(shortcutMatchesExe('C:\\Outro\\jogo.exe', EXE)).toBe(false)
    expect(shortcutMatchesExe('', EXE)).toBe(false)
  })
})

describe('iconOriginForResolvedSource', () => {
  it('não rebaixa manual quando a fonte é cofre/arquivo local', () => {
    for (const source of ['vault', 'icon-path', 'canonical', 'legacy'] as const) {
      expect(iconOriginForResolvedSource('manual', source)).toBe('manual')
    }
  })

  it('marca derived quando a fonte é re-derivada ou não havia origem', () => {
    for (const source of ['exe-pe', 'shortcut', 'game-assets', 'file-icon'] as const) {
      expect(iconOriginForResolvedSource('manual', source)).toBe('derived')
      expect(iconOriginForResolvedSource(undefined, source)).toBe('derived')
    }
    expect(iconOriginForResolvedSource(undefined, 'vault')).toBe('derived')
  })
})

function fakeFs(
  tree: Record<
    string,
    Array<{ name: string; isDirectory?: boolean; isFile?: boolean; isSymbolicLink?: boolean }>
  >,
  sizes: Record<string, number> = {}
): AssetScanFs {
  return {
    readDir: (dir) =>
      (tree[dir] ?? []).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory === true,
        isFile: entry.isFile !== false,
        isSymbolicLink: entry.isSymbolicLink === true
      })),
    statFile: (filePath) => ({ size: sizes[filePath] ?? 100 })
  }
}

describe('findGameIconAssets', () => {
  it('respeita profundidade máxima (2 níveis)', () => {
    const root = 'C:\\Jogo'
    const tree = {
      [root]: [
        { name: 'icon-root.png', isFile: true },
        { name: 'n1', isDirectory: true }
      ],
      'C:\\Jogo\\n1': [
        { name: 'logo-n1.png', isFile: true },
        { name: 'n2', isDirectory: true }
      ],
      'C:\\Jogo\\n1\\n2': [
        { name: 'game-n2.png', isFile: true },
        { name: 'n3', isDirectory: true }
      ],
      'C:\\Jogo\\n1\\n2\\n3': [{ name: 'game-n3.png', isFile: true }]
    }
    const result = findGameIconAssets(root, fakeFs(tree))

    expect(result).toContain('C:\\Jogo\\icon-root.png')
    expect(result).toContain('C:\\Jogo\\n1\\logo-n1.png')
    expect(result).toContain('C:\\Jogo\\n1\\n2\\game-n2.png')
    expect(result).not.toContain('C:\\Jogo\\n1\\n2\\n3\\game-n3.png')
  })

  it('limita o total de arquivos examinados', () => {
    const root = 'C:\\Jogo'
    const files = Array.from({ length: 10 }, (_, index) => ({
      name: `icon-${index}.png`,
      isFile: true
    }))
    const result = findGameIconAssets(root, fakeFs({ [root]: files }), { maxFiles: 3 })
    expect(result).toHaveLength(3)
  })

  it('descarta tamanho 0, > 4 MB, extensão desconhecida, sem keyword e nomes de instalador', () => {
    const root = 'C:\\Jogo'
    const tree = {
      [root]: [
        { name: 'icon-vazio.png', isFile: true },
        { name: 'icon-grande.png', isFile: true },
        { name: 'icon.txt', isFile: true },
        { name: 'readme.png', isFile: true },
        { name: 'unins000.png', isFile: true },
        { name: 'redist', isDirectory: true },
        { name: 'link.png', isFile: true, isSymbolicLink: true },
        { name: 'icon-bom.png', isFile: true }
      ],
      'C:\\Jogo\\redist': [{ name: 'icon-redist.png', isFile: true }]
    }
    const sizes = {
      'C:\\Jogo\\icon-vazio.png': 0,
      'C:\\Jogo\\icon-grande.png': 4 * 1024 * 1024 + 1
    }
    const result = findGameIconAssets(root, fakeFs(tree, sizes))
    expect(result).toEqual(['C:\\Jogo\\icon-bom.png'])
  })

  it('ordena por palavra-chave (icon → logo → game) e depois por profundidade', () => {
    const root = 'C:\\Jogo'
    const tree = {
      [root]: [
        { name: 'game.png', isFile: true },
        { name: 'logo.png', isFile: true },
        { name: 'icon.png', isFile: true }
      ]
    }
    expect(findGameIconAssets(root, fakeFs(tree))).toEqual([
      'C:\\Jogo\\icon.png',
      'C:\\Jogo\\logo.png',
      'C:\\Jogo\\game.png'
    ])
  })

  it('pasta raiz ilegível devolve lista vazia', () => {
    const fs = fakeFs({})
    fs.readDir = () => {
      throw new Error('EACCES')
    }
    expect(findGameIconAssets('C:\\Jogo', fs)).toEqual([])
  })

  it('termina rápido mesmo com muitos arquivos (teto de 200)', () => {
    const root = 'C:\\Jogo'
    const files = Array.from({ length: 5000 }, (_, index) => ({
      name: `icon-${index}.png`,
      isFile: true
    }))
    const started = Date.now()
    const result = findGameIconAssets(root, fakeFs({ [root]: files }))
    expect(result.length).toBeLessThanOrEqual(GAME_ASSET_SCAN_MAX_FILES)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
