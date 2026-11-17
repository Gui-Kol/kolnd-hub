import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import * as os from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => join(os.tmpdir(), 'kolnd-hub-test') }
}))
vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('./winring0', () => ({
  probeWinRing0: vi.fn(async () => false)
}))

import {
  WINRING0_FILE_NAME,
  WINRING0_SERVICE_NAME,
  WINRING0_SHA256,
  buildInstallScript,
  buildUninstallScript,
  classifyDriverState,
  resolveDriverPaths,
  verifyDriverHash
} from './driver'

const TEMP_DIRS: string[] = []

afterEach(async () => {
  await Promise.all(TEMP_DIRS.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'kolnd-hub-test-'))
  TEMP_DIRS.push(dir)
  return dir
}

describe('resolveDriverPaths', () => {
  it('monta origem, pasta de instalação e destino em ProgramData', () => {
    const paths = resolveDriverPaths('C:\\App\\resources', 'C:\\ProgramData')
    expect(paths).toEqual({
      source: `C:\\App\\resources\\drivers\\${WINRING0_FILE_NAME}`,
      installDir: 'C:\\ProgramData\\Kolnd Hub\\drivers',
      installed: `C:\\ProgramData\\Kolnd Hub\\drivers\\${WINRING0_FILE_NAME}`
    })
  })
})

describe('classifyDriverState', () => {
  it('ready quando o device abriu', () => {
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: true })
    ).toBe('ready')
  })

  it('present quando há arquivo ou serviço, mas o device não abriu', () => {
    expect(
      classifyDriverState({ filePresent: true, serviceInstalled: false, deviceAccessible: false })
    ).toBe('present')
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: true, deviceAccessible: false })
    ).toBe('present')
  })

  it('absent sem arquivo, serviço ou device', () => {
    expect(
      classifyDriverState({ filePresent: false, serviceInstalled: false, deviceAccessible: false })
    ).toBe('absent')
  })
})

describe('buildInstallScript', () => {
  it('inclui hash pinado, cópia, criação e início do serviço', () => {
    const script = buildInstallScript({
      sourcePath: "C:\\Repo O'Brien\\resources\\drivers\\WinRing0x64.sys",
      targetPath: 'C:\\ProgramData\\Kolnd Hub\\drivers\\WinRing0x64.sys',
      installDir: 'C:\\ProgramData\\Kolnd Hub\\drivers'
    })
    expect(script).toContain(WINRING0_SHA256)
    expect(script).toContain(WINRING0_SERVICE_NAME)
    expect(script).toContain("C:\\Repo O''Brien")
    expect(script).toContain('Copy-Item -LiteralPath $source -Destination $target -Force')
    expect(script).toContain('& sc.exe create $service type= kernel')
    expect(script).toContain('& sc.exe start $service')
    // ASCII puro: o script é lido pelo PowerShell 5.1 sem BOM de origem.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(script)).toBe(false)
  })
})

describe('buildUninstallScript', () => {
  it('para e remove o serviço e o arquivo instalado', () => {
    const script = buildUninstallScript({
      targetPath: 'C:\\ProgramData\\Kolnd Hub\\drivers\\x.sys'
    })
    expect(script).toContain(WINRING0_SERVICE_NAME)
    expect(script).toContain('& sc.exe stop $service')
    expect(script).toContain('& sc.exe delete $service')
    expect(script).toContain('Remove-Item -LiteralPath $target')
  })
})

describe('verifyDriverHash', () => {
  it('aceita o hash correto sem diferenciar maiúsculas/minúsculas', async () => {
    const dir = await tempDir()
    const file = join(dir, 'driver.sys')
    const content = Buffer.from('conteudo de teste')
    await fs.writeFile(file, content)
    const expected = createHash('sha256').update(content).digest('hex')
    await expect(verifyDriverHash(file, expected.toUpperCase())).resolves.toBe(true)
    await expect(verifyDriverHash(file, expected.toLowerCase())).resolves.toBe(true)
  })

  it('recusa hash diferente e arquivo inexistente', async () => {
    const dir = await tempDir()
    const file = join(dir, 'driver.sys')
    await fs.writeFile(file, 'outro conteudo')
    await expect(verifyDriverHash(file, WINRING0_SHA256)).resolves.toBe(false)
    await expect(verifyDriverHash(join(dir, 'nao-existe.sys'), WINRING0_SHA256)).resolves.toBe(
      false
    )
  })
})
