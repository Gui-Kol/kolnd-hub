import { describe, expect, it } from 'vitest'
import {
  CHAT_HOST,
  CHAT_LOGIN_HOSTS,
  CHAT_URL,
  classifyChatNavigation,
  isChatNavigationUrl,
  isChatUrl
} from './chat'

// URL real do fluxo de login (observada no log do app em 26/11/2026).
const OAUTH_START =
  'https://apigolive.nemtudo.me/auth/oauth/discord/start?returnTo=https%3A%2F%2Fgolive.nemtudo.me%2F'
const DISCORD_AUTHORIZE =
  'https://discord.com/oauth2/authorize?client_id=1&redirect_uri=https%3A%2F%2Fapigolive.nemtudo.me%2Fauth%2Foauth%2Fdiscord%2Fcallback&response_type=code&scope=identify'

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

  it('não confunde a API/oauth nem o Discord com a origem do site', () => {
    expect(isChatUrl(OAUTH_START)).toBe(false)
    expect(isChatUrl(DISCORD_AUTHORIZE)).toBe(false)
    expect(CHAT_HOST).toBe('golive.nemtudo.me')
  })
})

describe('isChatNavigationUrl', () => {
  it('aceita o site e os hosts do login (https)', () => {
    expect(isChatNavigationUrl(CHAT_URL)).toBe(true)
    expect(isChatNavigationUrl(OAUTH_START)).toBe(true)
    expect(isChatNavigationUrl(DISCORD_AUTHORIZE)).toBe(true)
    expect(isChatNavigationUrl('https://discord.com/login?redirect_to=%2Foauth2%2Fauthorize')).toBe(
      true
    )
    expect(CHAT_LOGIN_HOSTS).toEqual(['apigolive.nemtudo.me', 'discord.com'])
  })

  it('rejeita http, subdomínio, host parecido e porta alternativa', () => {
    expect(isChatNavigationUrl('http://apigolive.nemtudo.me/auth')).toBe(false)
    expect(isChatNavigationUrl('https://evil.discord.com/oauth2/authorize')).toBe(false)
    expect(isChatNavigationUrl('https://discord.com.evil.com/oauth2/authorize')).toBe(false)
    expect(isChatNavigationUrl('https://apigolive.nemtudo.me:8443/auth')).toBe(false)
    expect(isChatNavigationUrl('https://golive.nemtudo.me.evil.com/')).toBe(false)
  })
})

describe('classifyChatNavigation', () => {
  it('permite o site e o fluxo de login do Discord dentro do guest', () => {
    expect(classifyChatNavigation(CHAT_URL)).toBe('allow')
    expect(classifyChatNavigation('https://golive.nemtudo.me/sala')).toBe('allow')
    expect(classifyChatNavigation(OAUTH_START)).toBe('allow')
    expect(classifyChatNavigation(DISCORD_AUTHORIZE)).toBe('allow')
  })

  it('manda http/https/mailto de outro host para o navegador', () => {
    expect(classifyChatNavigation('https://discord.gg/nemtudo')).toBe('external')
    expect(classifyChatNavigation('http://example.com')).toBe('external')
    expect(classifyChatNavigation('mailto:contato@nemtudo.me')).toBe('external')
    expect(classifyChatNavigation('http://golive.nemtudo.me/groups')).toBe('external')
    expect(classifyChatNavigation('https://evil.discord.com/oauth2/authorize')).toBe('external')
  })

  it('bloqueia esquemas perigosos e entradas inválidas', () => {
    expect(classifyChatNavigation('javascript:alert(1)')).toBe('block')
    expect(classifyChatNavigation('data:text/html,<h1>x</h1>')).toBe('block')
    expect(classifyChatNavigation('file:///C:/Windows')).toBe('block')
    expect(classifyChatNavigation('')).toBe('block')
    expect(classifyChatNavigation('lixo')).toBe('block')
  })
})
