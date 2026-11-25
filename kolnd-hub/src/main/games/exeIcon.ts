import { closeSync, openSync, readSync } from 'fs'

/**
 * Extração do ícone embutido em um `.exe` diretamente dos recursos PE
 * (`RT_GROUP_ICON` + `RT_ICON`) — o mesmo ícone que o Windows carrega para a
 * barra de tarefas e para a bandeja.
 *
 * `app.getFileIcon` (SHGetFileInfo) devolve o ícone genérico de arquivo para
 * alguns executáveis quando o grupo de ícones não tem a resolução pedida pelo
 * DPI atual (ex.: o .exe do Lossless Scaling só tem 32×32). Ler o grupo de
 * ícones resolve isso e ainda entrega todas as resoluções disponíveis.
 */

const RT_ICON = 3
const RT_GROUP_ICON = 14
const SECTION_HEADER_SIZE = 40
/** Cabeçalho do arquivo lido para achar a seção de recursos (folga p/ muitos headers). */
const HEADER_READ_BYTES = 0x2000
/** Seções de recursos são pequenas; acima disso o arquivo não parece um PE normal. */
const MAX_RESOURCE_BYTES = 64 * 1024 * 1024
/** Um recurso de ícone individual jamais chega perto disso. */
const MAX_ICON_BYTES = 4 * 1024 * 1024

interface PeSection {
  virtualAddress: number
  virtualSize: number
  rawPointer: number
  rawSize: number
}

export interface PeHeaders {
  sections: PeSection[]
  /** RVA da tabela de recursos (0 quando o PE não tem recursos). */
  resourceRva: number
  resourceSize: number
}

interface ResourceEntry {
  id: number
  isNamed: boolean
  /** Offset relativo ao início do diretório de recursos (quando `isDir`). */
  offset: number
  isDir: boolean
}

interface ResourceData {
  id: number
  rva: number
  size: number
}

interface GroupIconEntry {
  width: number
  height: number
  colorCount: number
  planes: number
  bitCount: number
  bytesInRes: number
  id: number
}

interface IcoImage {
  width: number
  height: number
  colorCount: number
  planes: number
  bitCount: number
  data: Buffer
}

/** Lê até `length` bytes na posição — null quando não há nada para ler. */
function readAt(fd: number, position: number, length: number): Buffer | null {
  if (length <= 0) return Buffer.alloc(0)
  const buffer = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const chunk = readSync(fd, buffer, read, length - read, position + read)
    if (chunk <= 0) break
    read += chunk
  }
  // Arquivos menores que o pedido (ex.: PE mínimo) devolvem o que existe.
  return read > 0 ? buffer.subarray(0, read) : null
}

/**
 * Interpreta DOS/COFF/optional headers + tabela de seções.
 * Exportada para testes; nunca lança (retorna null em qualquer inconsistência).
 */
export function parsePeHeaders(header: Buffer): PeHeaders | null {
  try {
    if (header.length < 0x40) return null
    if (header.readUInt16LE(0) !== 0x5a4d) return null // "MZ"
    const peOffset = header.readUInt32LE(0x3c)
    if (peOffset + 24 > header.length) return null
    if (header.readUInt32LE(peOffset) !== 0x00004550) return null // "PE\0\0"

    const coff = peOffset + 4
    const sectionCount = header.readUInt16LE(coff + 2)
    const optionalSize = header.readUInt16LE(coff + 16)
    const optional = coff + 20
    if (optional + 2 > header.length) return null

    const magic = header.readUInt16LE(optional)
    if (magic !== 0x10b && magic !== 0x20b) return null // PE32 / PE32+
    const is64 = magic === 0x20b
    const dirCountOffset = optional + (is64 ? 108 : 92)
    const dataDirStart = optional + (is64 ? 112 : 96)
    if (dirCountOffset + 4 > header.length) return null
    const dirCount = header.readUInt32LE(dirCountOffset)

    const sectionTable = optional + optionalSize
    if (sectionTable + sectionCount * SECTION_HEADER_SIZE > header.length) return null
    const sections: PeSection[] = []
    for (let i = 0; i < sectionCount; i++) {
      const offset = sectionTable + i * SECTION_HEADER_SIZE
      sections.push({
        virtualSize: header.readUInt32LE(offset + 8),
        virtualAddress: header.readUInt32LE(offset + 12),
        rawSize: header.readUInt32LE(offset + 16),
        rawPointer: header.readUInt32LE(offset + 20)
      })
    }

    let resourceRva = 0
    let resourceSize = 0
    // Índice 2 = tabela de recursos nas Data Directories do optional header.
    if (dirCount > 2 && dataDirStart + 24 <= header.length) {
      resourceRva = header.readUInt32LE(dataDirStart + 16)
      resourceSize = header.readUInt32LE(dataDirStart + 20)
    }
    return { sections, resourceRva, resourceSize }
  } catch {
    return null
  }
}

