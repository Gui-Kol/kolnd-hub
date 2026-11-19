import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import type { ClientRequest, IncomingMessage } from 'http'
import { get as httpsGet } from 'https'
import { join } from 'path'
import { app } from 'electron'
import { logger } from './logger'
import { shutdownHub } from './ipc/lifecycle'
import type { IpcContext } from './ipc/lifecycle'
import {
  MAX_INSTALLER_BYTES,
  UPDATE_LATEST_RELEASE_API_URL,
  isAllowedReleaseDownloadUrl,
  isInstallerSignatureAcceptable,
  isReleaseInstallable,
  isReleaseNewerThanInstalled,
  parseAuthenticodeJson,
  parseRelease,
  parseVersionTag,
  updateReleaseApiUrl,
  type AuthenticodeReport,
  type ReleaseInfo,
  type UpdateCheckResult,
  type UpdateInstallResult,
  type UpdateProgress
} from '../shared/updates'

/**
 * Atualização do próprio Hub via GitHub Releases.
 *
 * A única consulta externa automática do app: uma requisição GET na API
 * pública do GitHub a cada abertura (pedido explícito do usuário). Nada de
 * identificador, telemetria ou upload — e qualquer falha de rede é silenciosa
 * (o Hub abre normalmente, só sem o banner).
 *
 * Segurança: o renderer NUNCA informa URL. Ele devolve o ID da release que o
 * main mostrou; o main reconsulta o GitHub por esse ID e escolhe o asset de
 * novo. Download e redirecionamentos passam por allowlist (só github.com do
 * repositório oficial e *.githubusercontent.com) e o SHA-256 publicado pelo
 * GitHub é obrigatório: asset sem `digest` nunca é executado. Antes do spawn
 * o main confere a assinatura Authenticode (aceita `NotSigned` porque o
 * projeto não assina) e recalcula o hash do arquivo em disco.
 */

const USER_AGENT = 'Kolnd-Hub-Updater'
const API_TIMEOUT_MS = 10_000
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000
const MAX_REDIRECTS = 5
const MAX_API_BODY = 512 * 1024
const UPDATE_DIR_NAME = 'kolnd-hub-updates'
const OLD_DOWNLOAD_MS = 7 * 24 * 60 * 60 * 1000
const QUIT_DELAY_MS = 1500
const SIGNATURE_TIMEOUT_MS = 15_000

/**
 * Hoje o projeto **não assina código**: em 18/11/2026 o usuário decidiu não
 * gerar custo com certificado (item 2.4 do relatório), e o instalador atual é
 * `NotSigned`. Por isso `false`: `Valid` e `NotSigned` passam; qualquer
 * assinatura quebrada (`HashMismatch`, `NotTrusted`, `ValidButUntrusted`,
 * `UnknownError`, `NotSupported`, `Incompatible`) ou saída ilegível é recusada.
 *
 * Virar `true` exige certificado de assinatura de código (decisão 2.4) — a
 * partir daí só `Valid` passa e um instalador sem assinatura é recusado.
 */
export const REQUIRE_SIGNED_INSTALLER = false

const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': USER_AGENT,
  'x-github-api-version': '2022-11-28'
}

let installing = false
let cancelRequested = false
let activeRequest: ClientRequest | null = null
let activeResponse: IncomingMessage | null = null

const CANCELLED_MESSAGE = 'Download da atualização cancelado.'

