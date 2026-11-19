import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OFFICE_PLUGIN_SOURCE, OFFICE_PLUGIN_VERSION } from './pluginSource'

/**
 * Instalador do plugin do OpenCode (T12).
 *
 * Módulo PURO de propósito: nada de `electron` aqui, para poder ser testado
 * em Vitest (node) e para deixar explícito que ele nunca toca em outro lugar
 * além dos caminhos recebidos. O IPC (`office:plugin-*`) resolve os caminhos
 * reais e chama estas funções.
 *
 * Regras de segurança:
 * - só escreve dentro de `paths.configDir`/`paths.pluginDir`;
 * - config com comentários NUNCA é reescrito — devolve o trecho para colar;
 * - toda escrita de config faz backup `.kolnd-backup-<timestamp>` antes;
 * - qualquer falha vira `{ ok: false, reason }` legível em pt-BR (sem stack).
 *
 * Detalhe do formato: o plugin instalado é um DIRETÓRIO (`index.js` +
 * `package.json` com `exports`), e a entrada em `plugins` aponta para esse
 * diretório via `pathToFileURL` (funciona com as barras invertidas do Windows).
 */

export type PluginConfigKind = 'json' | 'jsonc' | 'none'

export type PluginFailureReason =
  'comentarios' | 'json-invalido' | 'config-nao-objeto' | 'plugins-invalido' | 'io' | 'verificacao'

export interface PluginInstallerPaths {
  configDir: string
  /** Arquivo escolhido: `opencode.json`, `opencode.jsonc` ou o `.json` a criar. */
  configPath: string
  pluginDir: string
}

export interface PluginInstallerOverrides {
  configDir?: string
  pluginDir?: string
  env?: Record<string, string | undefined>
}

export interface PluginConfigState {
  configPath: string
  exists: boolean
  kind: PluginConfigKind
  hasComments: boolean
  /** Entrada existente que aponta para o nosso diretório de plugin. */
  entry?: string
}

export interface PluginInstallResult {
  ok: boolean
  reason?: PluginFailureReason
  message?: string
  /** Preenchido em `reason === 'comentarios'`: trecho exato para o usuário colar. */
  snippet?: string
  configPath: string
  pluginDir: string
  entry: string
  changed: boolean
  backupPath?: string
}

export interface PluginRemoveResult {
  ok: boolean
  removed: boolean
  reason?: PluginFailureReason
  message?: string
  configPath: string
  backupPath?: string
}

export interface PluginStatus {
  installed: boolean
  pluginDirExists: boolean
  versionInstalled: string | null
  versionBundled: string
  stale: boolean
  configKind: PluginConfigKind
  entry?: string
  /** Config tem comentários e a entrada não está lá: o usuário precisa colar. */
  needsManual: boolean
  configPath: string
  pluginDir: string
  error?: string
}

export interface PluginSnippetResult {
  ok: boolean
  entry: string
  snippet: string
  configPath: string
}

interface LoadedConfig extends PluginConfigState {
  text: string
}

interface ParsedObject {
  ok: true
  value: Record<string, unknown>
}

interface ParsedFailure {
  ok: false
  reason: 'json-invalido' | 'config-nao-objeto'
}

const CONFIG_JSON = 'opencode.json'
const CONFIG_JSONC = 'opencode.jsonc'
const PACKAGE_JSON = `${JSON.stringify(
  { name: 'kolnd-office', type: 'module', exports: { '.': './index.js' } },
  null,
  2
)}\n`
const BOM = '\uFEFF'

const FAILURE_MESSAGES: Record<PluginFailureReason, string> = {
  comentarios:
    'O arquivo de configuração do OpenCode tem comentários e o Hub não o altera. O plugin já foi gravado; cole a entrada abaixo manualmente e salve.',
  'json-invalido': 'O arquivo de configuração do OpenCode não é um JSON válido.',
  'config-nao-objeto': 'A configuração do OpenCode não é um objeto JSON.',
  'plugins-invalido': 'A chave "plugins" do arquivo de configuração do OpenCode não é uma lista.',
  io: 'Não foi possível ler ou gravar os arquivos do plugin. Verifique as permissões da pasta.',
  verificacao:
    'A configuração foi gravada, mas a conferência depois da escrita falhou. Abra o arquivo e verifique.'
}

