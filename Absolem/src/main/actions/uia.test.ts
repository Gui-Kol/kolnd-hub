import { describe, expect, it, vi } from 'vitest'
import type { PermissionDecision } from '../../shared/permissions'
import { createUiAutomation, mapControlType, type ScriptRunResult } from './uia'

/**
 * UIAutomation (T9) com runner fake: nenhum PowerShell é executado.
 */

function deps(
  options: {
    permission?: PermissionDecision
    run?: () => Promise<ScriptRunResult>
  } = {}
) {
  const runScript = vi.fn<
    (script: string, args: string[], timeoutMs: number) => Promise<ScriptRunResult>
  >(options.run ?? (async () => ({ stdout: '{"nodes":[],"partial":false}', timedOut: false })))
  return {
    runScript,
    automation: createUiAutomation({
      runScript,
      getPermission: () => options.permission ?? 'allow',
      now: () => 10_000
    })
  }
}

describe('UIAutomation', () => {
  it('mapeia controle para role próprio', () => {
    expect(mapControlType('Button')).toBe('button')
    expect(mapControlType('Edit')).toBe('edit')
    expect(mapControlType('ListItem')).toBe('list_item')
    expect(mapControlType('CheckBox')).toBe('checkbox')
    expect(mapControlType('TipoNovo')).toBe('other')
  })

  it('timeout retorna árvore parcial', async () => {
    const { automation, runScript } = deps({
      run: async () => ({
        stdout: JSON.stringify({
          nodes: [
            {
              controlType: 'Button',
              name: 'Salvar',
              enabled: true,
              isPassword: false,
              children: []
            }
          ],
          partial: false
        }),
        timedOut: true
      })
    })

    const result = await automation.getUiTree({ maxNodes: 10 })

    expect(result).toMatchObject({ ok: true, partial: true, nodeCount: 1 })
    expect(result.ok && result.nodes[0]).toMatchObject({ name: 'Salvar', role: 'button' })
    expect(runScript).toHaveBeenCalledTimes(1)
    expect(runScript.mock.calls[0]?.[2]).toBe(10_000)
  })

  it('campo de senha é recusado e o nome não vaza na árvore', async () => {
    const { automation } = deps({
      run: async () => ({ stdout: '{"ok":false,"reason":"password"}', timedOut: false })
    })
    const invoke = await automation.invokeElement({ name: 'Senha', role: 'edit' })
    expect(invoke).toMatchObject({ ok: false, code: 'password' })

    const tree = deps({
      run: async () => ({
        stdout: JSON.stringify({
          nodes: [
            {
              controlType: 'Edit',
              name: 'Senha do usuário',
              enabled: true,
              isPassword: true,
              children: []
            }
          ],
          partial: false
        }),
        timedOut: false
      })
    })
    const treeResult = await tree.automation.getUiTree()
    expect(treeResult.ok && treeResult.nodes[0]).toMatchObject({ isPassword: true, name: '' })
  })

  it('deny não executa nenhum script', async () => {
    const { automation, runScript } = deps({ permission: 'deny' })

    await expect(automation.getUiTree()).resolves.toMatchObject({ ok: false, code: 'denied' })
    await expect(
      automation.invokeElement({ name: 'Salvar', role: 'button' })
    ).resolves.toMatchObject({ ok: false, code: 'denied' })
    expect(runScript).not.toHaveBeenCalled()
  })
})
