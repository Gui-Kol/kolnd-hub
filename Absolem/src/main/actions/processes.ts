/**
 * Listar e fechar processos (task 08, T3).
 *
 * - `tasklist /FO CSV /NH` com parser próprio para vírgulas entre aspas;
 * - `taskkill /PID <pid>` SEM `/F`; se o processo sobreviver 5 s, o chamador
 *   oferece `/T /F` com confirmação explícita;
 * - blocklist de sistema recusa sempre, antes de qualquer comando.
 *
 * Tudo recebe `run` injetado: nenhum teste executa `tasklist`/`taskkill`.
 */

export interface ProcessInfo {
  name: string
  pid: number
  sessionName: string
  memKB: number
}

export interface RunResult {
  code: number
  stdout: string
  stderr?: string
}

export interface ProcessDeps {
  run: (file: string, args: string[]) => Promise<RunResult>
  wait?: (ms: number) => Promise<void>
}

export type CloseProcessResult =
  | { ok: true; pid: number; forced: boolean }
  | {
      ok: false
      pid: number
      error: string
      reason: 'not-found' | 'blocked' | 'failed' | 'still-running'
      canForce?: boolean
    }

export const SYSTEM_PROCESS_BLOCKLIST = [
  'explorer.exe',
  'winlogon.exe',
  'csrss.exe',
  'services.exe',
  'lsass.exe',
  'dwm.exe'
] as const

export const MAX_PROCESS_ROWS = 500
const MAX_PID = 4_294_967_295
const CLOSE_TIMEOUT_MS = 5_000
const CLOSE_INTERVAL_MS = 500

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Uma linha CSV com aspas, vírgulas e aspas duplicadas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

/** Converte a saída de `tasklist /FO CSV /NH`; ignora linhas inválidas. */
export function parseTasklistCsv(text: string): ProcessInfo[] {
  const result: ProcessInfo[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const fields = parseCsvLine(line)
    if (fields.length < 5) continue
    const pid = Number(fields[1])
    if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) continue
    const memKB = Number(fields[4].replace(/[^\d]/g, ''))
    result.push({
      name: fields[0].trim(),
      pid,
      sessionName: fields[2].trim(),
      memKB: Number.isFinite(memKB) ? memKB : 0
    })
    if (result.length >= MAX_PROCESS_ROWS) break
  }
  return result
}

export async function listProcesses(deps: ProcessDeps): Promise<ProcessInfo[]> {
  const result = await deps.run('tasklist.exe', ['/FO', 'CSV', '/NH'])
  if (result.code !== 0) return []
  return parseTasklistCsv(result.stdout)
}

async function findByPid(deps: ProcessDeps, pid: number): Promise<ProcessInfo | null> {
  const result = await deps.run('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  if (result.code !== 0) return null
  return parseTasklistCsv(result.stdout).find((process) => process.pid === pid) ?? null
}

export function isBlockedProcess(process: Pick<ProcessInfo, 'name' | 'sessionName'>): boolean {
  const name = process.name.trim().toLowerCase()
  const session = process.sessionName.trim().toLowerCase()
  return session === 'services' || (SYSTEM_PROCESS_BLOCKLIST as readonly string[]).includes(name)
}

/**
 * Fecha sem `/F`. `force:true` (somente após confirmação explícita do usuário)
 * acrescenta `/T /F`. Nunca fecha processo de sistema.
 */
export async function closeProcess(
  deps: ProcessDeps,
  pid: number,
  options: { force?: boolean } = {}
): Promise<CloseProcessResult> {
  if (!Number.isInteger(pid) || pid <= 0 || pid > MAX_PID) {
    return { ok: false, pid, reason: 'not-found', error: 'PID inválido.' }
  }
  const process = await findByPid(deps, pid)
  if (!process) {
    return { ok: false, pid, reason: 'not-found', error: `Processo ${pid} não encontrado.` }
  }
  if (isBlockedProcess(process)) {
    return {
      ok: false,
      pid,
      reason: 'blocked',
      error: `Recuso encerrar ${process.name}: processo essencial do Windows.`
    }
  }

  const force = options.force === true
  const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid)]
  const kill = await deps.run('taskkill.exe', args)
  if (kill.code !== 0) {
    return {
      ok: false,
      pid,
      reason: 'failed',
      error: `O Windows não encerrou ${process.name} (taskkill código ${kill.code}).`,
      canForce: !force
    }
  }

  const wait = deps.wait ?? defaultWait
  const attempts = Math.ceil(CLOSE_TIMEOUT_MS / CLOSE_INTERVAL_MS) + 1
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const alive = await findByPid(deps, pid)
    if (!alive) return { ok: true, pid, forced: force }
    await wait(CLOSE_INTERVAL_MS)
  }

  return {
    ok: false,
    pid,
    reason: 'still-running',
    error: force
      ? `${process.name} continua em execução mesmo após forçar o encerramento.`
      : `${process.name} não fechou em 5 s. Posso forçar o encerramento com confirmação.`,
    canForce: !force
  }
}