/** Cancela o download em andamento (botão "Cancelar" do banner). */
export function cancelUpdate(): { ok: boolean; cancelled: boolean } {
  if (!installing) return { ok: false, cancelled: false }
  cancelRequested = true
  const error = new Error(CANCELLED_MESSAGE)
  activeResponse?.destroy(error)
  activeRequest?.destroy(error)
  return { ok: true, cancelled: true }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function requestJson(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { timeout: API_TIMEOUT_MS, headers: API_HEADERS }, (res) => {
      const chunks: Buffer[] = []
      let size = 0

      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_API_BODY) {
          req.destroy(new Error('Resposta do GitHub grande demais.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })

    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao consultar o GitHub.')))
    req.on('error', reject)
  })
}

async function fetchRelease(url: string): Promise<ReleaseInfo | null> {
  const response = await requestJson(url)
  if (response.status === 404) return null
  if (response.status !== 200) {
    throw new Error(`GitHub respondeu HTTP ${response.status}.`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(response.body)
  } catch {
    throw new Error('Resposta do GitHub em formato inesperado.')
  }

  const release = parseRelease(raw)
  if (!release) throw new Error('Resposta do GitHub em formato inesperado.')
  return release
}

/** Última release estável publicada; null quando o repositório não tem nenhuma. */
export function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  return fetchRelease(UPDATE_LATEST_RELEASE_API_URL)
}

/**
 * Consulta a release estável mais recente e diz se a tag dela é mais nova que
 * a versão instalada (`app.getVersion()`, vinda do `package.json` do build).
 * Ver `isReleaseNewerThanInstalled`: a comparação é SemVer, nunca por data.
 *
 * `KOLND_HUB_FORCE_UPDATE=1` força o banner — hook de teste manual, sem efeito
 * no app normal.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  // E2E (`KOLDND_HUB_TEST_USERDATA`): sem rede e sem banner, para os testes de
  // UI não dependerem do estado das releases no GitHub.
  if (process.env.KOLDND_HUB_TEST_USERDATA) {
    return { ok: true, release: null, updateAvailable: false, canAutoInstall: false }
  }
  try {
    const release = await fetchLatestRelease()
    if (!release) {
      return { ok: true, release: null, updateAvailable: false, canAutoInstall: app.isPackaged }
    }

    const installedVersion = app.getVersion()
    if (!parseVersionTag(release.tag)) {
      // Tag fora do SemVer não é atualização: melhor ignorar do que adivinhar
      // a ordem de uma numeração desconhecida.
      logger.info(
        'updates',
        `release ${release.id} ignorada: tag "${release.tag}" não é SemVer (instalado ${installedVersion})`
      )
    }

    const updateAvailable =
      process.env.KOLND_HUB_FORCE_UPDATE === '1' ||
      isReleaseNewerThanInstalled(release.tag, installedVersion)
    if (updateAvailable) {
      logger.info('updates', `atualização disponível: ${release.tag} (release ${release.id})`)
    }

    // Sem hash publicado ou fora do app instalado a UI cai para "abrir a
    // página": o próprio banner explica o motivo com `releaseInstallBlocker`
    // (motivo do lado da release) ou com o texto de build não instalado.
    const canAutoInstall = isReleaseInstallable(release, app.isPackaged)

    return { ok: true, release, updateAvailable, canAutoInstall }
  } catch (err) {
    logger.info('updates', `verificação indisponível: ${errorMessage(err)}`)
    return {
      ok: false,
      release: null,
      updateAvailable: false,
      canAutoInstall: app.isPackaged,
      error: 'Não foi possível verificar atualizações.'
    }
  }
}

function safeInstallerName(name: string, tag: string): string {
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  if (/\.exe$/i.test(sanitized)) return sanitized
  const suffix = tag.replace(/[^\w.-]/g, '_').slice(0, 40) || 'update'
  return `Kolnd-Hub-Setup-${suffix}.exe`
}

/** Remove downloads antigos da pasta própria (sem tocar em nada fora dela). */
async function cleanOldDownloads(dir: string): Promise<void> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    const deadline = Date.now() - OLD_DOWNLOAD_MS
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = join(dir, entry.name)
          try {
            const stat = await fsp.stat(filePath)
            if (stat.mtimeMs < deadline) await fsp.rm(filePath, { force: true })
          } catch {
            // Arquivo sumiu entre readdir/stat — nada a fazer.
          }
        })
    )
  } catch {
    // Pasta ainda não existe ou está inacessível: o download cria o necessário.
  }
}

