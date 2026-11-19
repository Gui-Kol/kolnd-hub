import {
  OFFICE_AGENT_ID_RE,
  OFFICE_DEPARTMENTS_MAX,
  OFFICE_DEPARTMENT_ID_RE,
  OFFICE_DEPARTMENT_MEMBERS_MAX,
  OFFICE_SESSION_ID_RE,
  normalizeOfficeDepartmentName,
  type OfficeAgentStatus,
  type OfficeAvatarLook,
  type OfficeDepartment
} from '../../shared/office'
import { normalizeAvatarLook } from '../../shared/officeAvatar'

/**
 * Regras puras das SALAS-DEPARTAMENTO e da APARÊNCIA do OpenOffice.
 *
 * Nada aqui abre arquivo, lê o relógio ou conhece Electron: o IPC e os testes
 * usam exatamente as mesmas funções. Toda entrada chega como `unknown` porque
 * o renderer pode estar comprometido (AGENTS.md) — ids, nomes e índices de
 * paleta são validados antes de qualquer escrita.
 */

export const DEPARTMENT_NAME_MAX = 24
export const DEPARTMENTS_MAX = OFFICE_DEPARTMENTS_MAX
export const DEPARTMENT_MEMBERS_MAX = OFFICE_DEPARTMENT_MEMBERS_MAX

export interface OfficeDepartmentCreateInput {
  name: string
  agentID: string
}

export interface OfficeDepartmentUpdateInput {
  id: string
  name?: string
  agentID?: string
}

export interface OfficeDepartmentAssignInput {
  sessionID: string
  departmentID: string
  applyRole: boolean
}

export interface OfficeAvatarSaveInput {
  sessionID: string
  look: OfficeAvatarLook
}