/** `%APPDATA%\kolnd-hub` (ou `KOLDND_HUB_TEST_USERDATA` no e2e). */
function defaultUserDataDir(env: Record<string, string | undefined>): string {
  const testUserData = (env.KOLDND_HUB_TEST_USERDATA ?? '').trim()
  if (testUserData) return testUserData
  const appData = (env.APPDATA ?? '').trim()
  return appData ? join(appData, 'kolnd-hub') : join(homedir(), '.kolnd-hub')
}

function trimmed(value: string | undefined): string | undefined {
  const flat = (value ?? '').trim()
  return flat || undefined
}

/**
 * Caminhos padrão (com override só por estas duas variáveis, para testes/e2e):
 * - config: `%USERPROFILE%\.config\opencode`;
 * - plugin: `<userData>\office\plugin`.
 */
export function resolveInstallerPaths(
  overrides: PluginInstallerOverrides = {}
): PluginInstallerPaths {
  const env = overrides.env ?? process.env
  const configDir =
    overrides.configDir ??
    trimmed(env.KOLDND_HUB_OPENCODE_CONFIG_DIR) ??
    join(homedir(), '.config', 'opencode')
  const pluginDir =
    overrides.pluginDir ??
    trimmed(env.KOLDND_HUB_OFFICE_PLUGIN_DIR) ??
    join(defaultUserDataDir(env), 'office', 'plugin')
  return { configDir, pluginDir, configPath: chooseConfigPath(configDir) }
}

/**
 * Escolhe qual arquivo editar. `opencode.json` é o alvo documentado para
 * criar do zero; se só existir o `.jsonc`, ele é respeitado (e, com
 * comentários, nunca é reescrito).
 */
function chooseConfigPath(configDir: string): string {
  const json = join(configDir, CONFIG_JSON)
  const jsonc = join(configDir, CONFIG_JSONC)
  if (existsSync(json)) return json
  if (existsSync(jsonc)) return jsonc
  return json
}

function withoutBom(text: string): { text: string; hadBom: boolean } {
  return text.startsWith(BOM) ? { text: text.slice(1), hadBom: true } : { text, hadBom: false }
}

/**
 * Varredura caractere a caractere para separar comentários de strings.
 * Precisa ser manual: `"https://…"` dentro de string NÃO é comentário, e um
 * escape (`\"`, `\\`) não pode encerrar a string.
 */
function scanJson(text: string): { stripped: string; hasComments: boolean } {
  let stripped = ''
  let inString = false
  let escaped = false
  let lineComment = false
  let blockComment = false
  let hasComments = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
        stripped += char
      } else {
        stripped += ' '
      }
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        stripped += '  '
        i++
      } else {
        stripped += char === '\n' ? '\n' : ' '
      }
      continue
    }

    if (inString) {
      stripped += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      stripped += char
      continue
    }

    if (char === '/' && next === '/') {
      lineComment = true
      hasComments = true
      stripped += '  '
      i++
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      hasComments = true
      stripped += '  '
      i++
      continue
    }

    stripped += char
  }

  return { stripped, hasComments }
}

/** `true` se o texto tem `//` ou `/* *\/` de verdade (fora de strings). */
export function hasJsonComments(text: string): boolean {
  return scanJson(text).hasComments
}

function parseLoose(text: string): unknown {
  const { text: clean } = withoutBom(text)
  const { stripped } = scanJson(clean)
  return JSON.parse(stripped)
}

function parseObject(text: string): ParsedObject | ParsedFailure {
  let value: unknown
  try {
    value = parseLoose(text)
  } catch {
    return { ok: false, reason: 'json-invalido' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'config-nao-objeto' }
  }
  return { ok: true, value: value as Record<string, unknown> }
}

function pluginEntry(paths: PluginInstallerPaths): string {
  return pathToFileURL(paths.pluginDir).href
}

/** Normaliza para comparação de caminho (case-insensitive no Windows). */
function normalizePath(value: string, baseDir?: string): string {
  const absolute = isAbsolute(value) ? value : resolve(baseDir ?? process.cwd(), value)
  const unified = absolute.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? unified.toLowerCase() : unified
}

