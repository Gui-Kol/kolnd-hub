import { describe, expect, it } from 'vitest'
import {
  LIVE_API_VERSION,
  buildLiveClientOptions,
  buildLiveImageRealtimeInputPayload,
  buildLiveSpeechConfig,
  buildToolResponsePayload,
  toContents,
  toFunctionCalls
} from './sdk'

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

describe('buildLiveImageRealtimeInputPayload', () => {
  it('usa video Blob oficial, conserva mime/base64 e pergunta no mesmo input', () => {
    const payload = buildLiveImageRealtimeInputPayload(
      { mime: 'image/jpeg', data: new Uint8Array([0, 1, 254, 255]) },
      'Pergunta sintética'
    )
    expect(payload).toEqual({
      video: { data: 'AAH+/w==', mimeType: 'image/jpeg' },
      text: 'Pergunta sintética'
    })
    const video = payload.video as { data: string; mimeType: string }
    expect(video.mimeType).toBe('image/jpeg')
    expect(Buffer.from(video.data, 'base64')).toHaveLength(4)
    expect('media' in payload).toBe(false)
    expect('inlineData' in payload).toBe(false)
  })

  it('aceita base64 já codificado sem recodificar os bytes', () => {
    expect(
      buildLiveImageRealtimeInputPayload({ mime: 'image/png', data: 'AQID' }, 'descreva a imagem')
    ).toEqual({
      video: { data: 'AQID', mimeType: 'image/png' },
      text: 'descreva a imagem'
    })
  })
})

describe('buildToolResponsePayload', () => {
  it('devolve o id da chamada em cada functionResponse', () => {
    expect(
      buildToolResponsePayload([
        {
          id: 'call-1',
          name: 'open_url',
          response: { ok: true, result: { message: 'Abri o site.' } }
        }
      ])
    ).toEqual({
      functionResponses: [
        {
          name: 'open_url',
          response: { ok: true, result: { message: 'Abri o site.' } },
          id: 'call-1'
        }
      ]
    })
  })

  it('preserva um id distinto por resultado no lote', () => {
    const payload = buildToolResponsePayload([
      { id: 'call-1', name: 'open_url', response: { ok: true } },
      { id: 'call-2', name: 'get_ui_tree', response: { ok: true } }
    ])
    expect(payload.functionResponses.map((response) => response.id)).toEqual(['call-1', 'call-2'])
  })

  it('não inclui id quando a chamada não trouxe id', () => {
    const payload = buildToolResponsePayload([
      { name: 'open_url', response: { ok: true, result: null } }
    ])
    expect(payload).toEqual({
      functionResponses: [{ name: 'open_url', response: { ok: true, result: null } }]
    })
    expect('id' in payload.functionResponses[0]!).toBe(false)
  })
})

describe('toFunctionCalls', () => {
  it('preserva o id devolvido pelo provedor', () => {
    expect(toFunctionCalls([{ id: 'call-7', name: 'open_url', args: { url: 'x' } }])).toEqual([
      { name: 'open_url', args: { url: 'x' }, id: 'call-7' }
    ])
  })

  it('não inventa id quando a chamada não tem', () => {
    const calls = toFunctionCalls([{ name: 'open_url', args: {} }])
    expect(calls).toEqual([{ name: 'open_url', args: {} }])
    expect('id' in calls![0]!).toBe(false)
  })
})

describe('toContents com function calls', () => {
  it('leva functionCall.id no turno model', () => {
    expect(
      toContents([
        {
          role: 'model',
          text: '',
          functionCalls: [{ id: 'call-9', name: 'open_url', args: { url: 'https://x' } }]
        }
      ])
    ).toEqual([
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'open_url',
              args: { url: 'https://x' },
              id: 'call-9'
            }
          }
        ]
      }
    ])
  })

  it('leva functionResponse.id no turno user', () => {
    expect(
      toContents([
        {
          role: 'user',
          text: '',
          functionResponses: [
            { id: 'call-9', name: 'open_url', response: { ok: true, result: null } }
          ]
        }
      ])
    ).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'open_url',
              response: { ok: true, result: null },
              id: 'call-9'
            }
          }
        ]
      }
    ])
  })

  it('não inclui id nos dois sentidos quando a chamada não tem', () => {
    const [modelTurn, userTurn] = toContents([
      { role: 'model', text: '', functionCalls: [{ name: 'open_url', args: {} }] },
      {
        role: 'user',
        text: '',
        functionResponses: [{ name: 'open_url', response: { ok: true } }]
      }
    ])
    const modelPart = (modelTurn?.parts as Array<Record<string, Record<string, unknown>>>)[0]
    const userPart = (userTurn?.parts as Array<Record<string, Record<string, unknown>>>)[0]
    expect('id' in modelPart!.functionCall!).toBe(false)
    expect('id' in userPart!.functionResponse!).toBe(false)
  })
})
