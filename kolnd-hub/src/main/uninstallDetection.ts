import { app } from 'electron'
import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { findKloudGamesExe } from './kloudGames'

/**
 * Detecção "pura" (só leitura) para os fluxos de desinstalação do Kloud Games
 * e do Kolnd Hub: entradas de desinstalação no registro, estado do serviço
 * KLOUD_GAMESsvc e disponibilidade do desinstalador do Hub.
 *
 * Nada aqui apaga arquivo, altera registro ou eleva processos — remoção é a T2.
 * Todas as funções públicas são tolerantes: falha/acesso negado/JSON inválido
 * nunca lança, apenas devolve `null`/`missing`/lista vazia.
 */

export interface UninstallEntry {
  /** GUID do produto MSI (com chaves), extraído do UninstallString; null quando não é MSI. */
  productCode: string | null
  /** UninstallString com as aspas externas removidas (ex.: `MsiExec.exe /I{GUID}` ou o caminho do .exe NSIS). */
  uninstallString: string
  displayName: string
  displayVersion?: string
  installLocation?: string
  publisher?: string
  /** Onde a entrada foi encontrada: HKLM (machine), HKCU (user) ou ambos. */
  scope: 'machine' | 'user' | 'both' | 'unknown'
}

/**
 * Classifica o motivo exato de uma detecção `partial` (função pura).
 *
 * - 'registry-orphan': registro consta, executável não foi encontrado
 *   (desinstalação pelo registro ainda é possível);
 * - 'exe-orphan': executável existe, registro não consta
 *   (msiexec não é possível — só remoção manual dos arquivos);
 * - 'service-orphan': nem exe nem registro, só o serviço KLOUD_GAMESsvc restou.
 *
 * Retorna null quando não é um `partial` reconhecido.
 */
export type KloudGamesPartialKind = 'registry-orphan' | 'exe-orphan' | 'service-orphan'

export function classifyKloudGamesPartial(
  detection: Pick<KloudGamesDetection, 'status' | 'exePath' | 'entry' | 'service'>
): KloudGamesPartialKind | null {
  if (detection.status !== 'partial') return null
  if (detection.exePath) return 'exe-orphan'
  if (detection.entry) return 'registry-orphan'
  if (detection.service !== 'missing') return 'service-orphan'
  return null
}

export type ServiceStatus = 'running' | 'stopped' | 'missing'

export interface KloudGamesDetection {
  /**
   * installed = exe + registro presentes;
   * partial   = instalação quebrada (exe órfão sem registro, registro sem exe, ou só o serviço órfão);
   * missing   = nada encontrado (nem exe, nem registro, nem serviço).
   */
  status: 'installed' | 'partial' | 'missing'
  exePath: string | null
  service: ServiceStatus
  entry: UninstallEntry | null
}

export interface HubUninstallDetection {
  available: boolean
  uninstallerPath: string | null
  source: 'default-path' | 'registry' | null
  entry: UninstallEntry | null
}

export type MsiexecExitCodeKind =
  | 'success'
  | 'cancelled'
  | 'already-absent'
  | 'needs-reboot'
  | 'other-install'
  | 'policy-blocked'
  | 'fatal'
  | 'uac-denied'
  | 'newer-version'
  | 'unknown'

export interface MsiexecExitCodeResult {
  kind: MsiexecExitCodeKind
  /** Mensagem amigável (pt-BR) pronta para exibir ao usuário. */
  message: string
}

const SERVICE_NAME = 'KLOUD_GAMESsvc'

/** Chaves de desinstalação consultadas (Get-ItemProperty ... | Select-Object ... | ConvertTo-Json). */
const UNINSTALL_HIVES: ReadonlyArray<{ psPath: string; scope: 'machine' | 'user' }> = [
  {
    psPath: 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    scope: 'machine'
  },
  {
    psPath: 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    scope: 'machine'
  },
  {
    psPath: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    scope: 'user'
  }
]

type UninstallMatchKind = 'kloud' | 'hub'

