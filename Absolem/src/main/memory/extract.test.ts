import { describe, expect, it, vi } from 'vitest'
import { MEMORY_TEMPORARY_TTL_MS, type MemoryTurn } from '../../shared/memory'
import {
  runExtraction,
  type ExtractionGenerator,
  type ExtractionLogger,
  type ExtractionReport
} from './extract'
import { createMemoryRepository, type MemoryRepository } from './repository'
import { createTestMemoryDatabase } from './testing/tempDatabase'

function setup(): { repo: MemoryRepository; cleanup: () => void } {
  const db = createTestMemoryDatabase()
  return { repo: createMemoryRepository(db.database.handle), cleanup: db.cleanup }
}

function turns(): MemoryTurn[] {
  return [
    { id: 1, sessionId: 's1', role: 'user', content: 'Eu prefiro café', at: 1, interrupted: false },
    { id: 2, sessionId: 's1', role: 'model', content: 'Anotado.', at: 2, interrupted: false }
  ]
}

function generatorReturning(candidates: unknown[]): ExtractionGenerator {
  return async () => ({ ok: true, text: JSON.stringify({ memories: candidates }) })
}

async function extract(
  repo: MemoryRepository,
  generator: ExtractionGenerator,
  options: { now?: number; logger?: ExtractionLogger } = {}
): Promise<ExtractionReport> {
  return runExtraction({
    repo,
    turns: turns(),
    generator,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.logger === undefined ? {} : { logger: options.logger })
  })
}

describe('extração de memórias', () => {
  it('máximo 5 por extração', async () => {
    const { repo, cleanup } = setup()
    try {
      const contents = [
        'Trabalha como designer de produto',
        'Mora em Curitiba com dois gatos',
        'Estuda japonês nas terças',
        'Prefere reuniões pela manhã',
        'Usa Windows 11 no notebook',
        'Gosta de corrida no parque',
        'Evita açúcar no café'
      ]
      const candidates = contents.map((content) => ({
        kind: 'fact',
        content,
        confidence: 0.9
      }))
      const report = await extract(repo, generatorReturning(candidates))

      expect(report.ok).toBe(true)
      expect(report.inserted).toBe(5)
      expect(repo.list({ limit: 500 }).total).toBe(5)
    } finally {
      cleanup()
    }
  })

  it('confiança baixa é descartada', async () => {
    const { repo, cleanup } = setup()
    try {
      const report = await extract(
        repo,
        generatorReturning([
          { kind: 'fact', content: 'Talvez eu goste de chá', confidence: 0.5 },
          { kind: 'fact', content: 'Gosto de chá verde', confidence: 0.9 }
        ])
      )

      expect(report.droppedLowConfidence).toBe(1)
      expect(report.inserted).toBe(1)
      expect(repo.list().memories.map((memory) => memory.content)).toEqual(['Gosto de chá verde'])
    } finally {
      cleanup()
    }
  })

  it('credencial não é gravada', async () => {
    const { repo, cleanup } = setup()
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    try {
      const report = await extract(
        repo,
        generatorReturning([
          {
            kind: 'fact',
            content: 'Minha chave é sk-abcdefghijklmnopqrstuvwx',
            confidence: 0.95
          }
        ]),
        { logger }
      )

      expect(report.droppedSensitive).toBe(1)
      expect(repo.list().total).toBe(0)
      expect(logger.warn).toHaveBeenCalledWith('memory', 'candidato sensivel descartado')
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-abcdefghijklmnopqrstuvwx')
    } finally {
      cleanup()
    }
  })

  it('duplicata atualiza em vez de inserir', async () => {
    const { repo, cleanup } = setup()
    try {
      const existing = repo.insert({
        kind: 'preference',
        content: 'Prefere café sem açúcar',
        confidence: 0.7
      })
      const report = await extract(
        repo,
        generatorReturning([
          { kind: 'preference', content: 'Prefere cafe sem acucar', confidence: 0.9 }
        ])
      )

      expect(report.inserted).toBe(0)
      expect(report.updated).toBe(1)
      expect(repo.list().total).toBe(1)
      const updated = repo.get(existing.id)
      expect(updated?.content).toBe('Prefere cafe sem acucar')
      expect(updated?.confidence).toBe(0.9)
    } finally {
      cleanup()
    }
  })

  it('temporary ganha expiração', async () => {
    const { repo, cleanup } = setup()
    const now = Date.now()
    try {
      const report = await extract(
        repo,
        generatorReturning([
          { kind: 'temporary', content: 'Lembrar de comprar leite', confidence: 0.9 }
        ]),
        { now }
      )

      expect(report.inserted).toBe(1)
      const memory = repo.list().memories[0]
      expect(memory?.kind).toBe('temporary')
      expect(memory?.expiresAt).toBe(now + MEMORY_TEMPORARY_TTL_MS)
    } finally {
      cleanup()
    }
  })
})