/** Alvos de "aplicar função": `working` fica pendente, nunca é interrompido. */
export interface OfficeApplyTargets {
  targetIDs: string[]
  pendingIDs: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

function token(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return pattern.test(trimmed) ? trimmed : null
}

export function isValidDepartmentID(value: unknown): value is string {
  return typeof value === 'string' && OFFICE_DEPARTMENT_ID_RE.test(value)
}

export function isValidSessionID(value: unknown): value is string {
  return typeof value === 'string' && OFFICE_SESSION_ID_RE.test(value)
}

export function isValidAgentID(value: unknown): value is string {
  return typeof value === 'string' && OFFICE_AGENT_ID_RE.test(value)
}

/** `dep_` + 4 bytes em hex (o chamador gera os bytes no main). */
export function departmentIDFromBytes(bytes: readonly number[]): string {
  const hex = bytes
    .slice(0, 4)
    .map((byte) => (byte & 0xff).toString(16).padStart(2, '0'))
    .join('')
  return `dep_${hex}`
}

/** Novo departamento validado; `null` quando algum campo não bate. */
export function buildDepartment(
  id: unknown,
  name: unknown,
  agentID: unknown,
  createdAt: unknown
): OfficeDepartment | null {
  const cleanID = token(id, OFFICE_DEPARTMENT_ID_RE)
  const cleanName = normalizeOfficeDepartmentName(name)
  const cleanAgent = token(agentID, OFFICE_AGENT_ID_RE)
  const at =
    typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0
      ? Math.trunc(createdAt)
      : null
  if (!cleanID || !cleanName || !cleanAgent || at === null) return null
  return { id: cleanID, name: cleanName, agentID: cleanAgent, sessionIDs: [], createdAt: at }
}

export function normalizeDepartmentCreateInput(input: unknown): OfficeDepartmentCreateInput | null {
  if (!isRecord(input) || !onlyKeys(input, ['name', 'agentID'])) return null
  const name = normalizeOfficeDepartmentName(input.name)
  const agentID = token(input.agentID, OFFICE_AGENT_ID_RE)
  return name && agentID ? { name, agentID } : null
}

export function normalizeDepartmentUpdateInput(input: unknown): OfficeDepartmentUpdateInput | null {
  if (!isRecord(input) || !onlyKeys(input, ['id', 'name', 'agentID'])) return null
  const id = token(input.id, OFFICE_DEPARTMENT_ID_RE)
  if (!id) return null
  const hasName = input.name !== undefined
  const hasAgent = input.agentID !== undefined
  if (!hasName && !hasAgent) return null

  const name = hasName ? normalizeOfficeDepartmentName(input.name) : undefined
  if (hasName && !name) return null
  const agentID = hasAgent ? token(input.agentID, OFFICE_AGENT_ID_RE) : undefined
  if (hasAgent && !agentID) return null
  return {
    id,
    ...(name ? { name } : {}),
    ...(agentID ? { agentID } : {})
  }
}

/** `{ id }` de uma sala (excluir, aplicar função). */
export function normalizeDepartmentIdInput(input: unknown): { id: string } | null {
  if (!isRecord(input) || !onlyKeys(input, ['id'])) return null
  const id = token(input.id, OFFICE_DEPARTMENT_ID_RE)
  return id ? { id } : null
}

export function normalizeDepartmentAssignInput(input: unknown): OfficeDepartmentAssignInput | null {
  if (!isRecord(input) || !onlyKeys(input, ['sessionID', 'departmentID', 'applyRole'])) {
    return null
  }
  const sessionID = token(input.sessionID, OFFICE_SESSION_ID_RE)
  const departmentID = token(input.departmentID, OFFICE_DEPARTMENT_ID_RE)
  if (!sessionID || !departmentID || typeof input.applyRole !== 'boolean') return null
  return { sessionID, departmentID, applyRole: input.applyRole }
}

/** `{ sessionID }` para devolver o funcionário à sala "Sem sala". */
export function normalizeDepartmentUnassignInput(input: unknown): { sessionID: string } | null {
  if (!isRecord(input) || !onlyKeys(input, ['sessionID'])) return null
  const sessionID = token(input.sessionID, OFFICE_SESSION_ID_RE)
  return sessionID ? { sessionID } : null
}

/** `{ sessionID }` da aparência (leitura). */
export function normalizeAvatarGetInput(input: unknown): { sessionID: string } | null {
  return normalizeDepartmentUnassignInput(input)
}

/** `{ sessionID, look }` da aparência (escrita); índices validados por paleta. */
export function normalizeAvatarSaveInput(input: unknown): OfficeAvatarSaveInput | null {
  if (!isRecord(input) || !onlyKeys(input, ['sessionID', 'look'])) return null
  const sessionID = token(input.sessionID, OFFICE_SESSION_ID_RE)
  const look = normalizeAvatarLook(input.look)
  return sessionID && look ? { sessionID, look } : null
}

export function findDepartment(
  departments: readonly OfficeDepartment[],
  id: string
): OfficeDepartment | null {
  return departments.find((department) => department.id === id) ?? null
}

/** Sala atual da sessão (a primeira que a lista) ou `null` = "Sem sala". */
export function departmentForSession(
  departments: readonly OfficeDepartment[],
  sessionID: string
): OfficeDepartment | null {
  return departments.find((department) => department.sessionIDs.includes(sessionID)) ?? null
}

export function canAddDepartment(departments: readonly OfficeDepartment[]): boolean {
  return departments.length < DEPARTMENTS_MAX
}

/** Nome já usado por OUTRA sala? (case-insensitive, pt-BR). */
export function isDepartmentNameTaken(
  departments: readonly OfficeDepartment[],
  name: string,
  exceptID?: string
): boolean {
  const key = name.trim().toLocaleLowerCase('pt-BR')
  return departments.some(
    (department) =>
      department.id !== exceptID && department.name.trim().toLocaleLowerCase('pt-BR') === key
  )
}

/**
 * Designa a sessão para a sala, removendo-a de qualquer outra. Devolve `null`
 * quando a sala não existe ou já atingiu o teto de membros. Nunca muta a
 * entrada — o IPC grava o resultado.
 */
export function assignSession(
  departments: readonly OfficeDepartment[],
  sessionID: string,
  departmentID: string
): OfficeDepartment[] | null {
  const target = findDepartment(departments, departmentID)
  if (!target) return null
  const alreadyInTargetOnly =
    target.sessionIDs.includes(sessionID) &&
    !departments.some(
      (department) => department.id !== departmentID && department.sessionIDs.includes(sessionID)
    )
  if (alreadyInTargetOnly) return departments.map((department) => ({ ...department }))
  if (
    !target.sessionIDs.includes(sessionID) &&
    target.sessionIDs.length >= DEPARTMENT_MEMBERS_MAX
  ) {
    return null
  }

  return departments.map((department) => {
    const sessionIDs = department.sessionIDs.filter((entry) => entry !== sessionID)
    if (department.id === departmentID) sessionIDs.push(sessionID)
    return { ...department, sessionIDs }
  })
}

/** Remove a sessão de todas as salas (volta para "Sem sala"). */
export function unassignSession(
  departments: readonly OfficeDepartment[],
  sessionID: string
): OfficeDepartment[] {
  return departments.map((department) => ({
    ...department,
    sessionIDs: department.sessionIDs.filter((entry) => entry !== sessionID)
  }))
}

/** Renomeia/troca a função. Não aplica nada no OpenCode (decisão da UI). */
export function updateDepartment(
  departments: readonly OfficeDepartment[],
  input: OfficeDepartmentUpdateInput
): OfficeDepartment[] | null {
  if (!findDepartment(departments, input.id)) return null
  return departments.map((department) =>
    department.id === input.id
      ? {
          ...department,
          ...(input.name ? { name: input.name } : {}),
          ...(input.agentID ? { agentID: input.agentID } : {})
        }
      : { ...department }
  )
}

/** Exclui a sala e devolve a lista de membros liberados (voltam a "Sem sala"). */
export function deleteDepartment(
  departments: readonly OfficeDepartment[],
  id: string
): { departments: OfficeDepartment[]; released: string[] } | null {
  const target = findDepartment(departments, id)
  if (!target) return null
  return {
    departments: departments.filter((department) => department.id !== id).map((d) => ({ ...d })),
    released: [...target.sessionIDs]
  }
}

/**
 * Separa quem pode receber a função agora de quem está `working` (fica
 * pendente). Sessões da sala que não estão no snapshot são ignoradas — a
 * sessão pode ter sido arquivada e não deve receber PATCH às cegas.
 */
export function pickApplyTargets(
  department: Pick<OfficeDepartment, 'sessionIDs'>,
  agents: readonly Pick<{ sessionID: string; status: OfficeAgentStatus }, 'sessionID' | 'status'>[]
): OfficeApplyTargets {
  const statusByID = new Map<string, OfficeAgentStatus>()
  for (const agent of agents) statusByID.set(agent.sessionID, agent.status)

  const targetIDs: string[] = []
  const pendingIDs: string[] = []
  const seen = new Set<string>()
  for (const sessionID of department.sessionIDs) {
    if (seen.has(sessionID)) continue
    seen.add(sessionID)
    const status = statusByID.get(sessionID)
    if (!status) continue
    if (status === 'working') pendingIDs.push(sessionID)
    else targetIDs.push(sessionID)
  }
  return { targetIDs, pendingIDs }
}