/** Entradas de um IMAGE_RESOURCE_DIRECTORY. `dirBase` é relativo à seção. */
function readDirectoryEntries(
  data: Buffer,
  dirBase: number,
  dirOffset: number
): ResourceEntry[] | null {
  try {
    const base = dirBase + dirOffset
    const named = data.readUInt16LE(base + 12)
    const ids = data.readUInt16LE(base + 14)
    const count = named + ids
    const entries: ResourceEntry[] = []
    for (let i = 0; i < count; i++) {
      const offset = base + 16 + i * 8
      const name = data.readUInt32LE(offset)
      const target = data.readUInt32LE(offset + 4)
      entries.push({
        id: name & 0x7fffffff,
        isNamed: (name & 0x80000000) !== 0,
        offset: target & 0x7fffffff,
        isDir: (target & 0x80000000) !== 0
      })
    }
    return entries
  } catch {
    return null
  }
}

/** Coleta os blocos de dados de um tipo de recurso (grupo de ícones ou ícones). */
function collectResourceData(
  data: Buffer,
  dirBase: number,
  sectionBase: number,
  type: number
): ResourceData[] {
  const out: ResourceData[] = []
  const types = readDirectoryEntries(data, dirBase, 0)
  if (!types) return out
  for (const typeEntry of types) {
    if (typeEntry.isNamed || typeEntry.id !== type || !typeEntry.isDir) continue
    const names = readDirectoryEntries(data, dirBase, typeEntry.offset)
    if (!names) continue
    for (const nameEntry of names) {
      if (!nameEntry.isDir) continue
      const languages = readDirectoryEntries(data, dirBase, nameEntry.offset)
      if (!languages) continue
      for (const languageEntry of languages) {
        if (languageEntry.isDir) continue
        const dataEntryOffset = dirBase + languageEntry.offset
        if (dataEntryOffset + 16 > data.length) continue
        const rva = data.readUInt32LE(dataEntryOffset)
        const size = data.readUInt32LE(dataEntryOffset + 4)
        if (!rva || size <= 0 || size > MAX_ICON_BYTES) continue
        const start = rva - sectionBase
        if (start < 0 || start + size > data.length) continue
        out.push({ id: nameEntry.id, rva, size })
      }
    }
  }
  return out
}

/** Interpreta o GRPICONDIR de um recurso RT_GROUP_ICON. */
function parseGroupIcon(data: Buffer): GroupIconEntry[] | null {
  try {
    if (data.length < 6) return null
    if (data.readUInt16LE(0) !== 0) return null
    if (data.readUInt16LE(2) !== 1) return null
    const count = data.readUInt16LE(4)
    if (count < 1 || count > 64) return null
    const entries: GroupIconEntry[] = []
    for (let i = 0; i < count; i++) {
      const offset = 6 + i * 14
      if (offset + 14 > data.length) return null
      entries.push({
        width: data.readUInt8(offset),
        height: data.readUInt8(offset + 1),
        colorCount: data.readUInt8(offset + 2),
        planes: data.readUInt16LE(offset + 4),
        bitCount: data.readUInt16LE(offset + 6),
        bytesInRes: data.readUInt32LE(offset + 8),
        id: data.readUInt16LE(offset + 12)
      })
    }
    return entries
  } catch {
    return null
  }
}

/** Monta um .ico (todos os tamanhos disponíveis) a partir dos recursos RT_ICON. */
function buildIco(images: IcoImage[]): Buffer {
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0) // reservado
  header.writeUInt16LE(1, 2) // tipo: ícone
  header.writeUInt16LE(images.length, 4)
  let dataOffset = header.length
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    header.writeUInt8(image.width >= 256 ? 0 : image.width, entry)
    header.writeUInt8(image.height >= 256 ? 0 : image.height, entry + 1)
    header.writeUInt8(image.colorCount, entry + 2)
    header.writeUInt16LE(image.planes || 1, entry + 4)
    header.writeUInt16LE(image.bitCount, entry + 6)
    header.writeUInt32LE(image.data.length, entry + 8)
    header.writeUInt32LE(dataOffset, entry + 12)
    dataOffset += image.data.length
  })
  return Buffer.concat([header, ...images.map((image) => image.data)])
}

