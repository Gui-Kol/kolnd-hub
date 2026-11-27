import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { logger, redactForLevel, setLogPathForTests } from '../logger'

/**
 * Auditoria de logs e redação (task 13/T4).
 *
 * Garante que chave, caminho pessoal e transcrição não chegam ao arquivo em
 * `info+`, que `debug` só aparece com `ABSOLEM_LOG_LEVEL=debug` e que nenhum
 * módulo do main usa `console.*` fora do logger.
 */

const SECRET = 'AIzaSyTesteDeRedacaoComTamanhoSuficiente123'
const TRANSCRIPT = 'eu moro na rua das flores e meu telefone e 99999-0000'
const USER_PATH = 'C:\\Users\\joao.silva\\Documents\\projeto\\segredo.txt'

const ROOT = join(process.cwd(), 'src', 'main')

function listMainSources(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...listMainSources(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

describe('redação de logs', () => {
  let dir: string
  let logPath: string
  let previousLevel: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'absolem-redaction-'))
    logPath = join(dir, 'absolem.log')
    setLogPathForTests(logPath)
    previousLevel = process.env.ABSOLEM_LOG_LEVEL
    process.env.ABSOLEM_LOG_LEVEL = 'info'
  })

  afterEach(() => {
    setLogPathForTests(null)
    if (previousLevel === undefined) delete process.env.ABSOLEM_LOG_LEVEL
    else process.env.ABSOLEM_LOG_LEVEL = previousLevel
    rmSync(dir, { recursive: true, force: true })
  })

  it('chave é redigida em info', () => {
    const text = redactForLevel('info', `api_key=${SECRET}`)
    expect(text).not.toContain(SECRET)
    expect(text).toContain('api_key=[redigido]')
  })

  it('caminho de usuário é mascarado em info', () => {
    const text = redactForLevel('info', `falha ao abrir ${USER_PATH}`)
    expect(text).not.toContain('joao.silva')
    expect(text).toContain('C:\\Users\\[usuario]')
  })

  it('transcrição não aparece em info', () => {
    const text = redactForLevel('info', `transcricao: "${TRANSCRIPT}"`)
    expect(text).not.toContain(TRANSCRIPT)
    expect(text).toContain('transcricao: [redigido]')
  })

  it('debug só aparece com flag explícita e continua redigido', () => {
    expect(redactForLevel('debug', `api_key=${SECRET}`)).toBe('api_key=[redigido]')

    logger.debug('teste', `api_key=${SECRET}`)
    expect(existsSync(logPath)).toBe(false)

    process.env.ABSOLEM_LOG_LEVEL = 'debug'
    logger.debug('teste', `api_key=${SECRET}`)
    expect(readFileSync(logPath, 'utf8')).not.toContain(SECRET)
  })

  it('logger em info grava sem segredo, caminho pessoal ou transcrição', () => {
    logger.info('teste', `api_key=${SECRET} caminho=${USER_PATH} transcricao: "${TRANSCRIPT}"`)
    const text = readFileSync(logPath, 'utf8')
    expect(text).toContain('[redigido]')
    expect(text).toContain('[usuario]')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('joao.silva')
    expect(text).not.toContain(TRANSCRIPT)
  })

  it('nenhum console.* no main fora do logger', () => {
    const problems: string[] = []
    for (const file of listMainSources(ROOT)) {
      const name = relative(ROOT, file).replace(/\\/g, '/')
      if (name === 'logger.ts' || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      const text = readFileSync(file, 'utf8')
      if (/console\s*\./.test(text)) problems.push(name)
    }
    expect(problems).toEqual([])
  })
})
