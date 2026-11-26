import {
  MEMORY_CONTENT_MAX,
  MEMORY_MIN_CONFIDENCE,
  MEMORY_TEMPORARY_TTL_MS,
  isMemoryKind,
  type MemoryKind,
  type MemoryRecord,
  type MemoryTurn
} from '../../shared/memory'
import { logger as defaultLogger } from '../logger'
import { normalizeTags, type MemoryRepository } from './repository'
import { isDuplicateContent } from './similarity'

/**
 * Extração automática de memórias ao fim da conversa e a cada 6 turnos.
 *
 * Regras (task 09/T3):
 * - no máximo 5 candidatos por rodada;
 * - confiança mínima 0.6;
 * - conteúdo de até 400 caracteres;
 * - candidato com aparência de chave, senha, token ou cartão é descartado com
 *   log `candidato sensivel descartado` (sem o valor);
 * - duplicata (trigramas > 0.85) atualiza a memória existente;
 * - `temporary` expira em 7 dias; os demais tipos são permanentes;
 * - turno `interrupted` nunca entra na transcrição da extração.
 */

export const MAX_EXTRACTION_CANDIDATES = 5

export interface ExtractionCandidate {
  kind: MemoryKind
  content: string
  tags: string[]
  confidence: number
  expiresAt: number | null
}

export interface ExtractionParseResult {
  candidates: ExtractionCandidate[]
  droppedLowConfidence: number
  droppedSensitive: number
  droppedInvalid: number
}

export interface ExtractionLogger {
  debug: (scope: string, message: unknown, ...args: unknown[]) => void
  info: (scope: string, message: unknown, ...args: unknown[]) => void
  warn: (scope: string, message: unknown, ...args: unknown[]) => void
}

export const EXTRACTION_SENSITIVE_LOG = 'candidato sensivel descartado'

/** Schema enviado ao Gemini (JSON estruturado). */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      maxItems: MAX_EXTRACTION_CANDIDATES,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['fact', 'preference', 'profile', 'temporary'] },
          content: { type: 'string', maxLength: MEMORY_CONTENT_MAX },
          tags: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 30 } },
          confidence: { type: 'number' }
        },
        required: ['kind', 'content', 'confidence']
      }
    }
  },
  required: ['memories']
}

export const EXTRACTION_SYSTEM_INSTRUCTION = [
  'Você extrai memórias duráveis de uma conversa entre o usuário e o Absolem.',
  'Só registre informação que o usuário afirmou sobre si, suas preferências, seu perfil ou um lembrete temporário.',
  'Não registre perguntas, opiniões do assistente, conteúdo de tela, arquivos ou instruções genéricas.',
  'Nunca registre senhas, chaves, tokens, números de cartão ou outros segredos.',
  'Cada memória deve ser uma frase curta e autossuficiente, com no máximo 400 caracteres.',
  'Use kind=fact para fatos, preference para preferências, profile para traços duradouros e temporary para algo que expira.',
  'Confiança entre 0 e 1; use abaixo de 0.6 quando houver dúvida.',
  'Responda apenas no JSON do schema, com no máximo 5 memórias.'
].join('\n')

const API_KEY_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/i,
  /\b(?:senha|password|passwd|pwd|token|api[\s_-]?key|secret|chave)\s*[:=]\s*\S{4,}/i
]

function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}

function passesLuhn(digits: string): boolean {
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function looksLikeCardNumber(text: string): boolean {
  const candidates = text.match(/\d(?:[ -]?\d){12,18}/g) ?? []
  for (const candidate of candidates) {
    const digits = digitsOf(candidate)
    if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits)) return true
  }
  return false
}

/** Heurística local de credencial; nunca devolve o valor encontrado. */
export function containsSensitiveContent(text: string): boolean {
  if (typeof text !== 'string' || !text) return false
  return API_KEY_PATTERNS.some((pattern) => pattern.test(text)) || looksLikeCardNumber(text)
}

