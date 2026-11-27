import { describe, expect, it } from 'vitest'
import { LIVE_API_VERSION, buildLiveClientOptions, buildLiveSpeechConfig } from './sdk'

/**
 * O transporte real não é instanciado aqui: só a montagem pura do
 * `speechConfig`/opções que vão para `ai.live.connect`, para provar a voz
 * Charon, a versão `v1beta` e o comportamento sem voz sem tocar na rede.
 */
describe('Live API', () => {
  it('usa v1beta no cliente do Live', () => {
    expect(LIVE_API_VERSION).toBe('v1beta')
    expect(buildLiveClientOptions('chave-de-teste')).toEqual({
      apiKey: 'chave-de-teste',
      httpOptions: { apiVersion: LIVE_API_VERSION }
    })
  })
})

describe('buildLiveSpeechConfig', () => {
  it('monta voiceConfig.prebuiltVoiceConfig.voiceName', () => {
    expect(buildLiveSpeechConfig('Charon')).toEqual({
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Charon' }
      }
    })
  })

  it('remove espaços em volta do nome', () => {
    expect(buildLiveSpeechConfig('  Charon  ')).toEqual({
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: 'Charon' }
      }
    })
  })

  it('sem voz (undefined, vazio ou só espaços) não envia speechConfig', () => {
    expect(buildLiveSpeechConfig(undefined)).toBeUndefined()
    expect(buildLiveSpeechConfig('')).toBeUndefined()
    expect(buildLiveSpeechConfig('   ')).toBeUndefined()
  })
})
