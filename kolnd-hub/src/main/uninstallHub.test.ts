import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  normalizeHubUninstallArgs,
  wipeKolndHubUserData,
  spawnHubUninstaller
} from './uninstaller'

// Evita carregar efeitos colaterais de electron no ambiente de teste node.
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getPath: (name: string) => `C:\\fake\\${name}`
  },
  shell: { openPath: vi.fn() },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn() }
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn()
}))

// rmSync que pode falhar para .../config.json (simula item travado por AV);
// todo o resto do fs segue com a implementação real. O teste lig/desliga a
// simulação via `failWipeItem` (lida apenas quando rmSync é chamado, nunca no
// registro do mock).
let failWipeItem = false
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    rmSync: (target: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) => {
      if (failWipeItem && String(target).endsWith('config.json')) {
        throw new Error('arquivo em uso')
      }
      return actual.rmSync(target, options)
    }
  }
})

const { spawn } = await import('child_process')

describe('normalizeHubUninstallArgs — validação do payload do uninstall:hub', () => {
  it('objeto vazio → defaults seguros (nada é apagado)', () => {
    expect(normalizeHubUninstallArgs({})).toEqual({
      wipeUserData: false,
      skipKloud: false,
      backupPath: null
    })
  })

  it('payloads inválidos viram defaults seguros', () => {
    expect(normalizeHubUninstallArgs(null)).toEqual({
      wipeUserData: false,
      skipKloud: false,
      backupPath: null
    })
    expect(normalizeHubUninstallArgs(undefined)).toEqual({
      wipeUserData: false,
      skipKloud: false,
      backupPath: null
    })
    expect(normalizeHubUninstallArgs('wipe')).toEqual({
      wipeUserData: false,
      skipKloud: false,
      backupPath: null
    })
    expect(normalizeHubUninstallArgs([true])).toEqual({
      wipeUserData: false,
      skipKloud: false,
      backupPath: null
    })
  })

  it('strings truthy não habilitam o wipe (exige boolean true estrito)', () => {
    expect(normalizeHubUninstallArgs({ wipeUserData: 'true' }).wipeUserData).toBe(false)
    expect(normalizeHubUninstallArgs({ wipeUserData: 1 }).wipeUserData).toBe(false)
    expect(normalizeHubUninstallArgs({ skipKloud: 'sim' }).skipKloud).toBe(false)
  })

  it('aceita true booleano e apara espaços do backupPath', () => {
    expect(
      normalizeHubUninstallArgs({
        wipeUserData: true,
        skipKloud: true,
        backupPath: '   C:\\Users\\x\\Documents\\KolndHub-Backup-1  '
      })
    ).toEqual({
      wipeUserData: true,
      skipKloud: true,
      backupPath: 'C:\\Users\\x\\Documents\\KolndHub-Backup-1'
    })
  })

  it('backupPath inválido vira null; caminho gigante é truncado', () => {
    expect(normalizeHubUninstallArgs({ backupPath: 42 }).backupPath).toBeNull()
    expect(normalizeHubUninstallArgs({ backupPath: '   ' }).backupPath).toBeNull()
    expect(normalizeHubUninstallArgs({ backupPath: 'x'.repeat(5000) }).backupPath).toHaveLength(1024)
  })
})

