/*
 * Smoke do artefato distribuído pelo Hub (task 10).
 *
 * Não usa dados reais: lê o `dist/win-unpacked` já empacotado, confere o
 * conteúdo do `app.asar`, carrega o `better-sqlite3` de dentro do asar no
 * Electron 28 e abre o app com userData temporário e transporte fake para
 * provar preload + versão da Hub. Nada sai da máquina.
 *
 * Rode depois de `npm run package:dir`:
 *   npm run test:bundle
 */
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist', 'win-unpacked')
const ASAR = join(DIST, 'resources', 'app.asar')
const UNPACKED = join(DIST, 'resources', 'app.asar.unpacked')
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')

const failures = []
const checks = []

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ''}`)
}

/** Lê o header JSON do asar sem depender de pacote extra. */
function readAsarEntries(archive) {
  const fd = openSync(archive, 'r')
  try {
    const sizeBuffer = Buffer.alloc(8)
    readSync(fd, sizeBuffer, 0, 8, 0)
    const headerSize = sizeBuffer.readUInt32LE(4)
    const headerBuffer = Buffer.alloc(headerSize)
    readSync(fd, headerBuffer, 0, headerSize, 8)
    const jsonSize = headerBuffer.readUInt32LE(4)
    const header = JSON.parse(headerBuffer.toString('utf8', 8, 8 + jsonSize))
    const entries = []
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const full = prefix ? `${prefix}/${name}` : name
        if (entry.files) walk(entry, full)
        else entries.push({ path: full, size: entry.size ?? 0, unpacked: entry.unpacked === true })
      }
    }
    walk(header, '')
    return entries
  } finally {
    closeSync(fd)
  }
}

function runNativeFromAsar() {
  const dir = mkdtempSync(join(tmpdir(), 'absolem-native-smoke-'))
  const script = join(dir, 'native.cjs')
  const source = `const { app } = require('electron')
