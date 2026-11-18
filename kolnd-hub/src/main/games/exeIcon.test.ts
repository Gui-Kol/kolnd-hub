import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parsePeHeaders, readExeIconIco } from './exeIcon'

/**
 * Constrói um PE mínimo (PE32, uma seção `.rsrc`) com um grupo de ícones
 * (`RT_GROUP_ICON` 14) e um ícone (`RT_ICON` 3). Os bytes do ícone são
 * arbitrários: o extrator só empacota o .ico, sem decodificar a imagem.
 */
function buildPeWithIcon(iconBytes: Buffer): Buffer {
  const resourceRva = 0x1000
  const rawPointer = 0x200
  // Layout do diretório de recursos (offsets relativos ao seu início).
  const rootDir = 0
  const groupTypeDir = 32
  const iconTypeDir = 56
  const groupLangDir = 80
  const iconLangDir = 104
  const groupDataEntry = 128
  const iconDataEntry = 144
  const groupDataOffset = 160
  const iconDataOffset = 180

  const group = Buffer.alloc(6 + 14)
  group.writeUInt16LE(0, 0) // reservado
  group.writeUInt16LE(1, 2) // tipo: ícone
  group.writeUInt16LE(1, 4) // 1 imagem
  group.writeUInt8(16, 6) // largura
  group.writeUInt8(16, 7) // altura
  group.writeUInt8(0, 8) // cores
  group.writeUInt16LE(1, 10) // planos
  group.writeUInt16LE(32, 12) // bits por pixel
  group.writeUInt32LE(iconBytes.length, 14)
  group.writeUInt16LE(2, 18) // id do RT_ICON

  const resource = Buffer.alloc(iconDataOffset + iconBytes.length)
  const writeDir = (offset: number, entries: Array<{ id: number; target: number }>): void => {
    resource.writeUInt32LE(0, offset) // characteristics
    resource.writeUInt32LE(0, offset + 4) // timestamp
    resource.writeUInt16LE(0, offset + 8) // major
    resource.writeUInt16LE(0, offset + 10) // minor
    resource.writeUInt16LE(0, offset + 12) // named entries
    resource.writeUInt16LE(entries.length, offset + 14)
    entries.forEach((entry, index) => {
      const at = offset + 16 + index * 8
      resource.writeUInt32LE(entry.id, at)
      resource.writeUInt32LE(entry.target >>> 0, at + 4)
    })
  }
  const SUBDIR = 0x80000000 >>> 0
  writeDir(rootDir, [
    { id: 14, target: groupTypeDir | SUBDIR },
    { id: 3, target: iconTypeDir | SUBDIR }
  ])
  writeDir(groupTypeDir, [{ id: 1, target: groupLangDir | SUBDIR }])
  writeDir(iconTypeDir, [{ id: 2, target: iconLangDir | SUBDIR }])
  writeDir(groupLangDir, [{ id: 1033, target: groupDataEntry }])
  writeDir(iconLangDir, [{ id: 1033, target: iconDataEntry }])
  // IMAGE_RESOURCE_DATA_ENTRY (RVA, tamanho, code page, reservado)
  resource.writeUInt32LE(resourceRva + groupDataOffset, groupDataEntry)
  resource.writeUInt32LE(group.length, groupDataEntry + 4)
  resource.writeUInt32LE(resourceRva + iconDataOffset, iconDataEntry)
  resource.writeUInt32LE(iconBytes.length, iconDataEntry + 4)
  group.copy(resource, groupDataOffset)
  iconBytes.copy(resource, iconDataOffset)

  const headerSize = rawPointer
  const pe = Buffer.alloc(headerSize)
  pe.writeUInt16LE(0x5a4d, 0) // "MZ"
  pe.writeUInt32LE(0x80, 0x3c) // e_lfanew
  pe.writeUInt32LE(0x00004550, 0x80) // "PE\0\0"
  const coff = 0x84
  pe.writeUInt16LE(0x14c, coff) // machine: i386
  pe.writeUInt16LE(1, coff + 2) // 1 seção
  pe.writeUInt16LE(224, coff + 16) // tamanho do optional header (PE32)
  const optional = coff + 20
  pe.writeUInt16LE(0x10b, optional) // PE32
  pe.writeUInt32LE(16, optional + 92) // numberOfRvaAndSizes
  pe.writeUInt32LE(resourceRva, optional + 96 + 16) // diretório de recursos
  pe.writeUInt32LE(resource.length, optional + 96 + 20)
  const section = optional + 224
  pe.write('.rsrc', section, 'ascii')
  pe.writeUInt32LE(resource.length, section + 8) // virtualSize
  pe.writeUInt32LE(resourceRva, section + 12) // virtualAddress
  pe.writeUInt32LE(resource.length, section + 16) // sizeOfRawData
  pe.writeUInt32LE(rawPointer, section + 20) // pointerToRawData

  return Buffer.concat([pe, resource])
}