describe('wipeKolndHubUserData — apagar %APPDATA%\\kolnd-hub com tmp dirs', () => {
  let base: string
  let root: string
  const logs: string[] = []
  const items: Array<{ item: string; ok: boolean; error?: string }> = []

  const log = (line: string): void => {
    logs.push(line)
  }
  const onItem = (item: string, ok: boolean, error?: string): void => {
    items.push({ item, ok, error })
  }

  beforeEach(() => {
    logs.length = 0
    items.length = 0
    // mkdtemp não garante sufixo 'kolnd-hub' — criamos a pasta exata dentro da base.
    base = mkdtempSync(join(tmpdir(), 'kolnd-hub-wipe-test-'))
    root = join(base, 'kolnd-hub')
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('apaga o conteúdo top-level recursivamente e remove a raiz vazia', () => {
    writeFileSync(join(root, 'config.json'), '{"apps":[]}', 'utf8')
    writeFileSync(join(root, 'first-run-complete.flag'), 'ok', 'utf8')
    mkdirSync(join(root, 'logs'), { recursive: true })
    writeFileSync(join(root, 'logs', 'uninstall.log'), 'lixo', 'utf8')
    mkdirSync(join(root, 'mark-lvi', 'memory'), { recursive: true })
    writeFileSync(join(root, 'mark-lvi', 'memory', 'm.json'), '{}', 'utf8')
    mkdirSync(join(root, 'game-icons'), { recursive: true })
    writeFileSync(join(root, 'game-icons', '1.png'), 'png', 'utf8')

    const result = wipeKolndHubUserData(root, log, onItem)

    expect(result.errors).toEqual([])
    expect(result.inventory).toEqual(
      ['config.json', 'first-run-complete.flag', 'game-icons', 'logs', 'mark-lvi'].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' })
      )
    )
    expect(result.deleted.sort()).toEqual(result.inventory.slice().sort())
    expect(existsSync(root)).toBe(false)
    expect(items.every((i) => i.ok)).toBe(true)
    expect(items).toHaveLength(5)
    expect(logs.join('')).toContain('Inventário')
  })

  it('pasta inexistente → erro no laudo, sem lançar', () => {
    // Apaga a raiz criada no beforeEach para simular a pasta removida (ou nunca criada).
    rmSync(root, { recursive: true, force: true })

    const result = wipeKolndHubUserData(root, log, onItem)

    expect(result.inventory).toEqual([])
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].item).toBe(root)
    expect(logs.join('')).toContain('não existe')
  })

  it('recusa operar fora de uma pasta chamada kolnd-hub (trava de segurança)', () => {
    const other = join(base, 'nao-kolnd-hub')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'importante.txt'), 'não toque', 'utf8')

    const result = wipeKolndHubUserData(other, log, onItem)

    expect(result.errors).toHaveLength(1)
    expect(result.deleted).toEqual([])
    expect(readFileSync(join(other, 'importante.txt'), 'utf8')).toBe('não toque')
  })

  it('falha de um item não impede os demais (errors[] no laudo)', () => {
    writeFileSync(join(root, 'config.json'), '{}', 'utf8')
    mkdirSync(join(root, 'logs'), { recursive: true })
    writeFileSync(join(root, 'logs', 'x.log'), 'x', 'utf8')

    // O mock de 'fs' acima faz rmSync lançar em .../config.json enquanto a simulação está ligada.
    // Os demais itens devem ser apagados normalmente.
    failWipeItem = true
    let result: ReturnType<typeof wipeKolndHubUserData>
    try {
      result = wipeKolndHubUserData(root, log, onItem)
    } finally {
      failWipeItem = false
    }

    expect(result.deleted).toContain('logs')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].item).toBe('config.json')
    expect(result.errors[0].error).toContain('arquivo em uso')
    // A raiz permanece (config.json falhou) — nada é fingido como apagado.
    expect(existsSync(join(root, 'logs'))).toBe(false)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
  })
})

describe('spawnHubUninstaller — spawn desanexado do NSIS', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset()
  })

  it('resolve no evento "spawn", desanexa e usa as flags certas', async () => {
    const em = new EventEmitter() as EventEmitter & { unref: () => void; removeListener: EventEmitter['removeListener'] }
    em.unref = vi.fn()
    vi.mocked(spawn).mockReturnValue(em as never)

    const promise = spawnHubUninstaller('C:\\Programas\\Kolnd Hub\\Uninstall Kolnd Hub.exe')
    em.emit('spawn')
    await expect(promise).resolves.toBeUndefined()

    expect(em.unref).toHaveBeenCalledTimes(1)
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      'C:\\Programas\\Kolnd Hub\\Uninstall Kolnd Hub.exe',
      [],
      expect.objectContaining({ detached: true, stdio: 'ignore', windowsHide: false })
    )
  })

  it('rejeita no evento "error" (ex.: AV bloqueou o spawn)', async () => {
    const em = new EventEmitter() as EventEmitter & { unref: () => void }
    em.unref = vi.fn()
    vi.mocked(spawn).mockReturnValue(em as never)

    const promise = spawnHubUninstaller('C:\\fake\\Uninstall Kolnd Hub.exe')
    em.emit('error', new Error('spawn EACCES'))
    await expect(promise).rejects.toThrow('spawn EACCES')
  })

  it('rejeita se o próprio spawn lançar (arquivo não encontrado)', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    await expect(spawnHubUninstaller('Z:\\nao-existe\\Uninstall Kolnd Hub.exe')).rejects.toThrow(
      'ENOENT'
    )
  })
})
