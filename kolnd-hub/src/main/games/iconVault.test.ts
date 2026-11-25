import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mocks = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData }
}))

import {
  hasIcon,
  iconVaultDir,
  materialize,
  putIcon,
  readIcon,
  removeIfUnreferenced
} from './iconVault'

let userDataDir: string
let vaultDir: string

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'kolnd-icon-vault-test-'))
  mocks.userData = userDataDir
  vaultDir = join(userDataDir, 'icon-vault')
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

const png = (content: string): Buffer => Buffer.from(content)

/** Nenhum temporário de escrita atômica pode sobrar na pasta. */
function tempFiles(): string[] {
  try {
    return readdirSync(vaultDir).filter((entry) => entry.endsWith('.tmp'))
  } catch {
    return []
  }
}

describe('iconVaultDir', () => {
  it('fica em <userData>/icon-vault', () => {
    expect(iconVaultDir()).toBe(join(userDataDir, 'icon-vault'))
  })
})

describe('putIcon', () => {
  it('grava pelo sha e deduplica conteúdo idêntico', () => {
    const first = putIcon(png('abc'), '.png')
    const second = putIcon(png('abc'), '.png')

    expect(first).not.toBeNull()
    expect(first!.sha).toMatch(/^[a-f0-9]{64}$/)
    expect(first!.ext).toBe('.png')
    expect(first!.path).toBe(join(vaultDir, `${first!.sha}.png`))
    expect(second).toEqual(first)
    expect(readdirSync(vaultDir)).toEqual([`${first!.sha}.png`])
    expect(readFileSync(first!.path).toString()).toBe('abc')
    expect(tempFiles()).toEqual([])
  })

  it('conteúdo diferente gera outro blob; extensão é normalizada', () => {
    const a = putIcon(png('a'), '.PNG')
    const b = putIcon(png('b'), '.png')
    expect(a!.sha).not.toBe(b!.sha)
    expect(a!.ext).toBe('.png')
    expect(readdirSync(vaultDir).sort()).toEqual([`${a!.sha}.png`, `${b!.sha}.png`].sort())
  })

  it('recusa entrada inválida sem criar pasta', () => {
    expect(putIcon(Buffer.alloc(0), '.png')).toBeNull()
    expect(putIcon(png('x'), '.gif')).toBeNull()
    expect(putIcon(png('x'), 'png')).toBeNull()
    expect(putIcon('x' as unknown as Buffer, '.png')).toBeNull()
    expect(putIcon(Buffer.alloc(4 * 1024 * 1024 + 1), '.png')).toBeNull()
    expect(readdirSync(userDataDir)).not.toContain('icon-vault')
  })

  it('sobrescreve blob truncado existente via escrita atômica', () => {
    const written = putIcon(png('conteudo'), '.png')!
    writeFileSync(written.path, 'x')
    const repaired = putIcon(png('conteudo'), '.png')
    expect(repaired).toEqual(written)
    expect(readFileSync(written.path).toString()).toBe('conteudo')
    expect(tempFiles()).toEqual([])
  })
})

describe('readIcon / hasIcon', () => {
  it('lê os bytes e valida sha/ext', () => {
    const written = putIcon(png('bytes'), '.webp')!
    expect(hasIcon(written.sha, '.webp')).toBe(true)
    expect(readIcon(written.sha, '.webp')?.toString()).toBe('bytes')
    expect(readIcon(written.sha, '.png')).toBeNull()
    expect(readIcon('..\\..\\x', '.png')).toBeNull()
    expect(readIcon(42, '.png')).toBeNull()
    expect(readIcon(written.sha, '.gif')).toBeNull()
    expect(hasIcon(written.sha.toUpperCase(), '.webp')).toBe(false)
  })
})

describe('materialize', () => {
  it('regrava o blob num destino de forma atômica', () => {
    const written = putIcon(png('manual'), '.jpg')!
    const target = join(userDataDir, 'game-icons', 'jogo.jpg')

    expect(materialize(written.sha, '.jpg', target)).toBe(true)
    expect(readFileSync(target).toString()).toBe('manual')
    // Nenhum temporário fica no destino.
    const entries = readdirSync(join(userDataDir, 'game-icons'))
    expect(entries.filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('devolve false quando o blob não existe ou a identidade é inválida', () => {
    const target = join(userDataDir, 'game-icons', 'x.png')
    expect(materialize('a'.repeat(64), '.png', target)).toBe(false)
    expect(materialize('..', '.png', target)).toBe(false)
    expect(materialize('a'.repeat(64), '.gif', target)).toBe(false)
  })
})

describe('removeIfUnreferenced', () => {
  it('só remove quando nenhum jogo referencia o sha', () => {
    const written = putIcon(png('compartilhado'), '.png')!
    expect(removeIfUnreferenced(written.sha, '.png', () => true)).toBe(false)
    expect(hasIcon(written.sha, '.png')).toBe(true)

    expect(removeIfUnreferenced(written.sha, '.png', () => false)).toBe(true)
    expect(hasIcon(written.sha, '.png')).toBe(false)
    // Remover de novo é inofensivo.
    expect(removeIfUnreferenced(written.sha, '.png', () => false)).toBe(false)
  })

  it('identidade inválida não lança nem apaga nada', () => {
    expect(() => removeIfUnreferenced('..', '.png', () => false)).not.toThrow()
    expect(removeIfUnreferenced('a'.repeat(64), '.exe', () => false)).toBe(false)
  })
})
