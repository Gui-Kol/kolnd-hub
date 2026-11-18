import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {}
}))

import { formatLogLine, logger, redactForLevel, rotateIfNeeded, setLogPathForTests } from './logger'

const LINE_RE =
  /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[(DEBUG|INFO|WARN|ERROR)\] \[[^\]]+\] .+$/m

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kolnd-hub-logs-'))
  // Silencia o espelho de console (o logger sempre espelha; o disco é o que testamos).
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setLogPathForTests(null)
  delete process.env.KOLND_HUB_LOG_LEVEL
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('formatLogLine', () => {
  it('formata [ISO] [NÍVEL] [escopo] mensagem', () => {
    const line = formatLogLine(
      'info',
      'games',
      'Jogo iniciado',
      new Date('2026-11-13T12:34:56.789Z')
    )
    expect(line).toBe('[2026-11-13T12:34:56.789Z] [INFO] [games] Jogo iniciado')
    expect(line).toMatch(LINE_RE)
  })

  it('coloca o nível em maiúsculas', () => {
    expect(formatLogLine('warn', 'store', 'aviso')).toContain('[WARN]')
    expect(formatLogLine('error', 'store', 'falha')).toContain('[ERROR]')
  })
})

describe('rotateIfNeeded', () => {
  it('não rotaciona abaixo do limite', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    writeFileSync(logPath, 'x'.repeat(99))
    rotateIfNeeded(logPath, 100)
    expect(readFileSync(logPath, 'utf8')).toBe('x'.repeat(99))
    expect(statSync(logPath).size).toBe(99)
  })

  it('rotaciona exatamente no limite', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    writeFileSync(logPath, 'y'.repeat(100))
    rotateIfNeeded(logPath, 100)
    expect(readdirSync(dir).sort()).toEqual(['kolnd-hub.1.log'])
    expect(readFileSync(join(dir, 'kolnd-hub.1.log'), 'utf8')).toBe('y'.repeat(100))
  })

  it('mantém no máximo 3 arquivos (.log, .1, .2) e descarta o mais antigo', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    writeFileSync(logPath, 'atual')
    writeFileSync(join(dir, 'kolnd-hub.1.log'), 'anterior-1')
    writeFileSync(join(dir, 'kolnd-hub.2.log'), 'anterior-2')
    rotateIfNeeded(logPath, 1)
    expect(readdirSync(dir).sort()).toEqual(['kolnd-hub.1.log', 'kolnd-hub.2.log'])
    expect(readFileSync(join(dir, 'kolnd-hub.1.log'), 'utf8')).toBe('atual')
    expect(readFileSync(join(dir, 'kolnd-hub.2.log'), 'utf8')).toBe('anterior-1')
  })

  it('ignora arquivo de log inexistente', () => {
    expect(() => rotateIfNeeded(join(dir, 'nao-existe.log'), 0)).not.toThrow()
  })
})

describe('logger (escrita em arquivo)', () => {
  it('cria a pasta logs/ recursivamente e grava a linha no formato spec', () => {
    const logPath = join(dir, 'logs', 'kolnd-hub.log')
    setLogPathForTests(logPath)
    logger.info('games', 'Jogo iniciado: teste (id-1)')
    const content = readFileSync(logPath, 'utf8')
    expect(content).toMatch(LINE_RE)
    expect(content).toContain('[INFO] [games] Jogo iniciado: teste (id-1)')
  })

  it('serializa Error com stack em linhas indentadas', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    setLogPathForTests(logPath)
    logger.warn('store', 'Falha ao ler config.json:', new Error('arquivo corrompido'))
    const content = readFileSync(logPath, 'utf8')
    expect(content).toContain('Falha ao ler config.json:')
    expect(content).toContain('Error: arquivo corrompido')
    expect(content).toMatch(/\n {4}/)
  })

  it('suprime debug por padrão e libera com KOLND_HUB_LOG_LEVEL=debug', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    setLogPathForTests(logPath)
    logger.debug('processManager', 'comando completo: secreto.exe /p abc')
    expect(() => readFileSync(logPath, 'utf8')).toThrow()
    process.env.KOLND_HUB_LOG_LEVEL = 'debug'
    logger.debug('processManager', 'comando completo: secreto.exe /p abc')
    expect(readFileSync(logPath, 'utf8')).toContain('secreto.exe')
  })

  it('não vaza comando completo em info (redação)', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    setLogPathForTests(logPath)
    logger.info(
      'processManager',
      'launch via shell:true command="segredo.exe /p senha-ultra-secreta"'
    )
    const content = readFileSync(logPath, 'utf8')
    expect(content).not.toContain('segredo.exe')
    expect(content).not.toContain('senha-ultra-secreta')
    expect(content).toContain('[redigido]')
  })

  it('falha de disco não derruba o app: degrada para console e não lança', () => {
    // Força o mkdirSync a falhar: caminho com um ARQUIVO no meio.
    const blocker = join(dir, 'bloco')
    writeFileSync(blocker, 'não é pasta')
    setLogPathForTests(join(blocker, 'sub', 'kolnd-hub.log'))
    expect(() => logger.error('games', 'algo falhou')).not.toThrow()
    expect(console.error).toHaveBeenCalled()
  })

  it('mantém no máximo 3 arquivos (.log + .1 + .2) mesmo com rotações sucessivas', () => {
    const logPath = join(dir, 'kolnd-hub.log')
    for (let i = 0; i < 5; i += 1) {
      writeFileSync(logPath, `conteúdo-${i}`)
      rotateIfNeeded(logPath, 1)
    }
    const files = readdirSync(dir).sort()
    expect(files.length).toBeLessThanOrEqual(3)
    expect(files).toContain('kolnd-hub.1.log')
    expect(files).toContain('kolnd-hub.2.log')
    expect(readFileSync(join(dir, 'kolnd-hub.1.log'), 'utf8')).toBe('conteúdo-4')
    expect(readFileSync(join(dir, 'kolnd-hub.2.log'), 'utf8')).toBe('conteúdo-3')
  })
})

describe('redactForLevel', () => {
  it('não mascara nada em debug', () => {
    expect(redactForLevel('debug', 'command="a.exe /p x"')).toBe('command="a.exe /p x"')
  })

  it('mascara command=/argv= em info', () => {
    expect(redactForLevel('info', 'launch command="foo.exe --x 1" fim')).not.toContain('foo.exe')
    expect(redactForLevel('info', 'argv=["a.exe","--y"] ok')).not.toContain('a.exe')
  })

  it('mascara segredos key=value em warn', () => {
    expect(redactForLevel('warn', 'falhou token=abc123 aqui')).toBe('falhou token=[redigido] aqui')
  })

  it('preserva mensagens comuns sem comandos', () => {
    expect(redactForLevel('info', 'Jogo iniciado: Rafa (C:\\Games\\rafa.exe)')).toBe(
      'Jogo iniciado: Rafa (C:\\Games\\rafa.exe)'
    )
  })
})
