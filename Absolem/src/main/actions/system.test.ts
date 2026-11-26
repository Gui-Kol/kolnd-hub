import { describe, expect, it, vi } from 'vitest'
import type { PermissionDecision } from '../../shared/permissions'
import { createSystemActions, type SystemDeps, type SystemRunResult } from './system'

/**
 * Ações de sistema (T7) com runner fake: nenhum `shutdown`, `rundll32` ou
 * PowerShell real é executado.
 */

function createDeps(
  options: {
    permission?: PermissionDecision
    run?: (file: string, args: string[]) => Promise<SystemRunResult>
  } = {}
) {
  const calls: Array<{ file: string; args: string[] }> = []
  const notify = vi.fn()
  const run = vi.fn(async (file: string, args: string[]) => {
    calls.push({ file, args })
    if (options.run) return options.run(file, args)
    return { code: 0, stdout: '' }
  })
  const deps: SystemDeps = {
    run,
    getPermission: () => options.permission ?? 'allow',
    notify
  }
  return { deps, calls, notify, run }
}

describe('ações de sistema', () => {
  it('shutdown usa /t 60 /c Absolem e avisa', async () => {
    const { deps, calls, notify } = createDeps()
    const actions = createSystemActions(deps)

    const result = await actions.shutdown()

    expect(result).toEqual({ ok: true, seconds: 60, cancelable: true })
    expect(calls).toEqual([{ file: 'shutdown.exe', args: ['/s', '/t', '60', '/c', 'Absolem'] }])
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('60 s'))

    const restart = await actions.restart()
    expect(restart).toMatchObject({ ok: true, seconds: 60 })
    expect(calls[1]).toEqual({
      file: 'shutdown.exe',
      args: ['/r', '/t', '60', '/c', 'Absolem']
    })
  })

  it('cancelar desligamento usa /a', async () => {
    const { deps, calls, notify } = createDeps()
    const actions = createSystemActions(deps)

    const result = await actions.cancelShutdown()

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([{ file: 'shutdown.exe', args: ['/a'] }])
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('cancelado'))
  })

  it('power exige permissão allow e não executa nada quando deny', async () => {
    const { deps, calls, notify } = createDeps({ permission: 'deny' })
    const actions = createSystemActions(deps)

    await expect(actions.shutdown()).resolves.toMatchObject({ ok: false, code: 'denied' })
    await expect(actions.restart()).resolves.toMatchObject({ ok: false, code: 'denied' })
    await expect(actions.cancelShutdown()).resolves.toMatchObject({ ok: false, code: 'denied' })
    await expect(actions.lock()).resolves.toMatchObject({ ok: false, code: 'denied' })
    await expect(actions.setVolume(20)).resolves.toMatchObject({ ok: false, code: 'denied' })

    expect(calls).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('verificação de volume/brilho falha vira unsupported', async () => {
    const unsupported = createDeps({
      run: async () => ({ code: 0, stdout: '{"supported":false}' })
    })
    const actions = createSystemActions(unsupported.deps)

    const volume = await actions.setVolume(20)
    expect(volume).toMatchObject({ ok: false, code: 'unsupported' })
    expect(volume.ok === false && volume.error).toContain('não suportado neste equipamento')

    const brightness = await actions.setBrightness(50)
    expect(brightness).toMatchObject({ ok: false, code: 'unsupported' })

    // Sem verificação do efeito (valor diferente do pedido) também é unsupported.
    const drifted = createDeps({
      run: async () => ({ code: 0, stdout: '{"supported":true,"value":10}' })
    })
    const driftedActions = createSystemActions(drifted.deps)
    await expect(driftedActions.setVolume(80)).resolves.toMatchObject({
      ok: false,
      code: 'unsupported'
    })

    // Com leitura confirmada, o sucesso é reportado.
    const verified = createDeps({
      run: async () => ({ code: 0, stdout: '{"supported":true,"value":79}' })
    })
    await expect(createSystemActions(verified.deps).setVolume(80)).resolves.toEqual({
      ok: true,
      level: 79
    })
  })
})
