import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Testes do diagnóstico sanitizado (task 06-6.3).
 *
 * `electron`, `./store` e `./kloudGames` são simulados: o relatório deve
 * conter apenas contagens/metadados (nunca comandos, cwd, URLs, nomes de
 * jogos ou valores de gamepad) e todo o corpo passa por `redactSecrets`.
 * O diretório temporário por teste é publicado em globalThis para a factory
 * do mock do `electron` (ela roda antes de qualquer variável local existir).
 */

vi.mock('electron', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  return {
    app: {
      getVersion: () => '9.9.9-test',
      getPath: (name: string): string => {
        const base = (globalThis as Record<string, unknown>).__kolndDiagDir ?? tmpdir()
        return join(String(base), name === 'userData' ? 'userData' : name)
      }
    }
  }
})

const mockStore = vi.hoisted(() => ({
  getConfigSnapshot: vi.fn(() => ({
    apps: [
      {
        id: 'kloud-games',
        name: 'Kloud Games Secreto',
        description: 'não deve vazar',
        icon: '🎮',
        color: '#fff',
        gradient: 'from-a to-b',
        command: 'C:\\segredos\\comando-secreto.exe --token super-secreto-123',
        cwd: 'C:\\segredos\\diretorio-secreto',
        category: 'gaming' as const,
        tags: ['tag-secreta'],
        url: 'https://segredo.example.com',
        useShell: false
      },
      {
        id: 'mark-lvi',
        name: 'Mark LVI Secreto',
        description: '',
        icon: '🤖',
        color: '#fff',
        gradient: 'from-a to-b',
        command: 'mark-lvi.exe --api-key chave-secreta-999',
        cwd: 'C:\\apps\\mark-lvi',
        category: 'ai' as const,
        tags: [],
        useShell: true
      }
    ],
    startupImportance: { 'kloud-games': 'critico' as const, 'mark-lvi': 'opcional' as const }
  })),
  getStoredGames: vi.fn(() => [
    {
      id: 'g1',
      name: 'Jogo Super Secreto',
      exePath: 'C:\\jogos\\secreto.exe',
      iconPath: null,
      origin: 'steam' as const,
      addedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      id: 'g2',
      name: 'Outro Jogo Oculto',
      exePath: 'C:\\jogos\\oculto.exe',
      iconPath: null,
      origin: 'custom' as const,
      addedAt: '2026-01-02T00:00:00.000Z'
    },
    {
      id: 'g3',
      name: 'Terceiro Jogo Secreto',
      exePath: 'C:\\jogos\\secreto2.exe',
      iconPath: null,
      origin: 'custom' as const,
      addedAt: '2026-01-03T00:00:00.000Z'
    }
  ]),
  getLaunchKloudOnStart: vi.fn(() => true),
  getGamepadConfig: vi.fn(() => ({
    profile: 'xbox' as const,
    controllerId: 'xbox-360',
    controllerName: 'Controle Secreto',
    mapping: {} as never,
    autoMapped: true,
    configuredAt: '2026-01-01T00:00:00.000Z'
  })),
  getBigPicturePrefs: vi.fn(() => ({ sounds: false }))
}))

vi.mock('./store', () => mockStore)

vi.mock('./kloudGames', async () => {
  const { join } = await import('path')
  return {
    getKloudGamesInstallLogPath: (): string =>
      join(
        String((globalThis as Record<string, unknown>).__kolndDiagDir),
        'logs',
        'kloud-games-install.log'
      ),
    getKloudGamesUninstallLogPath: (): string =>
      join(
        String((globalThis as Record<string, unknown>).__kolndDiagDir),
        'logs',
        'kloud-games-uninstall.log'
      )
  }
})

import { buildDiagnosticReport, readTail, redactSecrets } from './diagnostic'

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'kolnd-hub-diag-'))
  ;(globalThis as Record<string, unknown>).__kolndDiagDir = baseDir
  vi.clearAllMocks()
  mkdirSync(join(baseDir, 'userData', 'logs'), { recursive: true })
  mkdirSync(join(baseDir, 'logs'), { recursive: true })
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__kolndDiagDir
  rmSync(baseDir, { recursive: true, force: true })
})

describe('redactSecrets', () => {
  it('redige API_KEY=...', () => {
    expect(redactSecrets('API_KEY=abc123')).toBe('API_KEY=[redigido]')
    expect(redactSecrets('api_key=abc123')).toBe('api_key=[redigido]')
    expect(redactSecrets('api-key=abc123')).toBe('api-key=[redigido]')
  })

  it('redige token: ...', () => {
    expect(redactSecrets('token: xyz987')).toBe('token: [redigido]')
  })

  it('redige Authorization: Bearer ...', () => {
    expect(redactSecrets('Authorization: Bearer abcdef1234567890abcdef1234567890')).toBe(
      'Authorization: Bearer [redigido]'
    )
  })

  it('redige password/senha/secret/authorization com = ou :', () => {
    expect(redactSecrets('password=hunter2')).toBe('password=[redigido]')
    expect(redactSecrets('senha: minha-senha')).toBe('senha: [redigido]')
    expect(redactSecrets('secret=topsecretvalue')).toBe('secret=[redigido]')
    expect(redactSecrets('authorization: valor-opaco')).toBe('authorization: [redigido]')
  })

  it('redige padrões longos base64/hex precedidos dos rótulos', () => {
    const b64 = 'A'.repeat(64)
    expect(redactSecrets(`token=${b64}`)).toBe('token=[redigido]')
    const hex = 'deadbeef'.repeat(8)
    expect(redactSecrets(`secret: ${hex}`)).toBe('secret: [redigido]')
  })

  it('redige valores entre aspas', () => {
    expect(redactSecrets('password="com espaço secreto"')).toBe('password=[redigido]')
    expect(redactSecrets("token='com espaço'")).toBe('token=[redigido]')
  })

  it('mantém texto sem segredos intacto', () => {
    const texto = 'Nenhuma chave aqui: app iniciado normalmente (pid 1234)'
    expect(redactSecrets(texto)).toBe(texto)
  })
})

