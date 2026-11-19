import { describe, expect, it } from 'vitest'
import type { OfficeDepartment } from '../../shared/office'
import {
  assignSession,
  buildDepartment,
  canAddDepartment,
  deleteDepartment,
  departmentForSession,
  departmentIDFromBytes,
  findDepartment,
  isDepartmentNameTaken,
  normalizeAvatarGetInput,
  normalizeAvatarSaveInput,
  normalizeDepartmentAssignInput,
  normalizeDepartmentCreateInput,
  normalizeDepartmentIdInput,
  normalizeDepartmentUnassignInput,
  normalizeDepartmentUpdateInput,
  pickApplyTargets,
  unassignSession,
  updateDepartment
} from './departments'

const LOOK = { sex: 'feminino' as const, hairStyle: 1, hairColor: 2, skin: 3, shirt: 4, pants: 5 }

function department(overrides: Partial<OfficeDepartment> = {}): OfficeDepartment {
  return {
    id: 'dep_1a2b3c4d',
    name: 'Gerentes',
    agentID: 'build',
    sessionIDs: ['ses_1'],
    createdAt: 1_795_000_000_000,
    ...overrides
  }
}

describe('ids e construção de departamento', () => {
  it('gera o id no formato dep_<8 hex>', () => {
    expect(departmentIDFromBytes([0xde, 0xad, 0xbe, 0xef])).toBe('dep_deadbeef')
    expect(departmentIDFromBytes([0, 1, 15, 255])).toBe('dep_00010fff')
  })

  it('buildDepartment valida id/nome/função/data', () => {
    expect(buildDepartment('dep_deadbeef', ' Build ', 'build', 1234)).toEqual({
      id: 'dep_deadbeef',
      name: 'Build',
      agentID: 'build',
      sessionIDs: [],
      createdAt: 1234
    })
    expect(buildDepartment('dep_xyz', 'Build', 'build', 1234)).toBeNull()
    expect(buildDepartment('dep_deadbeef', '', 'build', 1234)).toBeNull()
    expect(buildDepartment('dep_deadbeef', 'Build', 'a b', 1234)).toBeNull()
    expect(buildDepartment('dep_deadbeef', 'Build', 'build', 0)).toBeNull()
  })
})

describe('validação das entradas do IPC', () => {
  it('criar: exige somente name/agentID válidos', () => {
    expect(normalizeDepartmentCreateInput({ name: '  Gerentes  ', agentID: 'plan' })).toEqual({
      name: 'Gerentes',
      agentID: 'plan'
    })
    expect(normalizeDepartmentCreateInput({ name: 'x'.repeat(25), agentID: 'plan' })).toBeNull()
    expect(normalizeDepartmentCreateInput({ name: 'ok', agentID: '' })).toBeNull()
    expect(normalizeDepartmentCreateInput({ name: 'ok', agentID: 'plan', extra: 1 })).toBeNull()
    expect(normalizeDepartmentCreateInput(null)).toBeNull()
  })

  it('editar: exige id e pelo menos um campo válido', () => {
    expect(normalizeDepartmentUpdateInput({ id: 'dep_1a2b3c4d', name: 'Build' })).toEqual({
      id: 'dep_1a2b3c4d',
      name: 'Build'
    })
    expect(normalizeDepartmentUpdateInput({ id: 'dep_1a2b3c4d', agentID: 'plan' })).toEqual({
      id: 'dep_1a2b3c4d',
      agentID: 'plan'
    })
    expect(normalizeDepartmentUpdateInput({ id: 'dep_1a2b3c4d' })).toBeNull()
    expect(normalizeDepartmentUpdateInput({ id: 'dep_1a2b3c4d', name: '' })).toBeNull()
    expect(normalizeDepartmentUpdateInput({ id: 'nope', name: 'x' })).toBeNull()
  })

  it('id, designação, remoção e aparência', () => {
    expect(normalizeDepartmentIdInput({ id: 'dep_1a2b3c4d' })).toEqual({ id: 'dep_1a2b3c4d' })
    expect(normalizeDepartmentIdInput({ id: 'dep_1a2b3c4d', extra: true })).toBeNull()
    expect(normalizeDepartmentIdInput({ id: 'dep_1A2B3C4D' })).toBeNull()

    expect(
      normalizeDepartmentAssignInput({
        sessionID: 'ses_1',
        departmentID: 'dep_1a2b3c4d',
        applyRole: true
      })
    ).toEqual({ sessionID: 'ses_1', departmentID: 'dep_1a2b3c4d', applyRole: true })
    expect(
      normalizeDepartmentAssignInput({
        sessionID: 'ses_1',
        departmentID: 'dep_1a2b3c4d',
        applyRole: 'sim'
      })
    ).toBeNull()

    expect(normalizeDepartmentUnassignInput({ sessionID: 'ses_1' })).toEqual({ sessionID: 'ses_1' })
    expect(normalizeDepartmentUnassignInput({ sessionID: 'nope' })).toBeNull()
    expect(normalizeAvatarGetInput({ sessionID: 'ses_1' })).toEqual({ sessionID: 'ses_1' })
    expect(normalizeAvatarSaveInput({ sessionID: 'ses_1', look: LOOK })).toEqual({
      sessionID: 'ses_1',
      look: LOOK
    })
    expect(
      normalizeAvatarSaveInput({ sessionID: 'ses_1', look: { ...LOOK, hairStyle: 99 } })
    ).toBeNull()
  })
})

