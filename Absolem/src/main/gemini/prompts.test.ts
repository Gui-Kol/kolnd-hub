import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION, buildSystemPrompt } from './prompts'

describe('prompt de sistema', () => {
  it('versão 1.2.0', () => {
    expect(PROMPT_VERSION).toBe('1.2.0')
    expect(buildSystemPrompt()).toContain('promptVersion: 1.2.0')
  })

  it('instrui open_url para sites/vídeos e list_apps/open_app para programas', () => {
    const prompt = buildSystemPrompt()

    expect(prompt).toContain('open_url')
    expect(prompt).toContain('https://www.youtube.com/results?search_query=')
    expect(prompt).toContain('list_apps')
    expect(prompt).toContain('open_app')
    expect(prompt).toContain('português e em inglês')
    expect(prompt).toContain('sem o resultado ok')
  })

  it('lista as ferramentas recebidas com a categoria', () => {
    const prompt = buildSystemPrompt({
      tools: [{ name: 'open_url', category: 'web.search' }]
    })

    expect(prompt).toContain('- open_url [web.search]')
  })
})
