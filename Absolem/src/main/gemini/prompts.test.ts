import { describe, expect, it } from 'vitest'
import { buildHubOverview } from '../knowledge/hubKnowledge'
import { PROMPT_VERSION, buildSystemPrompt } from './prompts'

describe('prompt de sistema', () => {
  it('versão 1.6.0', () => {
    expect(PROMPT_VERSION).toBe('1.6.0')
    expect(buildSystemPrompt()).toContain('promptVersion: 1.6.0')
  })

  it('responde sempre em português do Brasil, salvo pedido explícito', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain('responda sempre em português do Brasil')
    expect(prompt).toContain('só use outro idioma')
    expect(prompt).toContain('pedir explicitamente')
    expect(prompt).not.toContain('responda sempre no idioma em que o usuário escreveu')
  })

  it('instrui open_youtube para vídeos/episódios e open_url para URLs diretas', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain('open_youtube')
    expect(prompt).toContain('episódio 400 casa automática')
    expect(prompt).toContain('abre o vídeo direto')
    expect(prompt).toContain('não use open_url com URL de resultados')
    expect(prompt).not.toContain('https://www.youtube.com/results')
    expect(prompt).toContain('open_url com uma URL http ou https')
    expect(prompt).toContain('list_apps')
    expect(prompt).toContain('open_app')
    expect(prompt).toContain('português e em inglês')
    expect(prompt).toContain('sem o resultado ok')
  })

  it('exige confirmação curta e no passado depois de qualquer ferramenta', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain('Resposta obrigatória')
    expect(prompt).toContain('Sempre responda ao usuário ao final do turno')
    expect(prompt).toContain('mesmo quando nenhuma ferramenta for usada')
    expect(prompt).toContain('uma frase curta no passado')
    expect(prompt).toContain('O aplicativo Insomnia já estava aberto.')
    expect(prompt).toContain('Não consegui abrir o aplicativo Insomnia')
    expect(prompt).toContain('campo message do resultado da ferramenta')
    expect(prompt).toContain('sem o resultado ok:true')
    expect(prompt).toContain('Nunca termine o turno em silêncio depois de uma ferramenta')
  })

  it('lista as ferramentas recebidas com a categoria', () => {
    const prompt = buildSystemPrompt({
      tools: [
        { name: 'open_url', category: 'web.search' },
        { name: 'open_youtube', category: 'web.search' }
      ]
    })

    expect(prompt).toContain('- open_url [web.search]')
    expect(prompt).toContain('- open_youtube [web.search]')
  })

  it('inclui o bloco compacto do Kolnd Hub e a regra do hub_help', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain(buildHubOverview())
    expect(prompt).toContain('hub_help')
    expect(prompt).toContain('nomes exatos das telas')
    expect(prompt).toContain('não está documentado')
    expect(prompt).toContain('Não abra telas')
    expect(prompt).toContain('pedido e confirmação')
    expect(prompt).toContain('%APPDATA%\\kolnd-hub')
    expect(prompt).toContain('%APPDATA%\\absolem')
  })
})
