import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Guarda da suíte do motor: nenhum teste toca a rede e o SDK fica isolado.
 *
 * Falha se `src/main/gemini/**` (exceto este arquivo) contiver:
 * - chave de API hardcoded (formato Google ou `apiKey` com literal longo);
 * - `console.*` (o main usa o logger com redação);
 * - URL de endpoint ou import de `http`/`https`/SDK fora de `sdk.ts`.
 */

const ROOT = join(process.cwd(), 'src', 'main', 'gemini')
const SELF = 'guard.test.ts'
const SDK_FILE = 'sdk.ts'

function listFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...listFiles(full))
    else if (entry.endsWith('.ts')) files.push(full)
  }
  return files
}

function relativeName(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

const files = listFiles(ROOT).filter((file) => relativeName(file) !== SELF)

const GOOGLE_KEY = new RegExp(['A', 'I', 'za[0-9A-Za-z_-]{20,}'].join(''))
const LONG_KEY_LITERAL = new RegExp('apiKey\\s*[:=]\\s*[\'"][^\'"]{16,}[\'"]')
const CONSOLE_CALL = new RegExp('console\\s*\\.')
const ENDPOINT_URL = new RegExp('https?://[^\\s\'"`]*(googleapis|generativelanguage)', 'i')
const NETWORK_IMPORT = new RegExp(
  'from\\s+[\'"](node:)?(https?)[\'"]|require\\(\\s*[\'"]https?[\'"]\\s*\\)'
)
const SDK_IMPORT = new RegExp('@google/genai')

describe('guarda do motor Gemini', () => {
  it('encontra os arquivos do motor', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.map(relativeName)).toContain('client.ts')
    expect(files.map(relativeName)).toContain('testing/fakeTransport.ts')
  })

  it('nenhuma chave de API hardcoded e nenhum console.*', () => {
    const problems: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (GOOGLE_KEY.test(text)) problems.push(`${relativeName(file)}: chave Google hardcoded`)
      if (LONG_KEY_LITERAL.test(text)) problems.push(`${relativeName(file)}: apiKey literal longo`)
      if (CONSOLE_CALL.test(text)) problems.push(`${relativeName(file)}: console.* no main`)
    }
    expect(problems).toEqual([])
  })

  it('SDK e endpoint só em sdk.ts', () => {
    const problems: string[] = []
    for (const file of files) {
      const name = relativeName(file)
      const text = readFileSync(file, 'utf8')
      if (name !== SDK_FILE && SDK_IMPORT.test(text)) {
        problems.push(`${name}: importa @google/genai fora de sdk.ts`)
      }
      if (name !== SDK_FILE && ENDPOINT_URL.test(text)) {
        problems.push(`${name}: URL de endpoint fora de sdk.ts`)
      }
      if (NETWORK_IMPORT.test(text)) {
        problems.push(`${name}: import direto de http/https`)
      }
    }
    expect(problems).toEqual([])
  })

  it('testes do motor usam o transporte falso', () => {
    const tests = files.filter((file) => relativeName(file).endsWith('.test.ts'))
    expect(tests.length).toBeGreaterThan(0)
    const usesSdk = tests.filter((file) => SDK_IMPORT.test(readFileSync(file, 'utf8')))
    expect(usesSdk.map(relativeName)).toEqual([])
  })
})