function readRawCandidates(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```$/i, '')
      .trim()
    try {
      return readRawCandidates(JSON.parse(text) as unknown)
    } catch {
      return []
    }
  }
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    for (const key of ['memories', 'candidates', 'items']) {
      if (Array.isArray(record[key])) return record[key]
    }
  }
  return []
}

function sanitizeTags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  try {
    return normalizeTags(value)
  } catch {
    if (!Array.isArray(value)) return []
    const tags: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
      if (typeof item !== 'string') continue
      const tag = item.trim().slice(0, 30)
      if (!tag) continue
      const key = tag.toLocaleLowerCase('pt-BR')
      if (seen.has(key)) continue
      seen.add(key)
      tags.push(tag)
      if (tags.length >= 8) break
    }
    return tags
  }
}

/**
 * Valida e filtra a resposta do modelo. Nunca lança: resposta inválida vira
 * lista vazia e é contada em `droppedInvalid`.
 */
export function parseExtractionResponse(
  raw: unknown,
  options: { now?: number; logger?: ExtractionLogger } = {}
): ExtractionParseResult {
  const now =
    typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const log = options.logger ?? defaultLogger
  const items = readRawCandidates(raw)
  const parsed: ExtractionParseResult = {
    candidates: [],
    droppedLowConfidence: 0,
    droppedSensitive: 0,
    droppedInvalid: 0
  }

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      parsed.droppedInvalid += 1
      continue
    }
    const record = item as Record<string, unknown>
    if (!isMemoryKind(record.kind)) {
      parsed.droppedInvalid += 1
      continue
    }
    if (typeof record.content !== 'string' || !record.content.trim()) {
      parsed.droppedInvalid += 1
      continue
    }
    if (
      typeof record.confidence !== 'number' ||
      !Number.isFinite(record.confidence) ||
      record.confidence < 0 ||
      record.confidence > 1
    ) {
      parsed.droppedInvalid += 1
      continue
    }

    const fullContent = record.content.trim()
    if (containsSensitiveContent(fullContent)) {
      parsed.droppedSensitive += 1
      log.warn('memory', EXTRACTION_SENSITIVE_LOG)
      continue
    }
    if (record.confidence < MEMORY_MIN_CONFIDENCE) {
      parsed.droppedLowConfidence += 1
      continue
    }

    const content = fullContent.slice(0, MEMORY_CONTENT_MAX).trim()
    if (!content) {
      parsed.droppedInvalid += 1
      continue
    }
    parsed.candidates.push({
      kind: record.kind,
      content,
      tags: sanitizeTags(record.tags),
      confidence: Math.min(1, Math.max(MEMORY_MIN_CONFIDENCE, record.confidence)),
      expiresAt: record.kind === 'temporary' ? now + MEMORY_TEMPORARY_TTL_MS : null
    })
    if (parsed.candidates.length >= MAX_EXTRACTION_CANDIDATES) break
  }

  return parsed
}

export interface ExtractionGeneratorRequest {
  system: string
  prompt: string
  schema: Record<string, unknown>
}

export type ExtractionGeneratorResult = { ok: true; text: string } | { ok: false; error: string }

export type ExtractionGenerator = (
  request: ExtractionGeneratorRequest
) => Promise<ExtractionGeneratorResult>

export interface ExtractionReport {
  ok: boolean
  skipped: boolean
  candidates: number
  inserted: number
  updated: number
  droppedLowConfidence: number
  droppedSensitive: number
  error?: string
}

export function buildExtractionPrompt(turns: MemoryTurn[], maxChars = 12_000): string {
  const usable = turns.filter((turn) => !turn.interrupted).slice(-40)
  const lines: string[] = []
  for (const turn of usable) {
    const speaker = turn.role === 'user' ? 'Usuário' : 'Absolem'
    lines.push(`${speaker}: ${turn.content}`)
  }
  let transcript = lines.join('\n')
  if (transcript.length > maxChars) transcript = transcript.slice(-maxChars)
  return `TRANSCRIÇÃO:\n${transcript}`
}

function mergeTags(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const tag of [...a, ...b]) {
    const key = tag.toLocaleLowerCase('pt-BR')
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(tag)
    if (merged.length >= 8) break
  }
  return merged
}

export interface RunExtractionOptions {
  repo: MemoryRepository
  turns: MemoryTurn[]
  generator: ExtractionGenerator
  now?: number
  logger?: ExtractionLogger
}

/**
 * Roda a extração e grava o que passou nas regras. Falha do modelo não altera
 * nenhuma memória; a resposta é aplicada só depois de validada.
 */
export async function runExtraction(options: RunExtractionOptions): Promise<ExtractionReport> {
  const log = options.logger ?? defaultLogger
  const now =
    typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const usableTurns = options.turns.filter((turn) => !turn.interrupted)
  const hasUser = usableTurns.some((turn) => turn.role === 'user')
  const report: ExtractionReport = {
    ok: true,
    skipped: false,
    candidates: 0,
    inserted: 0,
    updated: 0,
    droppedLowConfidence: 0,
    droppedSensitive: 0
  }

  if (!hasUser || usableTurns.length < 2) {
    report.skipped = true
    return report
  }

  let text: string
  try {
    const result = await options.generator({
      system: EXTRACTION_SYSTEM_INSTRUCTION,
      prompt: buildExtractionPrompt(usableTurns),
      schema: EXTRACTION_SCHEMA
    })
    if (!result.ok) {
      return { ...report, ok: false, error: result.error }
    }
    text = result.text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn('memory', 'extração falhou', message.slice(0, 200))
    return { ...report, ok: false, error: message }
  }

  const parsed = parseExtractionResponse(text, { now, logger: log })
  report.candidates = parsed.candidates.length
  report.droppedLowConfidence = parsed.droppedLowConfidence
  report.droppedSensitive = parsed.droppedSensitive

  const existing = options.repo.list({ limit: 500 }).memories
  const seen: MemoryRecord[] = []
  for (const candidate of parsed.candidates) {
    try {
      const duplicate = [...existing, ...seen].find(
        (memory) =>
          memory.kind === candidate.kind && isDuplicateContent(candidate.content, memory.content)
      )
      if (duplicate) {
        const updated = options.repo.update(duplicate.id, {
          kind: candidate.kind,
          content: candidate.content,
          tags: mergeTags(duplicate.tags, candidate.tags),
          confidence: Math.max(duplicate.confidence, candidate.confidence),
          expiresAt: candidate.expiresAt
        })
        if (updated) {
          report.updated += 1
          const index = seen.findIndex((memory) => memory.id === updated.id)
          if (index >= 0) seen[index] = updated
        }
        continue
      }
      const created = options.repo.insert({
        kind: candidate.kind,
        content: candidate.content,
        tags: candidate.tags,
        confidence: candidate.confidence,
        source: 'extraction',
        expiresAt: candidate.expiresAt
      })
      seen.push(created)
      report.inserted += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('memory', 'candidato descartado na gravação', message.slice(0, 200))
    }
  }

  log.info('memory', 'extração concluída', {
    candidates: report.candidates,
    inserted: report.inserted,
    updated: report.updated,
    droppedSensitive: report.droppedSensitive,
    droppedLowConfidence: report.droppedLowConfidence
  })
  return report
}
