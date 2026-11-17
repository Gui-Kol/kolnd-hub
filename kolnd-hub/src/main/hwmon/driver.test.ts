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
  describeDriverBlockers,
  explainInstallFailure,
  parseRegDword,
  readInstallFailure,
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
      installDir: 'C:\\ProgramData\\Kolnd Hub\\drivers',
      resultPath: "C:\\Temp O'Brien\\winring0-install.json"
    })
    expect(script).toContain(WINRING0_SHA256)
    expect(script).toContain(WINRING0_SERVICE_NAME)
    expect(script).toContain("C:\\Repo O''Brien")
    expect(script).toContain("C:\\Temp O''Brien")
    expect(script).toContain('Copy-Item -LiteralPath $source -Destination $target -Force')
    expect(script).toContain('& sc.exe create $service type= kernel')
    expect(script).toContain('& sc.exe start $service')
    // Cada etapa grava o código real: sem isso a UI só veria "código 1".
    expect(script).toContain("Save-Result 'hash' 1")
    expect(script).toContain("Save-Result 'create' $LASTEXITCODE")
    expect(script).toContain("Save-Result 'start' $LASTEXITCODE")
    expect(script).toContain("Save-Result 'ok' 0")
    // ASCII puro: o script é lido pelo PowerShell 5.1 sem BOM de origem.
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(script)).toBe(false)
  })
})

describe('parseRegDword', () => {
  it('lê o DWORD mesmo com a saída indentada e com CRLF', () => {
    const output =
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\CI\\Config\r\n    VulnerableDriverBlocklistEnable    REG_DWORD    0x1\r\n'
    expect(parseRegDword(output, 'VulnerableDriverBlocklistEnable')).toBe(1)
  })

  it('devolve null quando o valor não existe ou não é DWORD', () => {
    expect(parseRegDword('    Enabled    REG_SZ    0x1\r\n', 'Enabled')).toBeNull()
    expect(parseRegDword('    Outro    REG_DWORD    0x1\r\n', 'Enabled')).toBeNull()
  })
})

describe('describeDriverBlockers', () => {
  const base = { hvciEnabled: false, blocklistEnabled: false, smartAppControl: 'off' } as const

  it('explica a Memória Integrity sem pedir UAC', () => {
    const message = describeDriverBlockers({ ...base, hvciEnabled: true, blocklistEnabled: true })
    expect(message).toContain('Memória Integrity')
    expect(message).toContain('Isolamento do núcleo')
  })

  it('explica o Smart App Control bloqueando', () => {
    expect(describeDriverBlockers({ ...base, smartAppControl: 'enforcing' })).toContain(
      'Smart App Control'
    )
  })

  it('não bloqueia só porque a lista de drivers vulneráveis está ligada', () => {
    // A lista só é aplicada com HVCI/SAC/S mode — sem eles, a instalação tenta.
    expect(describeDriverBlockers({ ...base, blocklistEnabled: true })).toBeNull()
    expect(describeDriverBlockers({ ...base, smartAppControl: 'evaluation' })).toBeNull()
    // HVCI sem a lista pode deixar o WinRing0 carregar: tenta e deixa o `sc` decidir.
    expect(describeDriverBlockers({ ...base, hvciEnabled: true })).toBeNull()
  })
})

describe('explainInstallFailure', () => {
  it('reconhece assinatura recusada (577) e driver bloqueado (1275)', () => {
    for (const code of [577, 1275]) {
      const message = explainInstallFailure({ stage: 'start', code, detail: '' })
      expect(message).toContain('lista de drivers vulneráveis')
      expect(message).toContain('Memória Integrity')
    }
  })

  it('não repete o conselho de HVCI quando a falha é permissão (5)', () => {
    const message = explainInstallFailure({ stage: 'create', code: 5 })
    expect(message).toContain('negou permissão')
    expect(message).not.toContain('Memória Integrity')
  })

  it('trata serviço já existente/marcado para remoção', () => {
    expect(explainInstallFailure({ stage: 'create', code: 1073 })).toContain('Reinicie o PC')
    expect(explainInstallFailure({ stage: 'delete', code: 1072 })).toContain('Reinicie o PC')
  })

  it('mantém uma mensagem honesta quando não há detalhe', () => {
    const message = explainInstallFailure(null)
    expect(message).toContain('Memória Integrity')
    expect(message).toContain('lista de drivers vulneráveis')
  })
})

describe('readInstallFailure', () => {
  it('lê o JSON do script e ignora o BOM', async () => {
    const dir = await tempDir()
    const file = join(dir, 'result.json')
    await fs.writeFile(
      file,
      '\uFEFF' + JSON.stringify({ stage: 'start', code: 577, detail: 'erro' }),
      'utf8'
    )
    await expect(readInstallFailure(file)).resolves.toEqual({
      stage: 'start',
      code: 577,
      detail: 'erro'
    })
  })

  it('devolve null para arquivo ausente ou JSON inválido', async () => {
    const dir = await tempDir()
    await expect(readInstallFailure(join(dir, 'nao-existe.json'))).resolves.toBeNull()
    const file = join(dir, 'quebrado.json')
    await fs.writeFile(file, 'nao e json', 'utf8')
    await expect(readInstallFailure(file)).resolves.toBeNull()
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
