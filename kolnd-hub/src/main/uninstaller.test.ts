import { describe, expect, it, vi } from 'vitest'
import { mapMsiexecExitCode, type MsiexecExitCodeResult } from './uninstaller'

// Evita carregar efeitos colaterais de electron/fs no ambiente de teste node.
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return false
    },
    getPath: () => 'C:\\fake'
  }
}))

vi.mock('child_process', () => ({ execFileSync: vi.fn(), spawn: vi.fn() }))

describe('uninstaller.ts — mapMsiexecExitCode (reexportado da T1)', () => {
  const CASES: Array<[number | null, MsiexecExitCodeResult['kind']]> = [
    [0, 'success'],
    [3010, 'needs-reboot'],
    [1641, 'needs-reboot'],
    [1602, 'cancelled'],
    [1605, 'already-absent'],
    [1612, 'already-absent'],
    [1618, 'other-install'],
    [1500, 'other-install'],
    [1625, 'policy-blocked'],
    [1603, 'fatal'],
    [1604, 'fatal'],
    [1609, 'fatal'],
    [1619, 'fatal'],
    [1638, 'newer-version'],
    [1223, 'uac-denied'],
    [9999, 'unknown'],
    [-1, 'unknown'],
    [null, 'unknown']
  ]

  it.each(CASES)('código %s → kind %s', (code, kind) => {
    expect(mapMsiexecExitCode(code).kind).toBe(kind)
  })

  it('toda mensagem é não-vazia e em pt-BR', () => {
    for (const [code] of CASES) {
      const { message } = mapMsiexecExitCode(code)
      expect(typeof message).toBe('string')
      expect(message.length).toBeGreaterThan(0)
    }
  })

  it('1605 (já ausente) é sucesso idempotente, não erro de sistema', () => {
    const r = mapMsiexecExitCode(1605)
    expect(r.kind).toBe('already-absent')
    expect(r.message).toContain('já não constava como instalado')
  })

  it('1223 (UAC negado) avisa que nada foi removido', () => {
    const r = mapMsiexecExitCode(1223)
    expect(r.kind).toBe('uac-denied')
    expect(r.message).toContain('UAC')
    expect(r.message).toContain('Nada foi removido')
  })

  it('3010/1641 são sucesso com reinício necessário (não erro fatal)', () => {
    expect(mapMsiexecExitCode(3010).kind).toBe('needs-reboot')
    expect(mapMsiexecExitCode(1641).kind).toBe('needs-reboot')
    expect(mapMsiexecExitCode(3010).message).toBe('Reinicie o PC para concluir a remoção.')
    expect(mapMsiexecExitCode(1641).message).toBe('Reinicie o PC para concluir a remoção.')
  })

  it('código desconhecido/null menciona os logs', () => {
    expect(mapMsiexecExitCode(7777).message).toContain('logs')
    expect(mapMsiexecExitCode(null).message).toContain('logs')
  })

  it('1602 (usuário cancelou) é cancelled, não fatal', () => {
    expect(mapMsiexecExitCode(1602).kind).toBe('cancelled')
  })

  it('1638 (versão mais nova) é sucesso parcial', () => {
    expect(mapMsiexecExitCode(1638).kind).toBe('newer-version')
  })
})
