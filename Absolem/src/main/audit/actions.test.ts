import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createActionAuditWriter,
  createActionLimiter,
  createActionPermissionGate,
  sanitizeSafeArgs,
  setPaused,
  type PermissionStoreLike
} from './actions'
import type { PermissionsState } from '../../shared/permissions'

/**
 * Auditoria (T10) em diretório temporário. Nenhuma ação real é executada.
 */

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'absolem-audit-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function event(index: number, safeArgs: Record<string, unknown> = { path: 'C:\\Docs\\a.txt' }) {
  return {
    at: new Date(Date.UTC(2026, 10, 26, 12, 0, index)).toISOString(),
    tool: 'open_app',
    category: 'apps.launch',
    argsHash: `hash-${index}`,
    safeArgs,
    decision: 'allow',
    ok: true,
    durationMs: 1
  }
}

function permissions(paused = false): PermissionsState {
  return {
    microphone: false,
    paused,
    categories: {
      'apps.launch': 'ask',
      'apps.close': 'ask',
      'files.read': 'ask',
      'files.write': 'ask',
      'system.power': 'deny',
      'uia.control': 'deny',
      'web.search': 'allow'
    }
  }
}

describe('auditoria de ações', () => {
  it('rotaciona em 5 MB x 2 (aqui com limite pequeno)', () => {
    const dir = tempDir()
    const writer = createActionAuditWriter({ dir, maxBytes: 220 })

    for (let index = 0; index < 5; index += 1) {
      expect(writer.write(event(index))).toBe(true)
    }

    expect(existsSync(writer.path)).toBe(true)
    expect(existsSync(join(dir, 'actions.1.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'actions.2.jsonl'))).toBe(true)
    expect(existsSync(join(dir, 'actions.3.jsonl'))).toBe(false)
  })

  it('não grava conteúdo de arquivo, chave nem transcrição', () => {
    const dir = tempDir()
    const writer = createActionAuditWriter({ dir })
    const safeArgs = sanitizeSafeArgs({
      path: 'C:\\Docs\\nota.md',
      content: 'SEGREDO-DO-ARQUIVO',
      text: 'TRANSCRICAO-INTEIRA',
      apiKey: 'AIza-CHAVE-SECRETA',
      query: 'nota'
    })

    writer.write({ ...event(0, safeArgs), tool: 'read_file', category: 'files.read' })

    const text = readFileSync(writer.path, 'utf8')
    expect(text).toContain('C:\\\\Docs\\\\nota.md')
    expect(text).toContain('"query":"nota"')
    expect(text).not.toContain('SEGREDO-DO-ARQUIVO')
    expect(text).not.toContain('TRANSCRICAO-INTEIRA')
    expect(text).not.toContain('AIza-CHAVE-SECRETA')
    expect(text).not.toContain('"content"')
    expect(text).not.toContain('"apiKey"')
  })

  it('limita a 5 aberturas de app por minuto', () => {
    let instant = 1_000
    const limiter = createActionLimiter({ now: () => instant })

    for (let index = 0; index < 5; index += 1) {
      expect(limiter.checkAppLaunch()).toBe(true)
    }
    expect(limiter.checkAppLaunch()).toBe(false)
    expect(limiter.snapshot()).toEqual({ appLaunchesLastMinute: 5 })

    instant += 60_001
    expect(limiter.checkAppLaunch()).toBe(true)
    expect(limiter.checkFileOps(10)).toBe(true)
    expect(limiter.checkFileOps(11)).toBe(false)
    expect(limiter.checkUia()).toBe(true)
    expect(limiter.checkUia()).toBe(false)
  })

  it('pausa bloqueia tudo antes de qualquer confirmação', () => {
    const store: PermissionStoreLike = {
      read: () => permissions(true),
      write: () => ({ success: true })
    }
    const gate = createActionPermissionGate(store)

    expect(gate('apps.launch')).toBe('deny')
    expect(gate('files.read')).toBe('deny')
    expect(gate('system.power')).toBe('deny')
    expect(gate('screen')).toBe('deny')
    expect(gate('web.search')).toBe('deny')

    const running = createActionPermissionGate({
      read: () => permissions(false),
      write: () => ({ success: true })
    })
    expect(running('web.search')).toBe('allow')
    expect(running('apps.launch')).toBe('ask')
    expect(running('system.power')).toBe('deny')
  })

  it('pausa é persistida no store', () => {
    let current = permissions(false)
    const store: PermissionStoreLike = {
      read: () => current,
      write: (next) => {
        current = next
        return { success: true }
      }
    }

    expect(setPaused(store, true)).toEqual({ ok: true })
    expect(store.read().paused).toBe(true)
    expect(setPaused(store, false)).toEqual({ ok: true })
    expect(store.read().paused).toBe(false)

    const failing: PermissionStoreLike = {
      read: () => current,
      write: () => ({ success: false, error: 'disco cheio' })
    }
    expect(setPaused(failing, true)).toEqual({ ok: false, error: 'disco cheio' })
  })
})
