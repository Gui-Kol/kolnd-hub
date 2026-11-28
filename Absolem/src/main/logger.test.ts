import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.dir }
}))

import { logger, redactForLevel, rotateIfNeeded, setLogPathForTests } from './logger'

const SECRET = 'super-secret-value'

beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'absolem-logger-'))
  setLogPathForTests(null)
})

afterEach(() => {
  setLogPathForTests(null)
  rmSync(state.dir, { recursive: true, force: true })
})

describe('logger do main', () => {
  it('redige api_key em info', () => {
    const logPath = join(state.dir, 'absolem.log')
    setLogPathForTests(logPath)

    logger.info('teste', `api_key=${SECRET}`)
    logger.info('teste', `authorization: Bearer ${SECRET}`)

    const written = readFileSync(logPath, 'utf8')
    expect(written).not.toContain(SECRET)
    expect(written).toContain('[redigido]')
    expect(redactForLevel('info', `api_key=${SECRET}`)).toBe('api_key=[redigido]')
  })

  it('também redige em debug', () => {
    const text = `api_key=${SECRET}`
    expect(redactForLevel('debug', text)).toBe('api_key=[redigido]')
    expect(redactForLevel('debug', 'https://privado.example/a?token=x')).toBe('[redigido]')
  })

  it('rotaciona ao passar do limite', () => {
    const logPath = join(state.dir, 'absolem.log')
    writeFileSync(logPath, 'x'.repeat(2048), 'utf8')

    rotateIfNeeded(logPath, 1024, 2)

    expect(existsSync(logPath)).toBe(false)
    expect(existsSync(join(state.dir, 'absolem.1.log'))).toBe(true)

    writeFileSync(logPath, 'y'.repeat(2048), 'utf8')
    rotateIfNeeded(logPath, 1024, 2)

    expect(existsSync(join(state.dir, 'absolem.1.log'))).toBe(true)
    expect(existsSync(join(state.dir, 'absolem.2.log'))).toBe(true)
    expect(readFileSync(join(state.dir, 'absolem.1.log'), 'utf8')).toBe('y'.repeat(2048))
  })

  it('falha de escrita não lança', () => {
    // O caminho de log fica "dentro" de um arquivo comum: mkdirSync falha.
    const blocker = join(state.dir, 'bloqueador')
    writeFileSync(blocker, 'nao sou diretorio', 'utf8')
    setLogPathForTests(join(blocker, 'logs', 'absolem.log'))

    expect(() => logger.info('teste', 'mensagem')).not.toThrow()
    expect(() => logger.error('teste', 'mensagem de erro')).not.toThrow()
  })
})
