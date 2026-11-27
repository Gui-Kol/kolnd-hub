import { describe, expect, it } from 'vitest'
import {
  HUB_KNOWLEDGE_SECTIONS,
  HUB_KNOWLEDGE_VERSION,
  buildHubOverview,
  normalizeHubText,
  searchHubKnowledge
} from './hubKnowledge'

const EXPECTED_IDS = [
  'visao-geral',
  'ferramentas',
  'biblioteca',
  'meu-pc',
  'hud',
  'big-picture',
  'acesso-remoto',
  'primeira-execucao',
  'configuracoes',
  'desinstalacao',
  'privacidade-seguranca',
  'problemas-comuns',
  'limites'
]

describe('base de conhecimento do Kolnd Hub', () => {
  it('tem versão 1.0.0 e as 13 seções obrigatórias, sem id repetido', () => {
    expect(HUB_KNOWLEDGE_VERSION).toBe('1.0.0')
    expect(HUB_KNOWLEDGE_SECTIONS).toHaveLength(13)
    expect(HUB_KNOWLEDGE_SECTIONS.map((section) => section.id)).toEqual(EXPECTED_IDS)
    expect(new Set(HUB_KNOWLEDGE_SECTIONS.map((section) => section.id)).size).toBe(13)
  })

  it('mantém cada body com até 600 caracteres e a base inteira com até 8 KB', () => {
    for (const section of HUB_KNOWLEDGE_SECTIONS) {
      expect(section.body.length, `${section.id} tem body longo`).toBeLessThanOrEqual(600)
      expect(section.body.trim().length).toBeGreaterThan(0)
    }
    const totalBytes = HUB_KNOWLEDGE_SECTIONS.reduce(
      (sum, section) => sum + Buffer.byteLength(section.body, 'utf8'),
      0
    )
    expect(totalBytes).toBeLessThanOrEqual(8 * 1024)
  })

  it('não contém segredo nem caminho pessoal', () => {
    const fullText = JSON.stringify(HUB_KNOWLEDGE_SECTIONS) + buildHubOverview()
    expect(fullText).not.toContain('AIza')
    expect(fullText).not.toContain('C:\\Users\\')
    expect(fullText).not.toMatch(/api[_-]?key/i)
  })

  it('resume as telas e as regras no bloco compacto', () => {
    const overview = buildHubOverview()
    for (const label of [
      'Ferramentas',
      'Biblioteca',
      'Chat',
      'Meu PC',
      'Configurações',
      'Big Picture',
      'HUD'
    ]) {
      expect(overview).toContain(label)
    }
    expect(overview).toContain('%APPDATA%\\kolnd-hub')
    expect(overview).toContain('%APPDATA%\\absolem')
    expect(overview).toContain('não está documentado')
    expect(overview).toContain('não abra telas')
    expect(Buffer.byteLength(overview, 'utf8')).toBeLessThanOrEqual(1800)
  })

  it('normaliza acentos e caixa na consulta', () => {
    expect(normalizeHubText('Configurações')).toBe('configuracoes')
    expect(normalizeHubText('  HUD  ')).toBe('hud')
    expect(searchHubKnowledge('configuracoes').sections[0]?.id).toBe('configuracoes')
  })

  it('acha como instalar o Kloud Games na primeira execução', () => {
    const result = searchHubKnowledge('como instalar o Kloud Games')
    expect(result.sections[0]?.id).toBe('primeira-execucao')
    expect(result.sections.length).toBeLessThanOrEqual(2)
  })

  it('entende a conjugação "como instalo" e a frase do teste manual', () => {
    expect(searchHubKnowledge('como instalo o Kloud Games?').sections[0]?.id).toBe(
      'primeira-execucao'
    )
    expect(searchHubKnowledge('como desinstalo o Hub sem perder meus dados?').sections[0]?.id).toBe(
      'desinstalacao'
    )
  })

  it('acha onde fica o HUD', () => {
    const result = searchHubKnowledge('onde fica o HUD')
    expect(result.sections[0]?.id).toBe('hud')
  })

  it('acha desinstalação, biblioteca, Meu PC e ZeroTier', () => {
    expect(searchHubKnowledge('desinstalar').sections[0]?.id).toBe('desinstalacao')
    expect(searchHubKnowledge('biblioteca').sections[0]?.id).toBe('biblioteca')
    expect(searchHubKnowledge('meu pc').sections[0]?.id).toBe('meu-pc')
    expect(searchHubKnowledge('zerotier').sections[0]?.id).toBe('acesso-remoto')
  })

  it('sem resultado devolve overview e a lista com os 13 tópicos', () => {
    const result = searchHubKnowledge('receita de bolo de cenoura')
    expect(result.sections).toEqual([])
    expect(result.overview).toBe(buildHubOverview())
    expect(result.topics).toHaveLength(13)
    expect(result.topics.map((topic) => topic.title)).toContain('HUD')
  })

  it('respeita o limite de seções', () => {
    const result = searchHubKnowledge('hub kloud games biblioteca', { limit: 1 })
    expect(result.sections).toHaveLength(1)
    expect(searchHubKnowledge('hub', { limit: 99 }).sections.length).toBeLessThanOrEqual(13)
  })
})