function openDownloadStream(url: string, redirectsLeft: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { timeout: DOWNLOAD_IDLE_TIMEOUT_MS, headers: { 'user-agent': USER_AGENT } },
      (res) => {
        const status = res.statusCode ?? 0
        const location = res.headers.location
        if (status >= 300 && status < 400 && typeof location === 'string') {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error('Muitos redirecionamentos ao baixar o instalador.'))
            return
          }
          let next: string
          try {
            next = new URL(location, url).toString()
          } catch {
            reject(new Error('Redirecionamento inválido ao baixar o instalador.'))
            return
          }
          if (!isAllowedReleaseDownloadUrl(next)) {
            reject(new Error('O download saiu do GitHub e foi bloqueado.'))
            return
          }
          resolve(openDownloadStream(next, redirectsLeft - 1))
          return
        }

        if (status !== 200) {
          res.resume()
          reject(new Error(`GitHub respondeu HTTP ${status} ao baixar o instalador.`))
          return
        }
        activeResponse = res
        resolve(res)
      }
    )

    activeRequest = req
    req.on('close', () => {
      if (activeRequest === req) activeRequest = null
    })
    req.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () =>
      req.destroy(new Error('O download do instalador parou de responder.'))
    )
    req.on('error', reject)
  })
}

/**
 * Baixa o Setup.exe para `%TEMP%\kolnd-hub-updates` com progresso em IPC e
 * conferência de tamanho/SHA-256. Devolve o caminho local do instalador.
 */
async function downloadInstaller(
  release: ReleaseInfo,
  onProgress: (progress: UpdateProgress) => void
): Promise<string> {
  if (cancelRequested) throw new Error(CANCELLED_MESSAGE)

  const asset = release.installer
  if (!asset) throw new Error('A release não tem um instalador .exe anexado.')
  if (!asset.digest) {
    // Defesa em profundidade: `installUpdate` já recusa antes de baixar, mas um
    // download sem hash esperado nunca pode "passar" por engano.
    throw new Error('A release não publicou o hash SHA-256 do instalador.')
  }
  if (asset.size > MAX_INSTALLER_BYTES) throw new Error('O instalador é grande demais.')

  const dir = join(app.getPath('temp'), UPDATE_DIR_NAME)
  await fsp.mkdir(dir, { recursive: true })
  await cleanOldDownloads(dir)

  const filePath = join(dir, safeInstallerName(asset.name, release.tag))
  await fsp.rm(filePath, { force: true })

  const response = await openDownloadStream(asset.downloadUrl, MAX_REDIRECTS)
  if (cancelRequested) {
    response.destroy(new Error(CANCELLED_MESSAGE))
    throw new Error(CANCELLED_MESSAGE)
  }
  const headerSize = Number(response.headers['content-length'] ?? 0)
  const total =
    asset.size > 0 ? asset.size : Number.isFinite(headerSize) && headerSize > 0 ? headerSize : 0

  const output = createWriteStream(filePath)
  const hash = createHash('sha256')
  let received = 0
  let lastSent = 0

  onProgress({ received: 0, bytesTotal: total, percent: 0 })

  try {
    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        if (cancelRequested) {
          response.destroy(new Error(CANCELLED_MESSAGE))
          return
        }

        received += chunk.length
        if (received > MAX_INSTALLER_BYTES) {
          response.destroy(new Error('O instalador passou do limite de tamanho.'))
          return
        }

        hash.update(chunk)
        if (!output.write(chunk)) {
          response.pause()
          output.once('drain', () => response.resume())
        }

        const now = Date.now()
        if (now - lastSent >= 250) {
          lastSent = now
          const percent = total > 0 ? Math.min(99, Math.floor((received / total) * 100)) : 0
          onProgress({ received, bytesTotal: total, percent })
        }
      })
      response.on('error', reject)
      response.on('end', () => output.end())
      output.on('finish', resolve)
      output.on('error', reject)
    })

    if (asset.size > 0 && received !== asset.size) {
      throw new Error('O download do instalador ficou incompleto. Tente novamente.')
    }

    const digest = hash.digest('hex')
    const expectedDigest = asset.digest.slice('sha256:'.length)
    // Incondicional: asset sem `digest` é recusado antes do download, então
    // aqui sempre há um hash publicado para comparar.
    if (digest !== expectedDigest) {
      throw new Error(
        'O instalador baixado não confere com o SHA-256 publicado. Download abortado.'
      )
    }

    onProgress({ received, bytesTotal: total > 0 ? total : received, percent: 100 })
    return filePath
  } catch (err) {
    output.destroy()
    await fsp.rm(filePath, { force: true }).catch(() => undefined)
    throw err
  }
}

