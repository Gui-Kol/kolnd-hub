/**
 * Contrato de ferramentas do Absolem (compartilhado main/renderer).
 *
 * O modelo nunca chama código: ele pede um `FunctionCall` com nome e argumentos
 * (entrada não confiável). O registro descreve e valida; o roteador decide,
 * confirma e executa.
 *
 * O validador é mínimo de propósito: sem dependência nova. Só os keywords
 * listados em `SUPPORTED_SCHEMA_KEYWORDS` são aceitos; schema fora do subset é
 * rejeitado no registro em vez de validado pela metade.
 */

export interface ToolDefinition {
  name: string
  description: string
  /** JSON Schema (subset suportado) dos argumentos. */
  parameters: Record<string, unknown>
  sensitive: boolean
  category: string
  timeoutMs: number
}

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/

export const SUPPORTED_SCHEMA_KEYWORDS = [
  'type',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'enum',
  'minimum',
  'maximum',
  'maxLength',
  'items',
  'minItems',
  'maxItems',
  'default'
] as const

const SUPPORTED_TYPES = new Set([
  'object',
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'null'
])

const MAX_SCHEMA_DEPTH = 10
const MAX_DESCRIPTION_LENGTH = 1_024
export const MIN_TOOL_TIMEOUT_MS = 100
export const MAX_TOOL_TIMEOUT_MS = 120_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** `[]` quando o schema inteiro está no subset suportado. */
export function validateSchema(schema: unknown, depth = 0): string[] {
  if (depth > MAX_SCHEMA_DEPTH) return ['schema profundo demais']
  if (!isRecord(schema)) return ['schema precisa ser um objeto']

  const errors: string[] = []
  for (const key of Object.keys(schema)) {
    if (!(SUPPORTED_SCHEMA_KEYWORDS as readonly string[]).includes(key)) {
      errors.push(`keyword não suportado: ${key}`)
    }
  }
  if (errors.length > 0) return errors

  const rawType = schema.type
  if (rawType === undefined) {
    errors.push('schema precisa declarar type')
    return errors
  }
  const types = Array.isArray(rawType) ? rawType : [rawType]
  for (const type of types) {
    if (typeof type !== 'string' || !SUPPORTED_TYPES.has(type)) {
      errors.push(`type não suportado: ${String(type)}`)
    }
  }
  if (errors.length > 0) return errors

  if (schema.description !== undefined && typeof schema.description !== 'string') {
    errors.push('description precisa ser string')
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
      errors.push('enum precisa ser lista não vazia')
    }
  }
  for (const bound of ['minimum', 'maximum'] as const) {
    if (schema[bound] !== undefined && typeof schema[bound] !== 'number') {
      errors.push(`${bound} precisa ser número`)
    }
  }
  if (schema.maxLength !== undefined && typeof schema.maxLength !== 'number') {
    errors.push('maxLength precisa ser número')
  }
  for (const bound of ['minItems', 'maxItems'] as const) {
    if (schema[bound] !== undefined && typeof schema[bound] !== 'number') {
      errors.push(`${bound} precisa ser número`)
    }
  }

  if (types.includes('object')) {
    const properties = schema.properties
    if (properties !== undefined && !isRecord(properties)) {
      errors.push('properties precisa ser objeto')
    } else if (isRecord(properties)) {
      for (const [name, value] of Object.entries(properties)) {
        for (const error of validateSchema(value, depth + 1)) {
          errors.push(`${name}.${error}`)
        }
      }
    }
    if (schema.required !== undefined) {
      if (
        !Array.isArray(schema.required) ||
        schema.required.some((name) => typeof name !== 'string')
      ) {
        errors.push('required precisa ser lista de nomes')
      } else if (isRecord(properties)) {
        for (const name of schema.required) {
          if (!(name in properties)) errors.push(`required desconhecido: ${name}`)
        }
      }
    }
    const additional = schema.additionalProperties
    if (additional !== undefined && typeof additional !== 'boolean') {
      if (!isRecord(additional)) errors.push('additionalProperties inválido')
      else for (const error of validateSchema(additional, depth + 1)) errors.push(error)
    }
  }

  if (types.includes('array')) {
    if (schema.items === undefined) {
      errors.push('array precisa de items')
    } else {
      for (const error of validateSchema(schema.items, depth + 1)) errors.push(error)
    }
  }

  return errors
}