/** Interno: classifica o DisplayName. Kloud Games ~ /KLOUD[\s_-]?GAMES/i; Hub é exatamente "Kolnd Hub". */
function matchKind(displayName: string): UninstallMatchKind | null {
  if (/KLOUD[\s_-]?GAMES/i.test(displayName)) return 'kloud'
  if (/^Kolnd Hub$/i.test(displayName.trim())) return 'hub'
  return null
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** Remove aspas externas de um caminho ("..." → ...). */
function dequote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

/** Em strings de MSI ("...msiexec..."), extrai o {GUID} do produto. */
function extractProductCode(uninstallString: string): string | null {
  if (!/msiexec/i.test(uninstallString)) return null
  const match = uninstallString.match(/\{[0-9A-Fa-f-]{36}\}/)
  return match ? match[0].toUpperCase() : null
}

function toUninstallEntry(item: unknown): UninstallEntry | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const record = item as Record<string, unknown>

  const displayName = stringOrUndefined(record.DisplayName)
  if (!displayName || matchKind(displayName) === null) return null

  const rawUninstallString = stringOrUndefined(record.UninstallString)
  if (!rawUninstallString) {
    // Sem UninstallString não há como desinstalar via CLI — ignora a entrada.
    return null
  }

  const uninstallString = dequote(rawUninstallString)
  const entry: UninstallEntry = {
    productCode: extractProductCode(uninstallString),
    uninstallString,
    displayName,
    scope: 'unknown'
  }

  const displayVersion = stringOrUndefined(record.DisplayVersion)
  const installLocation = stringOrUndefined(record.InstallLocation)
  const publisher = stringOrUndefined(record.Publisher)
  if (displayVersion) entry.displayVersion = displayVersion
  if (installLocation) entry.installLocation = installLocation
  if (publisher) entry.publisher = publisher

  return entry
}

/**
 * Parse tolerante da saída de `Get-ItemProperty ... | ConvertTo-Json -Compress`.
 *
 * ConvertTo-Json devolve um ARRAY quando há várias entradas, um OBJETO ÚNICO
 * quando há só uma e NADA quando não há nenhuma — e o processo pode perder a
 * conexão (JSON truncado). Nada disso pode lançar; cada item inválido é
 * simplesmente descartado. Entradas de outros programas são filtradas.
 */
export function parseUninstallEntries(json: string): UninstallEntry[] {
  const raw = (json ?? '').replace(/^\uFEFF/, '').trim()
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.warn(
      '[uninstall-detection] JSON do registro inválido/corrompido — ignorando:',
      err instanceof Error ? err.message : err
    )
    return []
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
  const entries: UninstallEntry[] = []
  for (const item of items) {
    const entry = toUninstallEntry(item)
    if (entry) entries.push(entry)
  }
  return entries
}