/**
 * Escolhe a maior imagem com largura/altura ≤ `maxSize` (0 já é 256 no ICO).
 * Se nenhuma couber, usa a menor disponível para não ficar sem ícone.
 * Função pura, exportada para testes.
 */
export function selectLargestIconImage<T extends { width: number; height: number }>(
  images: T[],
  maxSize = 256
): T | null {
  if (images.length === 0) return null
  const eligible = images.filter(
    (image) => image.width > 0 && image.width <= maxSize && image.height <= maxSize
  )
  if (eligible.length > 0) {
    return eligible.reduce((best, image) =>
      image.width * image.height > best.width * best.height ? image : best
    )
  }
  const usable = images.filter((image) => image.width > 0)
  if (usable.length === 0) return null
  // Nenhuma cabe no teto: devolve a menor disponível (ainda melhor que nada).
  return usable.reduce((best, image) =>
    image.width * image.height < best.width * best.height ? image : best
  )
}

/** Lê todos os RT_ICON do grupo de ícones do PE (null quando não há). */
function readIcoImages(exePath: string): IcoImage[] | null {
  let fd: number
  try {
    fd = openSync(exePath, 'r')
  } catch {
    return null
  }
  try {
    const header = readAt(fd, 0, HEADER_READ_BYTES)
    if (!header) return null
    const pe = parsePeHeaders(header)
    if (!pe || pe.resourceRva <= 0 || pe.resourceSize <= 0) return null

    const section = pe.sections.find(
      (candidate) =>
        pe.resourceRva >= candidate.virtualAddress &&
        pe.resourceRva <
          candidate.virtualAddress + Math.max(candidate.virtualSize, candidate.rawSize)
    )
    if (!section) return null
    const length = Math.min(section.rawSize, MAX_RESOURCE_BYTES)
    if (length <= 0) return null
    const resource = readAt(fd, section.rawPointer, length)
    if (!resource) return null

    const sectionBase = section.virtualAddress
    const dirBase = pe.resourceRva - sectionBase
    if (dirBase < 0 || dirBase >= resource.length) return null

    const groups = collectResourceData(resource, dirBase, sectionBase, RT_GROUP_ICON)
    if (groups.length === 0) return null
    const groupStart = groups[0].rva - sectionBase
    const groupData = resource.subarray(groupStart, groupStart + groups[0].size)
    const entries = parseGroupIcon(groupData)
    if (!entries) return null

    // Mapeia id → bytes do RT_ICON (cada tamanho do ícone).
    const icons = collectResourceData(resource, dirBase, sectionBase, RT_ICON)
    const iconData = new Map<number, Buffer>()
    for (const icon of icons) {
      if (iconData.has(icon.id)) continue
      const start = icon.rva - sectionBase
      iconData.set(icon.id, resource.subarray(start, start + icon.size))
    }

    const images: IcoImage[] = []
    for (const entry of entries) {
      const data = iconData.get(entry.id)
      if (!data || data.length === 0) continue
      images.push({
        width: entry.width === 0 ? 256 : entry.width,
        height: entry.height === 0 ? 256 : entry.height,
        colorCount: entry.colorCount,
        planes: entry.planes,
        bitCount: entry.bitCount,
        data
      })
    }
    return images.length > 0 ? images : null
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {
      // fd já inválido — nada a fazer.
    }
  }
}

/**
 * Lê o ícone embutido do `.exe` e devolve um .ico pronto para o `nativeImage`.
 * Retorna null quando o arquivo não é um PE válido ou não tem grupo de ícones.
 */
export function readExeIconIco(exePath: string): Buffer | null {
  const images = readIcoImages(exePath)
  return images ? buildIco(images) : null
}

/**
 * Como `readExeIconIco`, mas devolve só a maior imagem ≤ `maxSize` (padrão
 * 256). Ícones com tamanho exato 0 no ICO representam 256×256.
 */
export function readExeIconIcoSized(exePath: string, maxSize = 256): Buffer | null {
  const images = readIcoImages(exePath)
  const chosen = images ? selectLargestIconImage(images, maxSize) : null
  return chosen ? buildIco([chosen]) : null
}