/**
 * A entrada é nossa se resolve para o diretório do plugin (ou para o
 * `index.js` dentro dele) — aceita `file:///`, caminho absoluto e relativo.
 */
function isOurEntry(entry: unknown, paths: PluginInstallerPaths): boolean {
  if (typeof entry !== 'string') return false
  const raw = entry.trim()
  if (!raw) return false

  let target = raw
  if (/^file:\/\//i.test(raw)) {
    try {
      target = fileURLToPath(raw)
    } catch {
      return false
    }
  }

  const candidates = new Set([
    normalizePath(paths.pluginDir),
    normalizePath(join(paths.pluginDir, 'index.js'))
  ])
  return candidates.has(normalizePath(target, paths.configDir))
}

function findOurEntry(
  value: Record<string, unknown>,
  paths: PluginInstallerPaths
): string | undefined {
  const plugins = value.plugins
  if (!Array.isArray(plugins)) return undefined
  return plugins.find((entry): entry is string => isOurEntry(entry, paths))
}

function loadConfig(paths: PluginInstallerPaths): LoadedConfig {
  // Reavalia a escolha a cada operação: o `.jsonc` pode ter aparecido depois
  // de `resolveInstallerPaths` (e o status nunca deve apontar para o arquivo
  // errado só porque o objeto de caminhos foi montado antes).
  const configPath = chooseConfigPath(paths.configDir)
  if (!existsSync(configPath)) {
    return { configPath, exists: false, kind: 'none', hasComments: false, text: '' }
  }

  const text = readFileSync(configPath, 'utf8')
  const hasComments = hasJsonComments(text)
  let entry: string | undefined
  try {
    const parsed = parseLoose(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      entry = findOurEntry(parsed as Record<string, unknown>, paths)
    }
  } catch {
    // JSON inválido: o status ainda informa o kind e o install/remove recusam.
  }

  return {
    configPath,
    exists: true,
    kind: configPath.toLowerCase().endsWith('.jsonc') ? 'jsonc' : 'json',
    hasComments,
    ...(entry ? { entry } : {}),
    text
  }
}

/**
 * Estado da configuração. `entry` é a nossa entrada, quando já existe.
 * Não lança para JSON inválido; só propaga erro de leitura (o IPC trata).
 */
export function readConfigState(paths: PluginInstallerPaths): PluginConfigState {
  const loaded = loadConfig(paths)
  return {
    configPath: loaded.configPath,
    exists: loaded.exists,
    kind: loaded.kind,
    hasComments: loaded.hasComments,
    ...(loaded.entry ? { entry: loaded.entry } : {})
  }
}

/** Trecho exato para o usuário colar (quando o arquivo tem comentários). */
function buildSnippet(text: string, entry: string): string {
  let value: unknown
  try {
    value = parseLoose(text)
  } catch {
    value = null
  }
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  if (record && Array.isArray(record.plugins)) return JSON.stringify(entry)
  return `"plugins": [\n    ${JSON.stringify(entry)}\n  ]`
}

/** Snippet atual, sem efeito colateral (canal `office:plugin-snippet`). */
export function pluginSnippet(paths: PluginInstallerPaths): PluginSnippetResult {
  const loaded = loadConfig(paths)
  const entry = pluginEntry(paths)
  return {
    ok: true,
    entry,
    snippet: buildSnippet(loaded.text, entry),
    configPath: loaded.configPath
  }
}

let tempCounter = 0