/** Valida a definição inteira (nome, descrição, timeout, categoria, schema). */
export function validateToolDefinition(definition: unknown): string[] {
  if (!isRecord(definition)) return ['definição precisa ser objeto']
  const errors: string[] = []
  if (typeof definition.name !== 'string' || !TOOL_NAME_PATTERN.test(definition.name)) {
    errors.push('nome inválido (use letras minúsculas, dígitos e _; comece por letra)')
  }
  if (
    typeof definition.description !== 'string' ||
    definition.description.trim().length === 0 ||
    definition.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    errors.push('description inválida')
  }
  if (typeof definition.sensitive !== 'boolean') errors.push('sensitive precisa ser booleano')
  if (typeof definition.category !== 'string' || definition.category.trim().length === 0) {
    errors.push('category inválida')
  }
  if (
    typeof definition.timeoutMs !== 'number' ||
    !Number.isFinite(definition.timeoutMs) ||
    definition.timeoutMs < MIN_TOOL_TIMEOUT_MS ||
    definition.timeoutMs > MAX_TOOL_TIMEOUT_MS
  ) {
    errors.push(`timeoutMs fora da faixa ${MIN_TOOL_TIMEOUT_MS}..${MAX_TOOL_TIMEOUT_MS}`)
  }
  if (!isRecord(definition.parameters)) {
    errors.push('parameters precisa ser um schema objeto')
  } else {
    if (definition.parameters.type !== 'object') {
      errors.push('parameters.type precisa ser "object"')
    }
    errors.push(...validateSchema(definition.parameters))
  }
  return errors
}

export type ArgumentValidation =
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] }

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return false
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function validateValue(schema: Record<string, unknown>, value: unknown, path: string): string[] {
  const errors: string[] = []
  const rawType = schema.type
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (type): type is string => typeof type === 'string'
  )
  if (!types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: tipo inválido`)
    return errors
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => sameValue(allowed, value))) {
    errors.push(`${path}: valor fora do enum`)
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    errors.push(`${path}: abaixo do mínimo`)
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    errors.push(`${path}: acima do máximo`)
  }
  if (
    typeof schema.maxLength === 'number' &&
    typeof value === 'string' &&
    value.length > schema.maxLength
  ) {
    errors.push(`${path}: texto longo demais`)
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path}: itens de menos`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path}: itens demais`)
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => {
        errors.push(
          ...validateValue(schema.items as Record<string, unknown>, item, `${path}[${index}]`)
        )
      })
    }
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === 'string')
      : []
    for (const name of required) {
      if (!(name in value)) errors.push(`${path}.${name}: obrigatório`)
    }
    const additional = schema.additionalProperties
    for (const [name, child] of Object.entries(value)) {
      if (name in properties) {
        const childSchema = properties[name]
        if (isRecord(childSchema)) {
          errors.push(...validateValue(childSchema, child, `${path}.${name}`))
        }
        continue
      }
      if (additional === false) {
        errors.push(`${path}.${name}: argumento não permitido`)
      } else if (isRecord(additional)) {
        errors.push(...validateValue(additional, child, `${path}.${name}`))
      }
    }
  }

  return errors
}

/** Valida argumentos contra o schema. Devolve o objeto original em sucesso. */
export function validateArguments(
  parameters: Record<string, unknown>,
  args: unknown
): ArgumentValidation {
  if (!isRecord(args)) return { ok: false, errors: ['argumentos precisam ser objeto'] }
  const schemaErrors = validateSchema(parameters)
  if (schemaErrors.length > 0) return { ok: false, errors: schemaErrors }
  const errors = validateValue(parameters, args, 'args')
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: args }
}
