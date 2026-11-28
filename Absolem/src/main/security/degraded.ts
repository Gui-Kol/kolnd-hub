import type { AvatarState } from '../../shared/avatar'
import type { GeminiErrorKind } from '../../shared/gemini'
import { MICROPHONE_DENIED_MESSAGE } from '../voice/consent'

/**
 * Modos degradados (task 13/T12).
 *
 * Um mapa único de estado curto, visual e recuperável para cada falha esperada.
 * Nada de tela branca, loop de tentativa ou "erro desconhecido": toda entrada
 * tem `title`, `message`, `avatar`, `severity` e `recovery`.
 */

export const DEGRADED_SCENARIOS = [
  'no-key',
  'invalid-key',
  'no-network',
  'gemini-down',
  'quota',
  'microphone-denied',
  'device-removed',
  'webgl-unavailable',
  'memory-corrupted',
  'capture-blocked',
  'temporary'
] as const

export type DegradedScenario = (typeof DEGRADED_SCENARIOS)[number]

export type DegradedSeverity = 'info' | 'warning' | 'error'

export interface DegradedState {
  scenario: DegradedScenario
  title: string
  message: string
  avatar: AvatarState
  severity: DegradedSeverity
  /** Texto curto do que o usuário faz para voltar ao normal. */
  recovery: string
}

const STATES: Record<DegradedScenario, DegradedState> = {
  'no-key': {
    scenario: 'no-key',
    title: 'Chave do Gemini ausente',
    message: 'A conversa fica indisponível até salvar uma chave.',
    avatar: 'idle',
    severity: 'warning',
    recovery: 'Abra Configurações > Chave e custo, cole a chave e clique em Salvar chave.'
  },
  'invalid-key': {
    scenario: 'invalid-key',
    title: 'Chave recusada',
    message: 'A chave é inválida, expirou ou não tem permissão.',
    avatar: 'error',
    severity: 'error',
    recovery: 'Abra Configurações > Chave e custo, substitua a chave e teste a conexão.'
  },
  'no-network': {
    scenario: 'no-network',
    title: 'Sem conexão',
    message: 'Não foi possível falar com o Gemini agora.',
    avatar: 'error',
    severity: 'warning',
    recovery: 'Confira a conexão e tente de novo; o app continua utilizável offline.'
  },
  'gemini-down': {
    scenario: 'gemini-down',
    title: 'Gemini indisponível',
    message: 'O serviço do Gemini está fora do ar neste momento.',
    avatar: 'error',
    severity: 'warning',
    recovery: 'Aguarde alguns minutos e tente de novo; não há repetição automática.'
  },
  quota: {
    scenario: 'quota',
    title: 'Limite de tokens atingido',
    message: 'O teto mensal configurado foi alcançado.',
    avatar: 'error',
    severity: 'error',
    recovery: 'Aumente o teto em Configurações > Chave e custo ou aguarde o próximo mês.'
  },
  'microphone-denied': {
    scenario: 'microphone-denied',
    title: 'Microfone não autorizado',
    message: MICROPHONE_DENIED_MESSAGE,
    avatar: 'error',
    severity: 'warning',
    recovery:
      'Abra Configurações > Voz e clique em Permitir microfone; o texto continua disponível.'
  },
  'device-removed': {
    scenario: 'device-removed',
    title: 'Dispositivo de áudio removido',
    message: 'O microfone ou a saída escolhida não está mais disponível.',
    avatar: 'idle',
    severity: 'warning',
    recovery:
      'Abra Configurações > Voz e escolha outro dispositivo; a próxima sessão usa a escolha.'
  },
  'webgl-unavailable': {
    scenario: 'webgl-unavailable',
    title: 'Aceleração gráfica indisponível',
    message: 'O avatar usa o modo simplificado, sem WebGL.',
    avatar: 'idle',
    severity: 'info',
    recovery: 'Atualize o driver de vídeo ou reinicie o app para tentar o modo completo.'
  },
  'memory-corrupted': {
    scenario: 'memory-corrupted',
    title: 'Memória indisponível',
    message: 'O banco local não abriu; a memória fica pausada nesta execução.',
    avatar: 'idle',
    severity: 'warning',
    recovery:
      'Feche o app, renomeie memory.sqlite para memory.sqlite.bak e reabra; o app cria um banco vazio.'
  },
  'capture-blocked': {
    scenario: 'capture-blocked',
    title: 'Captura de tela bloqueada',
    message: 'A janela ou o modo de privacidade impediu a captura.',
    avatar: 'idle',
    severity: 'warning',
    recovery: 'Ligue a visão de tela em Configurações > Permissões ou remova o termo da blocklist.'
  },
  temporary: {
    scenario: 'temporary',
    title: 'Falha temporária',
    message: 'A operação não terminou. O app continua funcionando.',
    avatar: 'idle',
    severity: 'warning',
    recovery: 'Tente de novo; se persistir, abra o Diagnóstico e exporte o relatório.'
  }
}

export function degradedState(scenario: DegradedScenario): DegradedState {
  return { ...STATES[scenario] }
}

/**
 * Converte a taxonomia do Gemini em um estado degradado. `cancelled` não é
 * falha (o usuário cancelou) e devolve `null`; o resto sempre tem recuperação.
 */
export function degradedForGeminiError(kind: GeminiErrorKind): DegradedState | null {
  if (kind === 'auth') return degradedState('invalid-key')
  if (kind === 'quota') return degradedState('quota')
  if (kind === 'network') return degradedState('no-network')
  if (kind === 'timeout' || kind === 'server') return degradedState('gemini-down')
  if (kind === 'blocked') return degradedState('capture-blocked')
  if (kind === 'cancelled') return null
  return degradedState('temporary')
}

export function listDegradedStates(): DegradedState[] {
  return DEGRADED_SCENARIOS.map((scenario) => degradedState(scenario))
}