/** Escrita atômica: tmp no mesmo diretório + rename. */
function writeAtomic(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.kolnd-tmp-${process.pid}-${tempCounter++}`
  try {
    writeFileSync(temp, content, 'utf8')
    renameSync(temp, target)
  } catch (err) {
    try {
      unlinkSync(temp)
    } catch {
      // arquivo temporário pode nem ter sido criado
    }
    throw err
  }
}

function timestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  ].join('-')
}

/** Backup ao lado do config, com timestamp (e sufixo se colidir). */
function backupConfig(configPath: string): string {
  const base = `${configPath}.kolnd-backup-${timestamp(new Date())}`
  let candidate = base
  let suffix = 2
  while (existsSync(candidate)) candidate = `${base}-${suffix++}`
  copyFileSync(configPath, candidate)
  return candidate
}

function serializeConfig(value: Record<string, unknown>, hadBom: boolean): string {
  return `${hadBom ? BOM : ''}${JSON.stringify(value, null, 2)}\n`
}

/** Grava os arquivos do plugin (diretório); `version.json` por último. */
function writePluginFiles(paths: PluginInstallerPaths): void {
  mkdirSync(paths.pluginDir, { recursive: true })
  writeAtomic(join(paths.pluginDir, 'index.js'), OFFICE_PLUGIN_SOURCE)
  writeAtomic(join(paths.pluginDir, 'package.json'), PACKAGE_JSON)
  writeAtomic(
    join(paths.pluginDir, 'version.json'),
    `${JSON.stringify(
      { version: OFFICE_PLUGIN_VERSION, installedAt: new Date().toISOString() },
      null,
      2
    )}\n`
  )
}

function failure(
  paths: PluginInstallerPaths,
  reason: PluginFailureReason,
  extra: Partial<PluginInstallResult> = {}
): PluginInstallResult {
  return {
    ok: false,
    reason,
    message: FAILURE_MESSAGES[reason],
    configPath: chooseConfigPath(paths.configDir),
    pluginDir: paths.pluginDir,
    entry: pluginEntry(paths),
    changed: false,
    ...extra
  }
}

function describeError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err)
}

/**
 * Instala o plugin: arquivos no `pluginDir` e uma entrada em `plugins`.
 * Idempotente (nunca duplica a entrada). Nunca escreve em config com
 * comentários ou JSON inválido — nesses casos o arquivo fica byte-idêntico.
 */
export function installPlugin(paths: PluginInstallerPaths): PluginInstallResult {
  const entry = pluginEntry(paths)

  try {
    const loaded = loadConfig(paths)

    if (loaded.exists && loaded.hasComments) {
      // O CONFIG fica intocado (byte a byte). Os arquivos do plugin são
      // gravados: na primeira vez, o usuário cola a entrada manualmente; depois,
      // reinstalar só atualiza a cópia local.
      writePluginFiles(paths)
      if (loaded.entry) {
        return {
          ok: true,
          configPath: loaded.configPath,
          pluginDir: paths.pluginDir,
          entry,
          changed: false
        }
      }
      return failure(paths, 'comentarios', {
        snippet: buildSnippet(loaded.text, entry)
      })
    }

    let config: Record<string, unknown> | null = null
    let hadBom = false
    if (loaded.exists) {
      const strippedBom = withoutBom(loaded.text)
      hadBom = strippedBom.hadBom
      const parsed = parseObject(loaded.text)
      if (!parsed.ok) return failure(paths, parsed.reason)
      config = parsed.value
      if (config.plugins !== undefined && !Array.isArray(config.plugins)) {
        return failure(paths, 'plugins-invalido')
      }
    }

    // Validação concluída: a partir daqui pode haver escrita.
    writePluginFiles(paths)

    if (!config) {
      const created = {
        $schema: 'https://opencode.ai/config.json',
        plugins: [entry]
      }
      writeAtomic(loaded.configPath, serializeConfig(created, false))
      const check = parseObject(readFileSync(loaded.configPath, 'utf8'))
      if (!check.ok || findOurEntry(check.value, paths) !== entry) {
        return failure(paths, 'verificacao', { changed: true })
      }
      return {
        ok: true,
        configPath: loaded.configPath,
        pluginDir: paths.pluginDir,
        entry,
        changed: true
      }
    }

    const plugins = Array.isArray(config.plugins) ? (config.plugins as unknown[]) : []
    if (plugins.some((item) => isOurEntry(item, paths))) {
      // Já instalado: só atualiza os arquivos (idempotente, sem backup).
      return {
        ok: true,
        configPath: loaded.configPath,
        pluginDir: paths.pluginDir,
        entry,
        changed: false
      }
    }

    const next = { ...config, plugins: [...plugins, entry] }
    const backupPath = backupConfig(loaded.configPath)
    writeAtomic(loaded.configPath, serializeConfig(next, hadBom))

    const check = parseObject(readFileSync(loaded.configPath, 'utf8'))
    if (!check.ok || findOurEntry(check.value, paths) !== entry) {
      return failure(paths, 'verificacao', { changed: true, backupPath })
    }

    return {
      ok: true,
      configPath: loaded.configPath,
      pluginDir: paths.pluginDir,
      entry,
      changed: true,
      backupPath
    }
  } catch (err) {
    return failure(paths, 'io', { message: describeError(err) })
  }
}

/**
 * Remove SOMENTE a nossa entrada de `plugins` (comparação normalizada).
 * Sem instalação, é no-op. Outras entradas e chaves ficam intactas.
 */
export function removePlugin(paths: PluginInstallerPaths): PluginRemoveResult {
  try {
    const loaded = loadConfig(paths)
    if (!loaded.exists) return { ok: true, removed: false, configPath: loaded.configPath }

    if (loaded.hasComments) {
      return {
        ok: false,
        removed: false,
        reason: 'comentarios',
        message:
          'O arquivo de configuração do OpenCode tem comentários e o Hub não o altera. Remova a linha do plugin manualmente.',
        configPath: loaded.configPath
      }
    }

    const parsed = parseObject(loaded.text)
    if (!parsed.ok) {
      return {
        ok: false,
        removed: false,
        reason: parsed.reason,
        message: FAILURE_MESSAGES[parsed.reason],
        configPath: loaded.configPath
      }
    }

    const config = parsed.value
    if (!Array.isArray(config.plugins)) {
      return { ok: true, removed: false, configPath: loaded.configPath }
    }

    const plugins = config.plugins as unknown[]
    const kept = plugins.filter((entry) => !isOurEntry(entry, paths))
    if (kept.length === plugins.length) {
      return { ok: true, removed: false, configPath: loaded.configPath }
    }

    const hadBom = withoutBom(loaded.text).hadBom
    const next = { ...config, plugins: kept }
    const backupPath = backupConfig(loaded.configPath)
    writeAtomic(loaded.configPath, serializeConfig(next, hadBom))

    const check = parseObject(readFileSync(loaded.configPath, 'utf8'))
    if (!check.ok || findOurEntry(check.value, paths) !== undefined) {
      return {
        ok: false,
        removed: false,
        reason: 'verificacao',
        message: FAILURE_MESSAGES.verificacao,
        configPath: loaded.configPath,
        backupPath
      }
    }

    return { ok: true, removed: true, configPath: loaded.configPath, backupPath }
  } catch (err) {
    return {
      ok: false,
      removed: false,
      reason: 'io',
      message: describeError(err),
      configPath: chooseConfigPath(paths.configDir)
    }
  }
}

function readInstalledVersion(pluginDir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(join(pluginDir, 'version.json'), 'utf8')) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const version = (parsed as Record<string, unknown>).version
      if (typeof version === 'string' && version.trim()) return version.trim()
    }
  } catch {
    // sem version.json legível: a versão instalada é desconhecida
  }
  return null
}

function pluginDirExists(pluginDir: string): boolean {
  try {
    return statSync(pluginDir).isDirectory()
  } catch {
    return false
  }
}

/** Estado consolidado para a UI de Configurações. */
export function pluginStatus(paths: PluginInstallerPaths): PluginStatus {
  const versionBundled = OFFICE_PLUGIN_VERSION
  const dirExists = pluginDirExists(paths.pluginDir)
  const versionInstalled = readInstalledVersion(paths.pluginDir)

  const base = {
    pluginDirExists: dirExists,
    versionInstalled,
    versionBundled,
    configPath: chooseConfigPath(paths.configDir),
    pluginDir: paths.pluginDir
  }

  try {
    const loaded = loadConfig(paths)
    const installed = Boolean(loaded.entry)
    return {
      ...base,
      installed,
      stale: installed && versionInstalled !== versionBundled,
      configKind: loaded.kind,
      ...(loaded.entry ? { entry: loaded.entry } : {}),
      needsManual: loaded.hasComments && !loaded.entry
    }
  } catch (err) {
    return {
      ...base,
      installed: false,
      stale: false,
      configKind: 'none',
      needsManual: false,
      error: describeError(err)
    }
  }
}

/** Nome do arquivo de config (para mensagens da UI). */
export function configFileName(paths: PluginInstallerPaths): string {
  return basename(paths.configPath)
}
