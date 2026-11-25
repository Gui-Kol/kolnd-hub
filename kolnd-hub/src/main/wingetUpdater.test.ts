import { describe, expect, it } from 'vitest'
import {
  parseUpgradeTable,
  parseUpgradeJson,
  lastLines,
  isBlockedUpgrade,
  WingetParseError
} from './wingetUpdater'

// Fixture no formato real do `winget upgrade` (winget v1.29.380, pt-BR):
// as larguras das colunas se ajustam ao maior conteúdo, e o cabeçalho
// (Nome|Id|Versão|Disponível|Origem — aqui em inglês) marca as posições.
const HEADER_LABELS = ['Name', 'Id', 'Version', 'Available', 'Source']
const HOTSPOT = 'Eclipse Temurin JDK with Hotspot 17.0.20.1+1 (x64)'
const ARP_ID = 'ARP\\Machine\\X64\\IntelliJ IDEA 2026.2.3' // id com backslashes e espaços

const FIXTURE_ROWS: Array<[string, string, string, string]> = [
  ['App Installer', 'Microsoft.AppInstaller', '1.29.379.0', '1.29.380'],
  [HOTSPOT, 'EclipseAdoptium.Temurin.17.JDK', '17.0.20.101', '17.0.21.9'],
  ['IntelliJ IDEA 2026.2.3', ARP_ID, '2026.2.3', '2026.2.4']
]

function buildTable(rows: Array<[string, string, string, string]>): string {
  const widths = [0, 1, 2, 3].map(
    (col) => Math.max(HEADER_LABELS[col].length, ...rows.map((r) => r[col].length)) + 2
  )
  const line = (cells: string[]): string =>
    cells.map((cell, i) => (i < widths.length ? cell.padEnd(widths[i]) : cell)).join('')
  const header = line(HEADER_LABELS)
  const separator = '-'.repeat(header.length)
  return (
    [header, separator, ...rows.map((r) => line([...r, 'winget']))].join('\n') +
    '\n16 upgrades available.'
  )
}

const SAMPLE_TABLE = buildTable(FIXTURE_ROWS)

describe('lastLines', () => {
  it('mantém as últimas N linhas (tolerante a \\r e \\r\\n)', () => {
    const input = 'l1\r\nl2\n\r\nl3\rl4\r\n'
    expect(lastLines(input, 2)).toBe('l3\nl4')
    expect(lastLines('a\nb\nc\nd', 2)).toBe('c\nd')
    expect(lastLines('uma-linha', 50)).toBe('uma-linha')
  })

  it('limita o tamanho total em caracteres', () => {
    const input = Array.from({ length: 60 }, (_, i) => `linha ${i} ${'x'.repeat(100)}`).join('\n')
    expect(lastLines(input, 50).length).toBeLessThanOrEqual(3000)
  })
})