/**
 * Recalcula o SHA-256 do arquivo em disco em streaming (o Setup tem ~300 MB;
 * carregar tudo em memória não é opção).
 *
 * Serve para fechar a janela TOCTOU entre o download e o `spawn`: se alguém
 * trocar o arquivo nesse intervalo, o hash deixa de bater. Arquivo ausente,
 * hash esperado malformado ou erro de leitura devolvem `false` — a função
 * nunca lança, para o fluxo recusar a execução sem derrubar o app.
 */
export function verifyFileDigest(filePath: string, expectedHex: string): Promise<boolean> {
  return new Promise((resolve) => {
    const expected = expectedHex
      .trim()
      .toLowerCase()
      .replace(/^sha256:/, '')
    if (!/^[0-9a-f]{64}$/.test(expected)) {
      resolve(false)
      return
    }

    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', () => resolve(false))
    stream.on('end', () => {
      try {
        resolve(hash.digest('hex') === expected)
      } catch {
        resolve(false)
      }
    })
  })
}

/** Aspas simples em PowerShell são literais; a única forma de escapar é dobrá-las. */
function quotePowerShellLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Consulta a assinatura Authenticode do instalador baixado.
 *
 * `execFile` sem `shell: true`: o caminho entra no script como literal entre
 * aspas simples (com as aspas dobradas), não é interpretado por cmd.exe. O
 * timeout cobre a consulta de cadeia/CRL do `Get-AuthenticodeSignature`.
 *
 * Falha do PowerShell vira `unknown` e o chamador recusa — fail-closed.
 */
async function verifyInstallerSignature(filePath: string): Promise<AuthenticodeReport> {
  const script = [
    `$sig = Get-AuthenticodeSignature -LiteralPath '${quotePowerShellLiteral(filePath)}'`,
    // `Status` é enum; o ConvertTo-Json o serializaria como número. O
    // `ToString()` mantém o contrato do parser (`Valid`, `NotSigned`, …).
    // `Subject` vem do certificado do signatário, não do objeto de assinatura.
    "$sig | Select-Object @{ Name = 'Status'; Expression = { $_.Status.ToString() } }, @{ Name = 'Subject'; Expression = { if ($_.SignerCertificate) { $_.SignerCertificate.Subject } else { $null } } } | ConvertTo-Json -Compress"
  ].join('; ')

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: true, timeout: SIGNATURE_TIMEOUT_MS },
        (error, output) => {
          if (error) reject(error)
          else resolve(output)
        }
      )
    })
    return parseAuthenticodeJson(stdout)
  } catch (err) {
    // Não logar a mensagem crua: o erro do execFile repete a linha de comando
    // com o caminho do arquivo. O código basta para diagnóstico.
    const code = err instanceof Error && 'code' in err ? String(err.code) : 'desconhecido'
    logger.warn('updates', `não foi possível consultar a assinatura do instalador (${code})`)
    return { status: 'unknown', signerSubject: null }
  }
}

/**
 * Baixa e executa o instalador da release informada. O renderer só manda o
 * ID; a URL do binário é sempre reconsultada e validada aqui.
 *
 * Ao abrir o Setup, o Hub encerra depois de um instante para liberar os
 * arquivos em uso (o NSIS per-user instala por cima). O próprio instalador
 * substitui o `.exe` e, na próxima abertura, `app.getVersion()` já é a nova
 * versão.
 */
