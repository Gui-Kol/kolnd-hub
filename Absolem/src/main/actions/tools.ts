import type { ToolEntry, ToolHandler } from '../gemini/tools/internal'
import type { ToolRegistry } from '../gemini/tools/registry'
import type { AppCatalog } from './appCatalog'
import type { CloseProcessResult, ProcessInfo } from './processes'
import type { ReadFileInput, ReadFileResult } from './readFile'
import type { SearchInput, SearchResult } from './search'
import type { ApplyFileOpsResult, FileOpInput, FilePlan } from './fileOps'
import type { SystemActions, SystemActionResult } from './system'
import {
  UIA_ROLES,
  type UiAutomation,
  type UiInvokeResult,
  type UiRole,
  type UiTreeResult
} from './uia'
import type { ActionLimiter } from '../audit/actions'
import { MAX_FETCH_URL_CHARS } from '../../shared/search'

/**
 * Ferramentas reais de controle do computador (task 08, T10).
 *
 * Cada entrada declara `category` (a permissão consultada pelo roteador da task
 * 05) e `sensitive` quando a confirmação é obrigatória mesmo com `allow`. Os
 * handlers só recebem argumentos já validados pelo schema e nunca aceitam
 * string de comando.
 */

export interface ProcessActions {
  list: () => Promise<ProcessInfo[]>
  close: (pid: number, force: boolean) => Promise<CloseProcessResult>
}

export interface ActionToolsEnv {
  catalog: AppCatalog
  processes: ProcessActions
  search: (input: SearchInput) => Promise<SearchResult>
  readFile: (input: ReadFileInput) => Promise<ReadFileResult>
  planFileOps: (input: { ops: FileOpInput[] }) => Promise<FilePlan>
  applyFileOps: (plan: FilePlan) => Promise<ApplyFileOpsResult>
  undoFileOp: (id: string) => Promise<{ ok: true; id: string; undone: number }>
  /** Abre um site http/https no navegador padrão (allowlist em `instance.ts`). */
  openUrl: (url: string) => Promise<{ url: string }>
  system: SystemActions
  uia: UiAutomation
  limiter: ActionLimiter
  /** Confirmação extra e explícita antes de `/T /F`. */
  confirmForceClose: (pid: number) => Promise<boolean>
  /** Mostra o plano legível antes de executar movimentação. */
  confirmPlan: (plan: FilePlan) => Promise<boolean>
}

function fileOpsProperty(): Record<string, unknown> {
  return {
    type: 'array',
    description: 'Operações (máximo 10) dentro das pastas permitidas.',
    minItems: 1,
    maxItems: 10,
    items: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'move, rename, copy ou delete (Lixeira).',
          enum: ['move', 'rename', 'copy', 'delete']
        },
        from: { type: 'string', description: 'Caminho absoluto de origem.', maxLength: 1024 },
        to: { type: 'string', description: 'Caminho absoluto de destino.', maxLength: 1024 }
      },
      required: ['kind', 'from'],
      additionalProperties: false
    }
  }
}

function actionResult(result: SystemActionResult): unknown {
  if (!result.ok) throw new Error(result.error)
  return result
}