let tempDir: string
let exePath: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kolnd-exe-icon-test-'))
  exePath = join(tempDir, 'game.exe')
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('parsePeHeaders', () => {
  it('lê a seção de recursos e a data directory', () => {
    const pe = buildPeWithIcon(Buffer.from('ICON'))
    const headers = parsePeHeaders(pe.subarray(0, 0x2000))
    expect(headers).not.toBeNull()
    expect(headers!.sections).toHaveLength(1)
    expect(headers!.sections[0]).toMatchObject({ virtualAddress: 0x1000, rawPointer: 0x200 })
    expect(headers!.resourceRva).toBe(0x1000)
    expect(headers!.resourceSize).toBeGreaterThan(0)
  })

  it('rejeita cabeçalho sem assinatura MZ/PE e truncado', () => {
    expect(parsePeHeaders(Buffer.alloc(0x40))).toBeNull()
    const semMZ = buildPeWithIcon(Buffer.from('ICON'))
    semMZ.writeUInt16LE(0, 0)
    expect(parsePeHeaders(semMZ.subarray(0, 0x2000))).toBeNull()
    expect(parsePeHeaders(buildPeWithIcon(Buffer.from('ICON')).subarray(0, 0x100))).toBeNull()
  })
})

describe('readExeIconIco', () => {
  it('empacota o grupo de ícones em um .ico de uma imagem', () => {
    const iconBytes = Buffer.from('ICONDATA')
    writeFileSync(exePath, buildPeWithIcon(iconBytes))
    const ico = readExeIconIco(exePath)
    expect(ico).not.toBeNull()
    expect(ico!.readUInt16LE(0)).toBe(0) // reservado
    expect(ico!.readUInt16LE(2)).toBe(1) // tipo ícone
    expect(ico!.readUInt16LE(4)).toBe(1) // uma imagem
    expect(ico!.readUInt8(6)).toBe(16) // largura
    expect(ico!.readUInt8(7)).toBe(16) // altura
    expect(ico!.readUInt16LE(10)).toBe(1) // planos
    expect(ico!.readUInt16LE(12)).toBe(32) // bits por pixel
    expect(ico!.readUInt32LE(14)).toBe(iconBytes.length)
    expect(ico!.readUInt32LE(18)).toBe(22) // offset dos dados (após o header)
    expect(ico!.subarray(22).equals(iconBytes)).toBe(true)
  })

  it('retorna null para arquivo que não é PE', () => {
    writeFileSync(exePath, 'não é um executável')
    expect(readExeIconIco(exePath)).toBeNull()
  })

  it('retorna null para caminho inexistente', () => {
    expect(readExeIconIco(join(tempDir, 'nao-existe.exe'))).toBeNull()
  })

  it('retorna null quando o PE não declara recursos', () => {
    const pe = buildPeWithIcon(Buffer.from('ICON'))
    pe.writeUInt32LE(0, 0x84 + 20 + 96 + 16) // resourceRva = 0
    writeFileSync(exePath, pe)
    expect(readExeIconIco(exePath)).toBeNull()
  })
})
