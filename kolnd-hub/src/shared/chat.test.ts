import { describe, expect, it } from 'vitest'
import { CHAT_HOST, CHAT_URL, classifyChatNavigation, isChatUrl } from './chat'

describe('isChatUrl', () => {
  it('aceita a URL base e a mesma URL com path/query', () => {
    expect(CHAT_URL).toBe('https://golive.nemtudo.me/groups')
    expect(isChatUrl(CHAT_URL)).toBe(true)
    expect(isChatUrl('https://golive.nemtudo.me')).toBe(true)
    expect(isChatUrl('https://golive.nemtudo.me/groups/123?tab=voz#sala')).toBe(true)
  })

  it('aceita o host em maiúsculas (URL normaliza)', () => {
    expect(isChatUrl('HTTPS://GOLIVE.NEMTUDO.ME/groups')).toBe(true)
  })

  it('rejeita http, subdomínio, host parecido e porta alternativa', () => {
    expect(isChatUrl('http://golive.nemtudo.me/groups')).toBe(false)
    expect(isChatUrl('https://app.golive.nemtudo.me/groups')).toBe(false)
    expect(isChatUrl('https://golive.nemtudo.me.evil.com/groups')).toBe(false)
    expect(isChatUrl('https://evil.golive.nemtudo.me/groups')).toBe(false)
    expect(isChatUrl('https://golive.nemtudo.me:8443/groups')).toBe(false)
  })

  it('rejeita esquemas perigosos, vazio e lixo', () => {
    expect(isChatUrl('javascript:alert(1)')).toBe(false)
    expect(isChatUrl('data:text/html,<h1>x</h1>')).toBe(false)
    expect(isChatUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isChatUrl('')).toBe(false)
    expect(isChatUrl('   ')).toBe(false)
    expect(isChatUrl('não é uma url')).toBe(false)
  })

  it('mantém o host canônico', () => {
    expect(CHAT_HOST).toBe('golive.nemtudo.me')
  })
})

describe('classifyChatNavigation', () => {
  it('permite a origem do Go Live', () => {
    expect(classifyChatNavigation(CHAT_URL)).toBe('allow')
    expect(classifyChatNavigation('https://golive.nemtudo.me/sala')).toBe('allow')
  })

  it('manda http/https/mailto de outro host para o navegador', () => {
    expect(classifyChatNavigation('https://discord.gg/nemtudo')).toBe('external')
    expect(classifyChatNavigation('http://example.com')).toBe('external')
    expect(classifyChatNavigation('mailto:contato@nemtudo.me')).toBe('external')
    expect(classifyChatNavigation('http://golive.nemtudo.me/groups')).toBe('external')
  })

  it('bloqueia esquemas perigosos e entradas inválidas', () => {
    expect(classifyChatNavigation('javascript:alert(1)')).toBe('block')
    expect(classifyChatNavigation('data:text/html,<h1>x</h1>')).toBe('block')
    expect(classifyChatNavigation('file:///C:/Windows')).toBe('block')
    expect(classifyChatNavigation('')).toBe('block')
    expect(classifyChatNavigation('lixo')).toBe('block')
  })
})