/** Consulta uma chave de desinstalação via PowerShell. Falha/acesso negado → null. */
function queryUninstallHive(psPath: string): UninstallEntry[] | null {
  try {
    const command = `Get-ItemProperty '${psPath}\\*' -ErrorAction SilentlyContinue | Select-Object DisplayName,DisplayVersion,Publisher,InstallLocation,UninstallString | ConvertTo-Json -Compress`
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024
    })
    return parseUninstallEntries(String(out ?? ''))
  } catch (err) {
    console.warn(
      `[uninstall-detection] Falha ao consultar ${psPath}:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
}

function withScope(entries: UninstallEntry[], scope: 'machine' | 'user'): UninstallEntry[] {
  return entries.map((entry) => ({ ...entry, scope }))
}

function sameProduct(a: UninstallEntry, b: UninstallEntry): boolean {
  if (a.productCode && b.productCode) {
    return a.productCode.toUpperCase() === b.productCode.toUpperCase()
  }
  return (
    a.displayName.trim().toLowerCase() === b.displayName.trim().toLowerCase() &&
    (a.displayVersion ?? '') === (b.displayVersion ?? '')
  )
}

/** Funde as entradas de HKLM (machine) e HKCU (user); marca `both` quando o mesmo produto aparece nos dois. */
function mergeScopes(machine: UninstallEntry[], user: UninstallEntry[]): UninstallEntry[] {
  const merged: UninstallEntry[] = []
  for (const machineEntry of machine) {
    const twin = user.find((userEntry) => sameProduct(machineEntry, userEntry))
    merged.push(twin ? { ...machineEntry, scope: 'both' } : machineEntry)
  }
  for (const userEntry of user) {
    if (machine.some((machineEntry) => sameProduct(machineEntry, userEntry))) {
      continue // já incluída acima marcada como 'both'
    }
    merged.push(userEntry)
  }
  return merged
}

/** Escolha da "melhor" entrada: InstallLocation KLOUD_GAMES > UninstallString com GUID > primeira. */
function pickBestUninstallEntry(entries: UninstallEntry[]): UninstallEntry | null {
  if (entries.length === 0) return null
  const withKloudLocation = entries.find((entry) =>
    entry.installLocation?.toUpperCase().includes('KLOUD_GAMES')
  )
  if (withKloudLocation) return withKloudLocation
  const withProductCode = entries.find((entry) => entry.productCode !== null)
  if (withProductCode) return withProductCode
  return entries[0]
}

function collectUninstallEntries(): UninstallEntry[] {
  const machine = UNINSTALL_HIVES.filter((hive) => hive.scope === 'machine').flatMap((hive) =>
    withScope(queryUninstallHive(hive.psPath) ?? [], 'machine')
  )
  const user = UNINSTALL_HIVES.filter((hive) => hive.scope === 'user').flatMap((hive) =>
    withScope(queryUninstallHive(hive.psPath) ?? [], 'user')
  )
  return mergeScopes(machine, user)
}

/**
 * Localiza a entrada de desinstalação do Kloud Games no registro
 * (HKLM Uninstall, HKLM WOW6432Node Uninstall e HKCU Uninstall).
 * Nunca lança: falha/acesso negado/JSON inválido → null.
 */
export function findKloudGamesUninstallEntry(): UninstallEntry | null {
  try {
    const entries = collectUninstallEntries().filter(
      (entry) => matchKind(entry.displayName) === 'kloud'
    )
    return pickBestUninstallEntry(entries)
  } catch (err) {
    console.warn(
      '[uninstall-detection] findKloudGamesUninstallEntry falhou:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/**
 * Localiza a entrada de desinstalação do Kolnd Hub (NSIS, per-user — HKCU é priorizado).
 * O UninstallString do NSIS já é o caminho do .exe (com as aspas já removidas pelo parse).
 * Nunca lança.
 */
export function findHubUninstallEntry(): UninstallEntry | null {
  try {
    const entries = collectUninstallEntries().filter(
      (entry) => matchKind(entry.displayName) === 'hub'
    )
    if (entries.length === 0) return null
    // HKCU primeiro (instalação per-user do NSIS); depois o melhor de HKLM/both.
    const userEntries = entries.filter((entry) => entry.scope === 'user' || entry.scope === 'both')
    return pickBestUninstallEntry(userEntries.length > 0 ? userEntries : entries)
  } catch (err) {
    console.warn(
      '[uninstall-detection] findHubUninstallEntry falhou:',
      err instanceof Error ? err.message : err
    )
    return null
  }
}

/** Extrai o caminho do executável de um UninstallString ("..." com ou sem argumentos). */
function resolveExecutablePath(uninstallString: string): string {
  const trimmed = uninstallString.trim()
  if (trimmed.startsWith('"')) {
    const closing = trimmed.indexOf('"', 1)
    if (closing > 1) return trimmed.slice(1, closing)
    return trimmed.slice(1)
  }
  return trimmed
}

/**
 * Nome do desinstalador gerado pelo electron-builder (NSIS): `Uninstall <productName>.exe`.
 * O productName é "Kolnd Hub" (electron-builder.yml). Este literal é o fallback
 * documentado — não há como derivá-lo em runtime de forma confiável.
 */
const DEFAULT_HUB_UNINSTALLER_NAME = 'Uninstall Kolnd Hub.exe'

/**
 * Disponibilidade do desinstalador do Kolnd Hub:
 * 1) caminho padrão ao lado do Kolnd Hub.exe (%LOCALAPPDATA%\Programs\Kolnd Hub);
 * 2) fallback: entrada do registro cujo UninstallString aponta para um .exe existente;
 * 3) senão { available: false }.
 * Em desenvolvimento (!app.isPackaged) retorna { available: false } — o fluxo do Hub
 * só faz sentido no app instalado. Nunca lança.
 */
export function findHubUninstaller(): HubUninstallDetection {
  if (!app.isPackaged) {
    return { available: false, uninstallerPath: null, source: null, entry: null }
  }

  try {
    const defaultPath = join(dirname(app.getPath('exe')), DEFAULT_HUB_UNINSTALLER_NAME)
    if (existsSync(defaultPath)) {
      return {
        available: true,
        uninstallerPath: defaultPath,
        source: 'default-path',
        entry: null
      }
    }
  } catch (err) {
    console.warn(
      '[uninstall-detection] Não foi possível resolver o caminho padrão do desinstalador:',
      err instanceof Error ? err.message : err
    )
  }

  try {
    const entry = findHubUninstallEntry()
    const candidate = entry ? resolveExecutablePath(entry.uninstallString) : null
    if (candidate && existsSync(candidate)) {
      return {
        available: true,
        uninstallerPath: candidate,
        source: 'registry',
        entry
      }
    }
    return { available: false, uninstallerPath: null, source: null, entry }
  } catch (err) {
    console.warn(
      '[uninstall-detection] findHubUninstaller (fallback registro) falhou:',
      err instanceof Error ? err.message : err
    )
    return { available: false, uninstallerPath: null, source: null, entry: null }
  }
}

/**
 * Parse do `sc query KLOUD_GAMESsvc`. `sc` imprime a saída do STATE em inglês
 * ("RUNNING"/"STOPPED") na maioria das instalações; 1060 = serviço inexistente.
 * Saída vazia é tratada como falha total → missing.
 */
export function parseScQueryOutput(output: string): ServiceStatus {
  const text = output ?? ''
  if (/1060/.test(text)) return 'missing'
  if (/\bRUNNING\b/i.test(text)) return 'running'
  if (!text.trim()) return 'missing'
  return 'stopped'
}

/**
 * Estado do serviço KLOUD_GAMESsvc via `sc query` (stdout texto, windowsHide).
 * 1060 na saída/erro → missing; contém RUNNING → running; caso contrário stopped;
 * falha total → missing. Nunca lança.
 */
export function getKloudGamesServiceStatus(): ServiceStatus {
  try {
    const out = execFileSync('sc', ['query', SERVICE_NAME], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024
    })
    return parseScQueryOutput(String(out ?? ''))
  } catch (err) {
    // O `sc` pode escrever o erro no stdout capturado pelo execFileSync.
    const withIo = err as { stdout?: unknown; stderr?: unknown; message?: string }
    const blob = [
      typeof withIo?.stdout === 'string' ? withIo.stdout : String(withIo?.stdout ?? ''),
      typeof withIo?.stderr === 'string' ? withIo.stderr : String(withIo?.stderr ?? ''),
      err instanceof Error ? err.message : String(err)
    ].join('\n')
    if (/\bRUNNING\b/i.test(blob)) return 'running'
    if (/\bSTOPPED\b/i.test(blob)) return 'stopped'
    return 'missing'
  }
}

/** Regras de combinação do exe/registro/serviço em um único status (função pura). */
export function combineKloudGamesDetection(
  exePath: string | null,
  entry: UninstallEntry | null,
  service: ServiceStatus
): KloudGamesDetection {
  const hasExe = Boolean(exePath)
  const hasEntry = Boolean(entry)
  const servicePresent = service !== 'missing'

  let status: KloudGamesDetection['status']
  if (!hasExe && !hasEntry && !servicePresent) {
    status = 'missing'
  } else if (hasExe && hasEntry) {
    status = 'installed'
  } else {
    status = 'partial'
  }

  return { status, exePath, service, entry }
}

/**
 * Detecção completa do Kloud Games combinando exe (findKloudGamesExe),
 * entrada de desinstalação no registro e estado do serviço. Nunca lança.
 */
export function detectKloudGames(): KloudGamesDetection {
  let exePath: string | null = null
  try {
    exePath = findKloudGamesExe()
  } catch (err) {
    console.warn(
      '[uninstall-detection] findKloudGamesExe falhou:',
      err instanceof Error ? err.message : err
    )
  }

  let entry: UninstallEntry | null = null
  try {
    entry = findKloudGamesUninstallEntry()
  } catch (err) {
    console.warn(
      '[uninstall-detection] findKloudGamesUninstallEntry falhou:',
      err instanceof Error ? err.message : err
    )
  }

  return combineKloudGamesDetection(exePath, entry, getKloudGamesServiceStatus())
}

/**
 * Tabela de mapeamento de códigos de saída do msiexec (e do wrapper PowerShell).
 * Pura e exaustiva nos códigos conhecidos; qualquer outro código (ou null) → unknown.
 * Reutilizada pelo fluxo de desinstalação (T2/T6).
 */
export function mapMsiexecExitCode(code: number | null): MsiexecExitCodeResult {
  switch (code) {
    case 0:
      return { kind: 'success', message: 'O Kloud Games foi desinstalado com sucesso.' }
    case 3010:
    case 1641:
      return {
        kind: 'needs-reboot',
        message: 'Reinicie o PC para concluir a remoção.'
      }
    case 1602:
      return { kind: 'cancelled', message: 'Cancelado por você.' }
    case 1605:
      return {
        kind: 'already-absent',
        message: 'O Kloud Games já não constava como instalado — nada foi removido.'
      }
    case 1612:
      return {
        kind: 'already-absent',
        message: 'O Kloud Games já não constava como instalado — nada foi removido.'
      }
    case 1618:
    case 1500:
      return {
        kind: 'other-install',
        message:
          'Outra instalação do Windows está em andamento. Aguarde e tente de novo (ou reinicie o PC).'
      }
    case 1625:
      return {
        kind: 'policy-blocked',
        message:
          'Esta máquina bloqueia desinstalações por política de grupo. Fale com o administrador.'
      }
    case 1638:
      return {
        kind: 'newer-version',
        message: 'Já existe uma versão mais nova do Kloud Games instalada; nada foi removido.'
      }
    case 1603:
      return {
        kind: 'fatal',
        message:
          'O Windows não conseguiu desinstalar (código 1603). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
      }
    case 1604:
      return {
        kind: 'fatal',
        message:
          'A desinstalação do Kloud Games falhou (código 1604). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
      }
    case 1609:
      return {
        kind: 'fatal',
        message:
          'A desinstalação do Kloud Games falhou (código 1609 — erro ao gravar o registro). Reinicie o PC e tente de novo; se persistir, use Configurações → Aplicativos.'
      }
    case 1619:
      return {
        kind: 'fatal',
        message:
          'A desinstalação do Kloud Games falhou (código 1619 — o pacote não pôde ser aberto). Use Configurações → Aplicativos para desinstalar.'
      }
    case 1223:
      return {
        kind: 'uac-denied',
        message: 'Você recusou a permissão (UAC). Nada foi removido.'
      }
    default:
      return {
        kind: 'unknown',
        message:
          code === null
            ? 'A desinstalação terminou sem um código de saída conhecido. Veja a pasta de logs para detalhes.'
            : `A desinstalação terminou com um código inesperado (${code}). Veja a pasta de logs para detalhes.`
      }
  }
}