describe('readTail', () => {
  it('retorna as últimas N linhas', () => {
    const file = join(baseDir, 'tail.log')
    const lines = Array.from({ length: 300 }, (_, i) => `linha-${i + 1}`)
    writeFileSync(file, lines.join('\n'))
    const tail = readTail(file, 200)
    expect(tail.split('\n')).toHaveLength(200)
    expect(tail).toContain('linha-300')
    expect(tail).toContain('linha-101')
    expect(tail).not.toContain('linha-100')
  })

  it('arquivo ausente → string vazia (sem lançar)', () => {
    expect(readTail(join(baseDir, 'nao-existe.log'))).toBe('')
  })

  it('limita a leitura aos últimos ~256 KB', () => {
    const file = join(baseDir, 'grande.log')
    // ~512 KB: metade deve ser descartada antes de contar as linhas.
    const bigLine = 'x'.repeat(1023)
    const total = 512
    const lines = Array.from({ length: total }, (_, i) => `linha${i}:${bigLine}`)
    lines[0] = `PRIMEIRALINHA:${bigLine}`
    writeFileSync(file, lines.join('\n'))
    const tail = readTail(file, 200)
    // O começo do arquivo não pode aparecer: leitura limitada aos últimos 256 KB.
    expect(tail).not.toContain('PRIMEIRALINHA')
    expect(tail).toContain(`linha${total - 1}:`)
  })
})

describe('buildDiagnosticReport', () => {
  it('contém versão do app e seções rotuladas em pt-BR', () => {
    const report = buildDiagnosticReport()
    expect(report).toContain('Kolnd Hub 9.9.9-test')
    expect(report).toContain('Sistema')
    expect(report).toContain('Store')
    expect(report).toContain('Aviso')
    expect(report).toContain(
      'Este diagnóstico não contém comandos, caminhos pessoais nem chaves. Revise antes de colar em um ticket público.'
    )
  })

  it('contém contagens do store e metadados, sem valores brutos', () => {
    const report = buildDiagnosticReport()
    expect(report).toContain('Apps configurados: 2')
    expect(report).toContain('Jogos na biblioteca: 3')
    expect(report).toContain('Importâncias configuradas: 2')
    expect(report).toContain('launchKloudOnStart')
    expect(report).toContain('Controle (Big Picture) configurado: sim')
    expect(report).toContain('Big Picture — efeitos sonoros: desativados')
    // id + category + useShell por app
    expect(report).toContain('kloud-games')
    expect(report).toContain('gaming')
    expect(report).toContain('mark-lvi')
    expect(report).toContain('ai')
  })

  it('NÃO contém comandos, cwd, urls, tags nem nomes de jogos', () => {
    const report = buildDiagnosticReport()
    expect(report).not.toContain('comando-secreto.exe')
    expect(report).not.toContain('diretorio-secreto')
    expect(report).not.toContain('mark-lvi.exe')
    expect(report).not.toContain('segredo.example.com')
    expect(report).not.toContain('tag-secreta')
    expect(report).not.toContain('Jogo Super Secreto')
    expect(report).not.toContain('Outro Jogo Oculto')
    expect(report).not.toContain('Terceiro Jogo Secreto')
    expect(report).not.toContain('C:\\jogos\\secreto.exe')
    expect(report).not.toContain('Kloud Games Secreto')
    expect(report).not.toContain('super-secreto-123')
    expect(report).not.toContain('chave-secreta-999')
    expect(report).not.toContain('Controle Secreto')
  })

  it('inclui as últimas linhas dos logs disponíveis', () => {
    writeFileSync(
      join(baseDir, 'userData', 'logs', 'kolnd-hub.log'),
      'linha anterior\n[INFO] [games] linha de log do Hub para diagnóstico\n'
    )
    writeFileSync(join(baseDir, 'logs', 'kloud-games-install.log'), 'instalando kloud games\n')
    const report = buildDiagnosticReport()
    expect(report).toContain('linha de log do Hub para diagnóstico')
    expect(report).toContain('instalando kloud games')
  })

  it('loga contendo segredos saem redigidos no relatório', () => {
    writeFileSync(
      join(baseDir, 'userData', 'logs', 'kolnd-hub.log'),
      'INFO algo aconteceu API_KEY=sekrit-do-hub-000 e token: tokensecreto111\n'
    )
    const report = buildDiagnosticReport()
    expect(report).not.toContain('sekrit-do-hub-000')
    expect(report).not.toContain('tokensecreto111')
    expect(report).toContain('[redigido]')
  })

  it('log ausente → seção com aviso, sem erro', () => {
    // Nenhum log gravado — todos ausentes.
    const report = buildDiagnosticReport()
    expect(report).toContain('kolnd-hub.log')
    expect(report).toMatch(/ausente|não encontrado/i)
  })
})