export async function installUpdate(
  ctx: IpcContext,
  releaseId: unknown
): Promise<UpdateInstallResult> {
  if (typeof releaseId !== 'number' || !Number.isSafeInteger(releaseId) || releaseId <= 0) {
    return { ok: false, error: 'Release inválida para atualização.' }
  }
  if (!app.isPackaged) {
    return {
      ok: false,
      error: 'A atualização automática só funciona no app instalado. Use a página do release.'
    }
  }
  if (installing) {
    return { ok: false, error: 'Uma atualização já está em andamento.' }
  }

  installing = true
  cancelRequested = false
  try {
    const release = await fetchRelease(updateReleaseApiUrl(releaseId))
    if (cancelRequested) {
      return { ok: false, cancelled: true, error: CANCELLED_MESSAGE }
    }
    if (!release) {
      return { ok: false, error: 'A release não está mais disponível no GitHub.' }
    }
    if (!release.installer) {
      return { ok: false, error: 'A release não tem um instalador .exe anexado.' }
    }
    const installer = release.installer
    if (!installer.digest) {
      // Sem o hash publicado não há como provar que o `.exe` é o do GitHub —
      // melhor mandar o usuário para a página do que executar às cegas.
      return {
        ok: false,
        error: `A release não publicou o hash SHA-256 do instalador; baixe e execute pela página do release: ${release.pageUrl}`
      }
    }

    logger.info('updates', `baixando ${installer.name} (release ${release.tag})`)
    const installerPath = await downloadInstaller(release, (progress) => {
      const window = ctx.getMainWindow()
      if (window && !window.isDestroyed()) {
        window.webContents.send('update:progress', progress)
      }
    })

    // Download conferido pelo SHA-256; falta garantir que o binário tem uma
    // assinatura aceitável ANTES de executar (o hash é conferido de novo
    // imediatamente antes do spawn, contra troca do arquivo em disco).
    const signature = await verifyInstallerSignature(installerPath)
    const signatureAccepted =
      isInstallerSignatureAcceptable(signature) &&
      (!REQUIRE_SIGNED_INSTALLER || signature.status === 'valid')
    if (!signatureAccepted) {
      await fsp.rm(installerPath, { force: true }).catch(() => undefined)
      logger.warn('updates', `assinatura do instalador recusada: ${signature.status}`)
      return {
        ok: false,
        error:
          'O instalador baixado tem assinatura digital inválida ou não pôde ser verificada. Por segurança, a atualização foi cancelada — baixe pela página do release.'
      }
    }
    if (signature.status === 'unsigned') {
      // Decisão 2.4: sem certificado, `NotSigned` é o esperado no projeto.
      logger.info(
        'updates',
        'instalador sem assinatura digital (NotSigned); aceito porque o projeto não assina código'
      )
    }

    // TOCTOU: o hash foi conferido durante o download, mas o arquivo em disco
    // pode ter sido trocado desde então. Recalcular IMEDIATAMENTE antes do
    // spawn fecha a janela entre "conferido" e "executado".
    const expectedDigest = installer.digest.slice('sha256:'.length)
    if (!(await verifyFileDigest(installerPath, expectedDigest))) {
      await fsp.rm(installerPath, { force: true }).catch(() => undefined)
      logger.warn(
        'updates',
        `SHA-256 do instalador não confere antes da execução (release ${release.tag}); arquivo apagado`
      )
      return {
        ok: false,
        error:
          'O instalador mudou depois do download e não confere mais com o hash publicado. Por segurança, a atualização foi cancelada — baixe pela página do release.'
      }
    }

    const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' })
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve())
      child.once('error', reject)
    })
    child.unref()

    logger.info('updates', `instalador da release ${release.tag} aberto; encerrando o Hub`)

    // Alguns milissegundos para o renderer receber a resposta do IPC e o NSIS
    // iniciar; depois o Hub fecha para o Setup substituir os arquivos.
    setTimeout(() => {
      void shutdownHub(ctx)
    }, QUIT_DELAY_MS)

    return { ok: true, action: 'installer' }
  } catch (err) {
    if (cancelRequested || (err instanceof Error && err.message === CANCELLED_MESSAGE)) {
      logger.info('updates', 'download da atualização cancelado pelo usuário')
      return { ok: false, cancelled: true, error: CANCELLED_MESSAGE }
    }
    logger.warn('updates', `falha ao atualizar: ${errorMessage(err)}`)
    return { ok: false, error: errorMessage(err) }
  } finally {
    installing = false
    cancelRequested = false
    activeResponse = null
    activeRequest = null
  }
}