export function createActionToolEntries(env: ActionToolsEnv): ToolEntry[] {
  return [
    {
      definition: {
        name: 'list_apps',
        description: 'Lista os nomes de aplicativos instalados disponíveis para abrir.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: false,
        category: 'internal',
        timeoutMs: 15_000
      },
      handler: async () => ({ apps: await env.catalog.listNames() })
    },
    {
      definition: {
        name: 'open_app',
        description: 'Abre um aplicativo pelo nome exato do catálogo de programas instalados.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Nome do aplicativo como aparece em list_apps.',
              maxLength: 100
            }
          },
          required: ['name'],
          additionalProperties: false
        },
        sensitive: true,
        category: 'apps.launch',
        timeoutMs: 10_000
      },
      handler: async (args) => {
        if (!env.limiter.checkAppLaunch()) {
          throw new Error('Limite de 5 aberturas de aplicativo por minuto atingido.')
        }
        const result = await env.catalog.open(String(args.name ?? ''))
        if (!result.ok) throw new Error(result.error)
        return { app: result.app.name, pid: result.pid, verified: result.verified }
      }
    },
    {
      definition: {
        name: 'open_url',
        description:
          'Abre um site ou vídeo no navegador padrão do usuário. Use para pedidos como ' +
          '"abrir o YouTube" ou "ver um vídeo"; para pesquisar no YouTube, monte a URL ' +
          'https://www.youtube.com/results?search_query=... com termos em texto. Só http/https.',
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL completa http ou https (ex.: https://www.youtube.com).',
              maxLength: MAX_FETCH_URL_CHARS
            }
          },
          required: ['url'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'web.search',
        timeoutMs: 10_000
      },
      handler: async (args) => {
        const result = await env.openUrl(String(args.url ?? ''))
        return { url: result.url }
      }
    },
    {
      definition: {
        name: 'list_processes',
        description: 'Lista processos em execução (nome, PID, sessão e memória).',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: false,
        category: 'internal',
        timeoutMs: 10_000
      },
      handler: async () => ({ processes: await env.processes.list() })
    },
    {
      definition: {
        name: 'close_process',
        description:
          'Pede ao programa para fechar (sem forçar). Se não fechar em 5 s, ofereça forçar com confirmação.',
        parameters: {
          type: 'object',
          properties: {
            pid: { type: 'integer', description: 'PID do processo.', minimum: 1 },
            force: {
              type: 'boolean',
              description: 'Forçar encerramento (/T /F) só depois de confirmação explícita.'
            }
          },
          required: ['pid'],
          additionalProperties: false
        },
        sensitive: true,
        category: 'apps.close',
        timeoutMs: 15_000
      },
      handler: async (args) => {
        const pid = Number(args.pid)
        const force = args.force === true
        if (force) {
          const confirmed = await env.confirmForceClose(pid)
          if (!confirmed) throw new Error('Forçar encerramento não foi confirmado.')
        }
        const result = await env.processes.close(pid, force)
        if (!result.ok && result.reason !== 'still-running') throw new Error(result.error)
        return result
      }
    },
    {
      definition: {
        name: 'search_files',
        description: 'Pesquisa arquivos por parte do nome dentro das pastas permitidas.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Parte do nome do arquivo.', maxLength: 100 },
            roots: {
              type: 'array',
              description: 'Pastas específicas dentro das permitidas (opcional).',
              items: { type: 'string', maxLength: 1024 }
            },
            maxResults: { type: 'integer', description: 'Máximo de resultados (até 200).' }
          },
          required: ['query'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'files.read',
        timeoutMs: 15_000
      },
      handler: async (args) =>
        env.search({
          query: String(args.query ?? ''),
          ...(Array.isArray(args.roots) ? { roots: args.roots.map(String) } : {}),
          ...(typeof args.maxResults === 'number' ? { maxResults: args.maxResults } : {})
        })
    },
    {
      definition: {
        name: 'read_file',
        description: 'Lê um arquivo de texto permitido (até 1 MB e 2.000 linhas).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Caminho absoluto do arquivo.', maxLength: 1024 },
            maxBytes: { type: 'integer', description: 'Limite de bytes (máximo 1 MB).' }
          },
          required: ['path'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'files.read',
        timeoutMs: 10_000
      },
      handler: async (args) =>
        env.readFile({
          path: String(args.path ?? ''),
          ...(typeof args.maxBytes === 'number' ? { maxBytes: args.maxBytes } : {})
        })
    },
    {
      definition: {
        name: 'plan_file_ops',
        description:
          'Monta o plano legível de mover/renomear/copiar/excluir (até 10 operações) sem executar.',
        parameters: {
          type: 'object',
          properties: { ops: fileOpsProperty() },
          required: ['ops'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'internal',
        timeoutMs: 10_000
      },
      handler: async (args) => {
        const ops = Array.isArray(args.ops) ? (args.ops as FileOpInput[]) : []
        if (!env.limiter.checkFileOps(ops.length)) {
          throw new Error('Máximo de 10 operações de arquivo por pedido.')
        }
        return env.planFileOps({ ops })
      }
    },
    {
      definition: {
        name: 'apply_file_ops',
        description:
          'Executa o plano de arquivos após confirmação que mostra origem -> destino. Grava journal para desfazer.',
        parameters: {
          type: 'object',
          properties: { ops: fileOpsProperty() },
          required: ['ops'],
          additionalProperties: false
        },
        sensitive: true,
        category: 'files.write',
        timeoutMs: 30_000
      },
      handler: async (args) => {
        const ops = Array.isArray(args.ops) ? (args.ops as FileOpInput[]) : []
        if (!env.limiter.checkFileOps(ops.length)) {
          throw new Error('Máximo de 10 operações de arquivo por pedido.')
        }
        const plan = await env.planFileOps({ ops })
        const confirmed = await env.confirmPlan(plan)
        if (!confirmed) throw new Error('O plano de arquivos não foi confirmado.')
        return env.applyFileOps(plan)
      }
    },
    {
      definition: {
        name: 'undo_file_op',
        description: 'Desfaz uma movimentação feita pelo assistente nas últimas 24 h.',
        parameters: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Id do journal devolvido pela execução.',
              maxLength: 64
            }
          },
          required: ['id'],
          additionalProperties: false
        },
        sensitive: true,
        category: 'files.write',
        timeoutMs: 15_000
      },
      handler: async (args) => env.undoFileOp(String(args.id ?? ''))
    },
    {
      definition: {
        name: 'lock_workstation',
        description: 'Bloqueia a estação de trabalho.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: true,
        category: 'system.power',
        timeoutMs: 10_000
      },
      handler: async () => actionResult(await env.system.lock())
    },
    {
      definition: {
        name: 'sleep_computer',
        description: 'Coloca o computador em suspensão.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: true,
        category: 'system.power',
        timeoutMs: 10_000
      },
      handler: async () => actionResult(await env.system.sleep())
    },
    {
      definition: {
        name: 'shutdown_computer',
        description: 'Agenda o desligamento em 60 s, com aviso e possibilidade de cancelar.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: true,
        category: 'system.power',
        timeoutMs: 10_000
      },
      handler: async () => actionResult(await env.system.shutdown())
    },
    {
      definition: {
        name: 'restart_computer',
        description: 'Agenda o reinício em 60 s, com aviso e possibilidade de cancelar.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: true,
        category: 'system.power',
        timeoutMs: 10_000
      },
      handler: async () => actionResult(await env.system.restart())
    },
    {
      definition: {
        name: 'cancel_shutdown',
        description: 'Cancela um desligamento ou reinício agendado.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
          additionalProperties: false
        },
        sensitive: false,
        category: 'system.power',
        timeoutMs: 10_000
      },
      handler: async () => actionResult(await env.system.cancelShutdown())
    },
    {
      definition: {
        name: 'set_volume',
        description: 'Ajusta o volume (0-100) e confirma o efeito; pode não ser suportado.',
        parameters: {
          type: 'object',
          properties: {
            level: { type: 'integer', description: 'Volume de 0 a 100.', minimum: 0, maximum: 100 }
          },
          required: ['level'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'system.power',
        timeoutMs: 15_000
      },
      handler: async (args) => actionResult(await env.system.setVolume(Number(args.level)))
    },
    {
      definition: {
        name: 'set_brightness',
        description: 'Ajusta o brilho (0-100) e confirma o efeito; pode não ser suportado.',
        parameters: {
          type: 'object',
          properties: {
            level: { type: 'integer', description: 'Brilho de 0 a 100.', minimum: 0, maximum: 100 }
          },
          required: ['level'],
          additionalProperties: false
        },
        sensitive: false,
        category: 'system.power',
        timeoutMs: 15_000
      },
      handler: async (args) => actionResult(await env.system.setBrightness(Number(args.level)))
    },
    {
      definition: {
        name: 'get_ui_tree',
        description: 'Lê a árvore de controles da janela em primeiro plano (UIAutomation, gated).',
        parameters: {
          type: 'object',
          properties: {
            maxNodes: { type: 'integer', description: 'Limite de nós (até 500).', minimum: 1 }
          },
          required: [],
          additionalProperties: false
        },
        sensitive: true,
        category: 'uia.control',
        timeoutMs: 20_000
      },
      handler: async (args): Promise<UiTreeResult> => {
        const result = await env.uia.getUiTree({
          ...(typeof args.maxNodes === 'number' ? { maxNodes: args.maxNodes } : {})
        })
        if (!result.ok) throw new Error(result.error)
        return result
      }
    },
    {
      definition: {
        name: 'invoke_element',
        description:
          'Aciona um elemento por nome e papel exatos (sem coordenada). Campo de senha é recusado.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nome exato do elemento.', maxLength: 500 },
            role: {
              type: 'string',
              description: 'Papel do controle (button, edit, menu_item, ...).',
              maxLength: 32
            },
            windowTitle: {
              type: 'string',
              description: 'Título exato da janela (opcional).',
              maxLength: 200
            }
          },
          required: ['name', 'role'],
          additionalProperties: false
        },
        sensitive: true,
        category: 'uia.control',
        timeoutMs: 10_000
      },
      handler: async (args): Promise<UiInvokeResult> => {
        const role = String(args.role ?? '')
        if (!(UIA_ROLES as readonly string[]).includes(role)) {
          throw new Error('Papel (role) de UIAutomation inválido.')
        }
        if (!env.limiter.checkUia()) throw new Error('Aguarde 2 s entre ações de UIAutomation.')
        const result = await env.uia.invokeElement({
          name: String(args.name ?? ''),
          role: role as UiRole,
          ...(typeof args.windowTitle === 'string' ? { windowTitle: args.windowTitle } : {})
        })
        if (!result.ok) throw new Error(result.error)
        return result
      }
    }
  ]
}

export function registerActionTools(
  registry: ToolRegistry,
  handlers: Map<string, ToolHandler>,
  entries: ToolEntry[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  for (const entry of entries) {
    const result = registry.registerTool(entry.definition)
    if (!result.ok) {
      errors.push(result.error ?? `falha ao registrar ${entry.definition.name}`)
      continue
    }
    handlers.set(entry.definition.name, entry.handler)
  }
  return { ok: errors.length === 0, errors }
}