const path = require('node:path')
app.disableHardwareAcceleration()
app.whenReady().then(() => {
  try {
    const Database = require(path.join(process.argv[2], 'node_modules', 'better-sqlite3'))
    const db = new Database(':memory:')
    db.exec('CREATE TABLE smoke (value TEXT)')
    db.prepare('INSERT INTO smoke VALUES (?)').run('ok')
    const row = db.prepare('SELECT COUNT(*) AS n FROM smoke').get()
    db.close()
    process.stdout.write('NATIVE_OK ' + JSON.stringify(row) + '\\n')
    app.exit(0)
  } catch (error) {
    process.stderr.write('NATIVE_FAIL ' + (error && error.stack ? error.stack : error) + '\\n')
    app.exit(1)
  }
})
`
  try {
    writeFileSync(script, source)
    const result = spawnSync(ELECTRON_EXE, [script, ASAR], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true
    })
    return {
      ok: result.status === 0 && result.stdout.includes('NATIVE_OK {"n":1}'),
      detail: (result.stderr || result.stdout || '').trim()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

async function runRuntimeSmoke() {
  const userData = mkdtempSync(join(tmpdir(), 'absolem-bundle-smoke-'))
  const env = { ...process.env }
  for (const key of [
    'ABSOLEM_SMOKE',
    'ABSOLEM_MEMORY_SMOKE',
    'ABSOLEM_VISUAL_DIR',
    'ABSOLEM_LOG_LEVEL'
  ]) {
    delete env[key]
  }
  env.ABSOLEM_TEST_USERDATA = userData
  env.ABSOLEM_TEST_TRANSPORT = 'fake'
  env.ABSOLEM_HUB_VERSION = '9.9.9-smoke'

  // Abre o app.asar com o Electron 28 (mesmo runtime do pacote, sem o .exe com
  // requireAdministrator). Prova main + preload + renderer + native no asar.
  const app = await electron.launch({ args: [ASAR], cwd: ROOT, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const result = await page.evaluate(async () => {
      const api = window.absolem
      const required = [
        'getAppInfo',
        'overlayShow',
        'overlayStatus',
        'storeGet',
        'themeGet',
        'openSettings'
      ]
      const nested = [
        ['gemini', 'status'],
        ['chat', 'send'],
        ['diagnostics', 'gemini'],
        ['permissions', 'get'],
        ['actions', 'status'],
        ['memory', 'stats'],
        ['capture', 'ask'],
        ['search', 'status'],
        ['voice', 'start']
      ]
      const info = await api.getAppInfo()
      const stats = await api.memory.stats()
      return {
        exposed: typeof api === 'object' && api !== null,
        missing: required.filter((name) => typeof api[name] !== 'function'),
        missingNested: nested
          .filter(([group, name]) => typeof api[group]?.[name] !== 'function')
          .map(([group, name]) => `${group}.${name}`),
        info,
        stats
      }
    })
    const actualUserData = await app.evaluate(({ app: electronApp }) =>
      electronApp.getPath('userData')
    )
    const appPath = await app.evaluate(({ app: electronApp }) => electronApp.getAppPath())
    return { result, actualUserData, appPath, pageUrl: page.url() }
  } finally {
    await app.close().catch(() => undefined)
    rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

function main() {
  if (!existsSync(ASAR)) {
    process.stderr.write(
      'Artefato ausente: rode `npm run package:dir` antes de `npm run test:bundle`.\n'
    )
    process.exit(1)
  }

  const entries = readAsarEntries(ASAR)
  const paths = new Set(entries.map((entry) => entry.path))
  const required = [
    'package.json',
    'out/main/index.js',
    'out/preload/index.js',
    'out/renderer/index.html',
    'node_modules/better-sqlite3/package.json',
    'node_modules/@google/genai/package.json',
    'node_modules/electron-store/package.json'
  ]
  for (const path of required) check(`asar contém ${path}`, paths.has(path))
  check('asar contém LICENSE', paths.has('LICENSE'))

  const rootForbidden = [
    'electron.vite.config.ts',
    'electron-builder.yml',
    'tsconfig.json',
    'tsconfig.node.json',
    'tsconfig.web.json',
    'vitest.config.ts',
    'eslint.config.mjs',
    'tailwind.config.js',
    'postcss.config.js',
    'README.md',
    'package-lock.json',
    '.prettierrc.json',
    '.prettierignore',
    '.gitignore'
  ]
  for (const path of rootForbidden) check(`asar sem ${path}`, !paths.has(path))
  for (const prefix of [
    'src/',
    'tests/',
    'docs/',
    'scripts/',
    'resources/',
    'coverage/',
    'test-results/',
    'playwright-report/'
  ]) {
    check(`asar sem a pasta ${prefix}`, ![...paths].some((path) => path.startsWith(prefix)))
  }
  const sourceMaps = [...paths].filter((path) => path.endsWith('.map'))
  check('asar sem source maps', sourceMaps.length === 0, sourceMaps.slice(0, 3).join(', '))
  const rendererOnly = [...paths].filter((path) =>
    /^node_modules\/(react|react-dom|three|scheduler|loose-envify|js-tokens)\//.test(path)
  )
  check('asar sem dependências exclusivas do renderer', rendererOnly.length === 0, rendererOnly[0])
  const nativeSources = [...paths].filter((path) =>
    /^node_modules\/better-sqlite3\/(deps|src)\//.test(path)
  )
  check('asar/unpacked sem fontes do better-sqlite3', nativeSources.length === 0, nativeSources[0])

  const nativeEntry = entries.find(
    (entry) => entry.path === 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  )
  const nativeFile = join(
    UNPACKED,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node'
  )
  check('native marcado como unpacked', nativeEntry?.unpacked === true)
  check('native existe fora do asar', existsSync(nativeFile))
  check(
    'native tem tamanho > 1 MB',
    nativeEntry !== undefined && nativeEntry.size > 1_000_000,
    nativeEntry ? String(nativeEntry.size) : 'ausente'
  )

  const builderConfig = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  check('appId com.kolnd.absolem', builderConfig.includes('appId: com.kolnd.absolem'))
  check('productName Absolem', builderConfig.includes('productName: Absolem'))
  check(
    'requireAdministrator preservado',
    builderConfig.includes('requestedExecutionLevel: requireAdministrator')
  )
  check('asar ligado', /^asar: true$/m.test(builderConfig))
  check('npmRebuild ligado', /^npmRebuild: true$/m.test(builderConfig))
  check('asarUnpack cobre *.node', builderConfig.includes("'**/*.node'"))

  const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  check(
    'versão própria continua placeholder 0.0.0',
    packageJson.version === '0.0.0',
    packageJson.version
  )
  check(
    'main aponta para out/main/index.js',
    packageJson.main === './out/main/index.js',
    packageJson.main
  )

  const builtMain = readFileSync(join(ROOT, 'out', 'main', 'index.js'), 'utf8')
  check(
    'main define setAppUserModelId',
    builtMain.includes('setAppUserModelId("com.kolnd.absolem")')
  )
  check('main lê ABSOLEM_HUB_VERSION', builtMain.includes('ABSOLEM_HUB_VERSION'))

  const native = runNativeFromAsar()
  check('native carrega de dentro do asar no Electron 28', native.ok, native.detail)
}

main()

const runtime = await runRuntimeSmoke()
check(
  'runtime carregado do app.asar',
  resolve(runtime.appPath).toLowerCase() === resolve(ASAR).toLowerCase()
)
check(
  'renderer carregado do app.asar',
  runtime.pageUrl.startsWith('file:///') &&
    decodeURIComponent(runtime.pageUrl).toLowerCase().includes('/app.asar/out/renderer/index.html')
)
check('preload expõe window.absolem', runtime.result.exposed)
check(
  'API principal completa',
  runtime.result.missing.length === 0,
  runtime.result.missing.join(', ')
)
check(
  'API aninhada completa',
  runtime.result.missingNested.length === 0,
  runtime.result.missingNested.join(', ')
)
check('getAppInfo responde', runtime.result.info?.ok === true)
check(
  'versão vem de ABSOLEM_HUB_VERSION',
  runtime.result.info?.ok === true && runtime.result.info.info.version === '9.9.9-smoke',
  runtime.result.info?.ok === true ? runtime.result.info.info.version : 'erro'
)
check(
  'runtime é Electron 28 / win32',
  runtime.result.info?.ok === true &&
    runtime.result.info.info.platform === 'win32' &&
    String(runtime.result.info.info.electron ?? '').startsWith('28.'),
  runtime.result.info?.ok === true
    ? `${runtime.result.info.info.platform}/${runtime.result.info.info.electron}`
    : 'erro'
)
check('memory.stats responde no bundle', runtime.result.stats?.ok === true)
check(
  'userData isolado e temporário',
  resolve(runtime.actualUserData) !== resolve(tmpdir()) &&
    resolve(runtime.actualUserData).startsWith(`${resolve(tmpdir())}${sep}`)
)

const asarBytes = readFileSync(ASAR).length
process.stdout.write(`\n[absolem:bundle] app.asar ${(asarBytes / 1024 / 1024).toFixed(2)} MB\n`)
for (const item of checks) {
  process.stdout.write(
    `${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` (${item.detail})` : ''}\n`
  )
}
if (failures.length > 0) {
  process.stderr.write(`\n[absolem:bundle] ${failures.length} falha(s).\n`)
  process.exit(1)
}
process.stdout.write(`\n[absolem:bundle] ${checks.length} checks OK.\n`)
