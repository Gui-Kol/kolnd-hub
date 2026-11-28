/*
 * Instala o binário do `better-sqlite3` para a ABI do Electron 28.
 *
 * O postinstall padrão do pacote baixa/compila para o Node do sistema, o que
 * faz o módulo nativo falhar dentro do Electron (NODE_MODULE_VERSION 119).
 * Este script baixa o prebuild `electron-v119-win32-x64` via `prebuild-install`,
 * sem compilar (a máquina de referência não tem MSVC).
 *
 * Os testes unitários usam o driver `node:sqlite` embutido no Node moderno e
 * nunca carregam este binário; o smoke do app empacotado é a prova real.
 *
 * Se o download falhar, o processo de instalação falha de propósito: sem o
 * binário do Electron a memória não funciona no app empacotado.
 */
const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ELECTRON_TARGET = process.env.ABSOLEM_ELECTRON_TARGET || '28.3.3'
const ELECTRON_ABI = 'electron-v119'
const ROOT = join(__dirname, '..')
const PACKAGE_DIR = join(ROOT, 'node_modules', 'better-sqlite3')
const PREBUILD_BIN = join(ROOT, 'node_modules', 'prebuild-install', 'bin.js')
const RELEASE_DIR = join(PACKAGE_DIR, 'build', 'Release')
const BINDING = join(RELEASE_DIR, 'better_sqlite3.node')
const MARKER = join(RELEASE_DIR, '.absolem-abi')

function log(message) {
  process.stdout.write(`[absolem:sqlite] ${message}\n`)
}

if (process.env.ABSOLEM_SKIP_SQLITE_PREBUILD === '1') {
  log('pedido de instalação ignorado (ABSOLEM_SKIP_SQLITE_PREBUILD=1).')
  process.exit(0)
}

if (!existsSync(PACKAGE_DIR)) {
  log('better-sqlite3 não está instalado; nada a fazer.')
  process.exit(0)
}

if (!existsSync(PREBUILD_BIN)) {
  log('prebuild-install ausente; instale as devDependencies e rode de novo.')
  process.exit(1)
}

const markerValue = `${ELECTRON_ABI}-${ELECTRON_TARGET}-win32-x64`
try {
  if (existsSync(BINDING) && readFileSync(MARKER, 'utf8').trim() === markerValue) {
    log(`binário do Electron já instalado (${markerValue}).`)
    process.exit(0)
  }
} catch {
  // Marcador ausente ou ilegível: segue para o download.
}

try {
  rmSync(join(PACKAGE_DIR, 'build'), { recursive: true, force: true })
  mkdirSync(RELEASE_DIR, { recursive: true })
  log(`baixando prebuild ${ELECTRON_ABI} para Electron ${ELECTRON_TARGET} (win32-x64)...`)
  execFileSync(
    process.execPath,
    [PREBUILD_BIN, '--runtime=electron', `--target=${ELECTRON_TARGET}`, '--arch=x64'],
    { cwd: PACKAGE_DIR, stdio: 'inherit' }
  )
  if (!existsSync(BINDING)) {
    throw new Error('prebuild-install terminou sem criar build/Release/better_sqlite3.node')
  }
  writeFileSync(MARKER, `${markerValue}\n`, 'utf8')
  log('binário do Electron instalado em build/Release.')
} catch (error) {
  log(`falha ao instalar o binário nativo: ${error instanceof Error ? error.message : error}`)
  log(
    'sem o binário do Electron a memória fica desabilitada no app. ' +
      'Rode "npm run postinstall" com rede disponível.'
  )
  process.exit(1)
}
