// Tipos canônicos da medição de FPS/frametime por ETW.
//
// FRONTEIRA: este arquivo não importa nada de `main/`, `preload/` ou
// `renderer/` — é a fonte única compartilhada pelos três processos (mesmo
// padrão de `hwmon.ts`). Tipos puros, sem runtime de plataforma.

/**
 * Ciclo de vida da medição. `starting` cobre a janela entre o clique em
 * "Ativar" e o helper elevado publicar a linha `ready`; `error` é terminal até
 * o usuário tentar de novo (o botão de iniciar volta a aparecer).
 */
export type FpsState = 'off' | 'starting' | 'running' | 'error'

/**
 * Por que não há número agora. A UI usa isso para explicar o "—" sem inventar
 * um valor: `no-target` = primeiro plano não é um app com apresentações
 * (inclui o próprio Hub/Explorer/DWM), `no-presents` = o app em primeiro plano
 * não apresentou quadros nesta janela, `helper-stopped` = medição encerrada.
 */
export type FpsInactiveReason = 'not-started' | 'no-target' | 'no-presents' | 'helper-stopped'

/** Evento `fps:update` — emitido a cada janela de ~1 s enquanto o helper roda. */
export interface FpsUpdate {
  state: FpsState
  /** true somente com um alvo em primeiro plano e presents medidos nesta janela. */
  active: boolean
  pid: number | null
  processName: string | null
  fps: number | null
  frametimeMs: number | null
  /** ISO 8601 do instante em que o main montou esta atualização. */
  capturedAt: string
  reason?: FpsInactiveReason
  /** Mensagem amigável quando `state` é `error`. */
  error?: string
}

/** Resposta de `fps:status` — inclui a última atualização para a UI remontar a aba. */
export interface FpsStatusInfo {
  state: FpsState
  last: FpsUpdate | null
  error?: string
}

/** Resposta de `fps:start`. `cancelled` = UAC recusado; nada foi alterado. */
export interface FpsStartResult {
  ok: boolean
  cancelled?: boolean
  error?: string
  status: FpsStatusInfo
}

/** Resposta de `fps:stop` — idempotente. */
export interface FpsStopResult {
  ok: boolean
}

/**
 * Estado do FPS automático (tarefa agendada no logon).
 *
 * `off` = tarefa não instalada; `installing` = UAC/`schtasks` em andamento;
 * `running` = tarefa instalada e amostra fresca (< 3 s); `stale` = tarefa
 * instalada mas o agent parou (amostra velha/ausente); `error` = falha ao
 * instalar/remover ou consultar.
 */
export type FpsAutoState = 'off' | 'installing' | 'running' | 'stale' | 'error'

/** Amostra publicada pelo agent em `latest.json` (JSÓ o alvo em primeiro plano). */
export interface FpsAutoSample {
  pid: number
  name: string
  fps: number
  frametimeMs: number
  /** ISO 8601 gravado pelo agent no momento da amostra. */
  timestamp: string
}

/** Resposta de `fps:auto-status` (e base das ações de instalar/remover). */
export interface FpsAutoStatus {
  state: FpsAutoState
  /** `true` quando a tarefa `KolndHubFpsAgent` existe no Windows. */
  installed: boolean
  sample: FpsAutoSample | null
  /** Diretório do sink (`latest.json`) — visível para diagnóstico na UI. */
  sinkDir: string
  error?: string
}

/** Resposta de `fps:auto-install`/`fps:auto-remove`. */
export interface FpsAutoActionResult {
  ok: boolean
  /** UAC recusado pelo usuário: nada foi alterado. */
  cancelled?: boolean
  error?: string
  status: FpsAutoStatus
}