describe('designação e aplicação da função', () => {
  it('designa, movendo a sessão de qualquer outra sala', () => {
    const departments = [
      department({ id: 'dep_aaaaaaaa', name: 'A' }),
      department({ id: 'dep_bbbbbbbb', name: 'B', sessionIDs: [] })
    ]
    const next = assignSession(departments, 'ses_1', 'dep_bbbbbbbb')
    expect(next?.find((entry) => entry.id === 'dep_aaaaaaaa')?.sessionIDs).toEqual([])
    expect(next?.find((entry) => entry.id === 'dep_bbbbbbbb')?.sessionIDs).toEqual(['ses_1'])
    // Entrada original não muda (função pura).
    expect(departments[0].sessionIDs).toEqual(['ses_1'])
  })

  it('devolve null para sala inexistente ou cheia e é no-op quando já está na sala', () => {
    expect(assignSession([department()], 'ses_2', 'dep_ffffffff')).toBeNull()

    const full = department({
      sessionIDs: Array.from({ length: 60 }, (_, index) => `ses_${index}`)
    })
    expect(assignSession([full], 'ses_nova', 'dep_1a2b3c4d')).toBeNull()

    const same = assignSession([department()], 'ses_1', 'dep_1a2b3c4d')
    expect(same?.[0].sessionIDs).toEqual(['ses_1'])
  })

  it('remove a sessão de todas as salas', () => {
    const departments = [
      department(),
      department({ id: 'dep_0000face', name: 'B', sessionIDs: ['ses_1', 'ses_2'] })
    ]
    expect(unassignSession(departments, 'ses_1').map((entry) => entry.sessionIDs)).toEqual([
      [],
      ['ses_2']
    ])
  })

  it('edita/exclui e informa os membros liberados', () => {
    const departments = [department(), department({ id: 'dep_0000face', name: 'B' })]
    const updated = updateDepartment(departments, {
      id: 'dep_1a2b3c4d',
      name: 'Novo nome',
      agentID: 'plan'
    })
    expect(updated?.[0]).toMatchObject({ name: 'Novo nome', agentID: 'plan' })
    expect(updateDepartment(departments, { id: 'dep_ffffffff', name: 'X' })).toBeNull()

    const removed = deleteDepartment(departments, 'dep_1a2b3c4d')
    expect(removed?.departments.map((entry) => entry.id)).toEqual(['dep_0000face'])
    expect(removed?.released).toEqual(['ses_1'])
    expect(deleteDepartment(departments, 'dep_ffffffff')).toBeNull()
  })

  it('aplica em todos menos quem trabalha (fica pendente)', () => {
    const target = department({
      sessionIDs: ['ses_work', 'ses_idle', 'ses_fora_do_snapshot', 'ses_ended']
    })
    const targets = pickApplyTargets(target, [
      { sessionID: 'ses_work', status: 'working' },
      { sessionID: 'ses_idle', status: 'idle' },
      { sessionID: 'ses_ended', status: 'ended' }
    ])
    expect(targets).toEqual({
      targetIDs: ['ses_idle', 'ses_ended'],
      pendingIDs: ['ses_work']
    })
  })

  it('busca por sala/sessão, limite e nome duplicado', () => {
    const departments = [
      department(),
      department({ id: 'dep_0000face', name: 'Build', sessionIDs: [] })
    ]
    expect(findDepartment(departments, 'dep_0000face')?.name).toBe('Build')
    expect(findDepartment(departments, 'dep_ffffffff')).toBeNull()
    expect(departmentForSession(departments, 'ses_1')?.id).toBe('dep_1a2b3c4d')
    expect(departmentForSession(departments, 'ses_9')).toBeNull()
    expect(isDepartmentNameTaken(departments, '  gerentes ')).toBe(true)
    expect(isDepartmentNameTaken(departments, 'Gerentes', 'dep_1a2b3c4d')).toBe(false)

    expect(canAddDepartment(Array.from({ length: 29 }, () => department()))).toBe(true)
    expect(canAddDepartment(Array.from({ length: 30 }, () => department()))).toBe(false)
  })
})