describe('parseUpgradeTable', () => {
  it('extrai nome, id, versão atual e disponível da tabela (com IDs ARP com espaços)', () => {
    const items = parseUpgradeTable(SAMPLE_TABLE)
    expect(items).toHaveLength(3)

    expect(items[0]).toEqual({
      name: 'App Installer',
      id: 'Microsoft.AppInstaller',
      currentVersion: '1.29.379.0',
      availableVersion: '1.29.380'
    })

    expect(items[1].id).toBe('EclipseAdoptium.Temurin.17.JDK')
    expect(items[1].currentVersion).toBe('17.0.20.101')
    expect(items[1].availableVersion).toBe('17.0.21.9')

    // ID com backslashes e espaços deve vir intacto
    expect(items[2].id).toBe('ARP\\Machine\\X64\\IntelliJ IDEA 2026.2.3')
    expect(items[2].currentVersion).toBe('2026.2.3')
    expect(items[2].availableVersion).toBe('2026.2.4')
  })

  it('ignora a linha de rodapé "N upgrades available."', () => {
    const items = parseUpgradeTable(SAMPLE_TABLE)
    expect(items.some((i) => i.id.includes('upgrades available'))).toBe(false)
  })

  it('retorna [] quando não há atualizações (pt-BR e inglês)', () => {
    expect(parseUpgradeTable('Nenhuma atualização disponível.\n')).toEqual([])
    expect(parseUpgradeTable('No installed package found matching input criteria.\n')).toEqual([])
  })

  it('lança WingetParseError com rawLog (25 primeiras linhas) quando o parse falha', () => {
    // Tabela de 2 colunas (saída anômala "Multiple installed packages found matching input criteria")
    const anomaly = [
      'Multiple installed packages found matching input criteria. Please refine the input.',
      'Name                                                        Id',
      '-----------------------------------------------------------------------------------------------------------------------------',
      'Git                                                         Git.Git'
    ].join('\n')

    let caught: unknown
    try {
      parseUpgradeTable(anomaly)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(WingetParseError)
    const rawLog = (caught as WingetParseError).rawLog
    expect(rawLog).toContain('Multiple installed packages found')
    expect(rawLog.split('\n').length).toBeLessThanOrEqual(25)
  })
})

describe('isBlockedUpgrade', () => {
  it('oculta o Kloud Games mesmo quando ele usa o id do Sunshine oficial', () => {
    // Caso real medido: o Kloud Games se registra como "KLOUD_GAMES" com o id do Sunshine.
    expect(isBlockedUpgrade({ name: 'KLOUD_GAMES', id: 'LizardByte.Sunshine' })).toBe(true)
    expect(isBlockedUpgrade({ name: 'Kloud Games', id: 'Kloud.Games' })).toBe(true)
  })

  it('oculta o Kolnd Hub pelo nome (com e sem versão) e por ids com as marcas', () => {
    expect(isBlockedUpgrade({ name: 'Kolnd Hub', id: 'ARP\\Machine\\X64\\Kolnd Hub' })).toBe(true)
    expect(isBlockedUpgrade({ name: 'Kolnd Hub 1.5.0', id: 'Kolnd.Hub' })).toBe(true)
    expect(isBlockedUpgrade({ name: 'Algum App', id: 'Kolnd.Hub.Launcher' })).toBe(true)
    expect(isBlockedUpgrade({ name: 'Algum App', id: 'Kloud.Games.Setup' })).toBe(true)
  })

  it('preserva apps legítimos — inclusive um Sunshine com nome normal', () => {
    expect(isBlockedUpgrade({ name: 'Sunshine', id: 'LizardByte.Sunshine' })).toBe(false)
    expect(isBlockedUpgrade({ name: 'Git', id: 'Git.Git' })).toBe(false)
    expect(isBlockedUpgrade({ name: 'Docker Desktop', id: 'Docker.DockerDesktop' })).toBe(false)
  })
})

describe('parseUpgradeJson', () => {
  it('aceita array raiz com chaves no estilo PackageIdentifier', () => {
    const json = JSON.stringify([
      {
        PackageIdentifier: 'Git.Git',
        PackageName: 'Git',
        Version: '2.55.0',
        AvailableVersion: '2.56.0'
      }
    ])
    expect(parseUpgradeJson(json)).toEqual([
      { name: 'Git', id: 'Git.Git', currentVersion: '2.55.0', availableVersion: '2.56.0' }
    ])
  })

  it('aceita objeto embrulhando o array (ex.: { Data: [...] })', () => {
    const json = JSON.stringify({
      Data: [{ Id: 'RARLab.WinRAR', Name: 'WinRAR', InstalledVersion: '7.1', Available: '7.2' }]
    })
    expect(parseUpgradeJson(json)).toEqual([
      { name: 'WinRAR', id: 'RARLab.WinRAR', currentVersion: '7.1', availableVersion: '7.2' }
    ])
  })

  it('array vazio = nenhuma atualização (resultado válido)', () => {
    expect(parseUpgradeJson('[]')).toEqual([])
  })

  it('retorna null para JSON irreconhecível', () => {
    expect(parseUpgradeJson('{"foo": 1}')).toBeNull()
    expect(parseUpgradeJson('não é json')).toBeNull()
  })
})
