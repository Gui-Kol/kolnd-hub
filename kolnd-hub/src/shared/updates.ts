// Atualizações do app via GitHub Releases.
//
// FRONTEIRA: importável por `main/`, `preload/` e `renderer/` (mesmo padrão de
// `shared/remote.ts`). Só tipos e lógica PURA — nada de Electron, `https` ou
// `fs`. O main baixa e executa; o renderer só exibe o que o main devolveu.
//
// Por que não electron-updater: o processo de release do projeto publica o
// instalador NSIS como asset do GitHub, sem `latest.yml`. Consultar a API de
// releases e baixar o `.exe` anexado é o caminho que funciona com o formato
// atual (e com nomes de asset variados entre releases).

/** Repositório público de onde o Hub lê as releases. */
export const UPDATE_REPO = 'Gui-Kol/kolnd-hub'

export const UPDATE_RELEASES_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases`

export const UPDATE_LATEST_RELEASE_API_URL = `${UPDATE_RELEASES_API_URL}/latest`

/** Teto do instalador: hoje o Setup tem ~300 MB; 800 MB cobre folga. */
export const MAX_INSTALLER_BYTES = 800 * 1024 * 1024

/**
 * Formato de tag aceito: `v?X.Y.Z` com prerelease opcional (`1.5.0-beta.1`).
 * Build metadata (`+sha`) não altera precedência SemVer — é descartado antes
 * da validação para não recusar uma tag válida por causa dele.
 */
const VERSION_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Identificadores do sufixo prerelease (`beta.1` → `['beta', '1']`); vazio = estável. */
  prerelease: string[]
}

/**
 * Interpreta uma tag de release (`v1.5.0`, `1.5.0-beta.1`). Tag fora do
 * formato devolve `null` — nesse caso o main não mostra banner (uma tag
 * desconhecida não é uma atualização, e adivinhar seria pior que ignorar).
 */
export function parseVersionTag(tag: string): ParsedVersion | null {
  if (typeof tag !== 'string') return null

  const withoutBuild = tag.trim().replace(/\+[0-9A-Za-z.-]+$/, '')
  const match = VERSION_TAG_PATTERN.exec(withoutBuild)
  if (!match) return null

  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (![major, minor, patch].every(Number.isSafeInteger)) return null

  const prerelease = match[4] ? match[4].split('.') : []
  // Identificador vazio (`1.0.0-a..b`) não é SemVer válido.
  if (prerelease.some((identifier) => identifier.length === 0)) return null

  return { major, minor, patch, prerelease }
}

/** Compara identificadores de prerelease com a precedência do SemVer 2.0.0. */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  // Sem sufixo = versão estável, que ordena DEPOIS de qualquer prerelease.
  if (a.length === 0) return 1
  if (b.length === 0) return -1

  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const left = a[index]
    const right = b[index]
    // Menos identificadores ordena antes quando todos os anteriores são iguais.
    if (left === undefined) return -1
    if (right === undefined) return 1

    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    // Identificador numérico sempre ordena antes do alfanumérico.
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    if (left !== right) return left < right ? -1 : 1
  }
  return 0
}

/** Compara duas versões já interpretadas: `-1`, `0` ou `1` (precedência SemVer). */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Diz se a tag da release é mais nova que a versão instalada.
 *
 * A comparação é por SemVer contra `app.getVersion()` (fonte única: o `version`
 * do `package.json`, embutido no build) — não pela data de publicação nem pelo
 * `birthtime` do executável. Data/birthtime refletem a máquina (cópia de
 * arquivo, backup, relógio errado), não a versão; e a tag `vX.Y.Z` agora é
 * exigida idêntica ao `package.json` no workflow de release.
 *
 * Qualquer lado fora do formato SemVer devolve `false`: na dúvida, não avisa.
 */
export function isReleaseNewerThanInstalled(releaseTag: string, installedVersion: string): boolean {
  const release = parseVersionTag(releaseTag)
  const installed = parseVersionTag(installedVersion)
  if (!release || !installed) return false
  return compareVersions(release, installed) > 0
}

/** URL da release específica (usada pelo main para reconsultar por ID). */
export function updateReleaseApiUrl(releaseId: number): string {
  return `${UPDATE_RELEASES_API_URL}/${releaseId}`
}

export interface ReleaseAsset {
  name: string
  /** Tamanho informado pelo GitHub em bytes (0 = desconhecido). */
  size: number
  downloadUrl: string
  /** `sha256:<hex>` quando o GitHub informa o digest; null nos assets antigos. */
  digest: string | null
}

export interface ReleaseInfo {
  /** ID numérico estável do GitHub — é o que o renderer devolve no install. */
  id: number
  tag: string
  name: string
  pageUrl: string
  publishedAt: string | null
  /** Corpo da release (já truncado para não inflar a UI). */
  notes: string
  /** `.exe` de instalação escolhido; null quando a release só tem zip/portable. */
  installer: ReleaseAsset | null
}

export interface UpdateCheckResult {
  ok: boolean
  release: ReleaseInfo | null
  /**
   * `true` quando a tag da release é mais nova que a versão instalada segundo
   * SemVer (ver `isReleaseNewerThanInstalled`); tags fora do formato nunca
   * viram atualização.
   */
  updateAvailable: boolean
  /**
   * Só no app empacotado, com instalador `.exe` **e** `digest` SHA-256
   * publicado (ver `isReleaseInstallable`). Sem qualquer um dos três, o
   * banner cai para "abrir a página do release".
   */
  canAutoInstall: boolean
  error?: string
}

export interface UpdateProgress {
  received: number
  bytesTotal: number
  /** 0–100 (arredondado); 100 só quando o download terminou e o hash conferiu. */
  percent: number
}

export interface UpdateInstallResult {
  ok: boolean
  /** `installer` = download concluído e Setup aberto (o Hub vai encerrar). */
  action?: 'installer' | 'page'
  pageUrl?: string
  /** `true` quando o usuário cancelou o download em andamento. */
  cancelled?: boolean
  error?: string
}

const MAX_ASSET_NAME = 200
const MAX_RELEASE_TAG = 64
const MAX_URL = 2048
const MAX_NOTES = 4000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL) return ''
  return value
}

/**
 * Só o próprio GitHub: a URL de download inicial aponta para o repositório
 * público; redirecionamentos do CDN ficam em `*.githubusercontent.com`.
 * Isso impede o main de baixar um `.exe` de qualquer host que a resposta da
 * API (ou um MITM) mande.
 */
export function isAllowedReleaseDownloadUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    if (host === 'github.com') {
      return url.pathname.startsWith(`/${UPDATE_REPO}/releases/download/`)
    }
    return host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

export function isAllowedReleasePageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'github.com' &&
      url.pathname.startsWith(`/${UPDATE_REPO}/releases/`)
    )
  } catch {
    return false
  }
}

function parseAsset(raw: unknown): ReleaseAsset | null {
  if (!isRecord(raw)) return null
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name || name.length > MAX_ASSET_NAME) return null

  const downloadUrl = readUrl(raw.browser_download_url)
  if (!downloadUrl || !isAllowedReleaseDownloadUrl(downloadUrl)) return null

  const size =
    typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size >= 0
      ? Math.trunc(raw.size)
      : 0
  if (size > MAX_INSTALLER_BYTES) return null

  const rawDigest = typeof raw.digest === 'string' ? raw.digest.trim().toLowerCase() : ''
  const digest = /^sha256:[0-9a-f]{64}$/.test(rawDigest) ? rawDigest : null

  return { name, size, downloadUrl, digest }
}

/**
 * Escolhe o instalador NSIS entre os assets. O nome varia entre releases
 * (`Kolnd Hub Setup 1.5.0.exe`, `Kolnd.Hub.Setup.1.0.Estavel.exe`,
 * `KH-v1.1.0-beta-setup.exe`), então a regra é: precisa ser `.exe` e não pode
 * ser o pacote portable; entre os candidatos, prefere o que tem "setup".
 */
export function pickInstallerAsset(rawAssets: unknown): ReleaseAsset | null {
  if (!Array.isArray(rawAssets)) return null
  const assets = rawAssets
    .map(parseAsset)
    .filter((asset): asset is ReleaseAsset => asset !== null)
    .filter((asset) => /\.exe$/i.test(asset.name) && !/portable|unpacked/i.test(asset.name))

  return assets.find((asset) => /setup|instalador|installer/i.test(asset.name)) ?? assets[0] ?? null
}

/**
 * Valida a resposta da API do GitHub sem confiar no formato: campos
 * ausentes/estranhos viram fallback ou descartam a release inteira.
 */
export function parseRelease(raw: unknown): ReleaseInfo | null {
  if (!isRecord(raw)) return null

  const id = raw.id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null

  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : ''
  if (!tag || tag.length > MAX_RELEASE_TAG) return null

  const pageUrl = readUrl(raw.html_url)
  if (!pageUrl || !isAllowedReleasePageUrl(pageUrl)) return null

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : tag
  const rawPublishedAt = typeof raw.published_at === 'string' ? raw.published_at.trim() : ''
  const publishedAt = rawPublishedAt && rawPublishedAt.length <= 40 ? rawPublishedAt : null
  const notes = typeof raw.body === 'string' ? raw.body.slice(0, MAX_NOTES) : ''

  return {
    id,
    tag,
    name,
    pageUrl,
    publishedAt,
    notes,
    installer: pickInstallerAsset(raw.assets)
  }
}

/**
 * Motivo (pt-BR) **do lado da release** para não instalar pelo próprio app:
 * asset de instalação ausente ou sem `digest` SHA-256 publicado.
 *
 * O GitHub só informa `digest` para asset anexado à Release (artifacts do
 * workflow não têm hash na API) — por isso uma release "sem hash" continua
 * visível no banner, mas só pela página. Sem o hash não há como provar que o
 * `.exe` baixado é o que o repositório publicou.
 */
export function releaseInstallBlocker(release: ReleaseInfo): string | null {
  if (!release.installer) {
    return 'Esta release não tem um instalador .exe anexado. Abra a página do release para baixar manualmente.'
  }
  if (!release.installer.digest) {
    return 'Esta release não publicou o hash SHA-256 do instalador. Por segurança, baixe pela página do release.'
  }
  return null
}

/**
 * Diz se o app pode baixar e executar o instalador sozinho: build empacotado
 * (dev/portable não substitui os arquivos em uso) **e** release com instalador
 * + hash publicado. O digest é obrigatório — fail-open aqui seria executar um
 * binário não conferido.
 */
export function isReleaseInstallable(release: ReleaseInfo, isPackaged: boolean): boolean {
  return isPackaged && releaseInstallBlocker(release) === null
}

/**
 * Resultado normalizado do `Get-AuthenticodeSignature`:
 * - `valid` → assinatura íntegra e confiável;
 * - `unsigned` → executável sem assinatura (`NotSigned`);
 * - `invalid` → assinatura presente mas recusável (`HashMismatch`, `NotTrusted`,
 *   `ValidButUntrusted`, `UnknownError`, `NotSupported`, `Incompatible`…);
 * - `unknown` → saída ilegível/vazia ou status não reconhecido.
 */
export type AuthenticodeStatus = 'valid' | 'unsigned' | 'invalid' | 'unknown'

export interface AuthenticodeReport {
  status: AuthenticodeStatus
  signerSubject: string | null
}

/** Nome máximo aceito para o `Subject` do certificado (evita string gigante). */
const MAX_SIGNER_SUBJECT = 512

function mapAuthenticodeStatus(raw: string): AuthenticodeStatus {
  switch (raw.trim().toLowerCase()) {
    case 'valid':
      return 'valid'
    case 'notsigned':
      return 'unsigned'
    case 'hashmismatch':
    case 'nottrusted':
    case 'validbutuntrusted':
    case 'unknownerror':
    case 'notsupported':
    case 'incompatible':
      return 'invalid'
    default:
      // Status desconhecido é tratado como ilegível: fail-closed.
      return 'unknown'
  }
}

/**
 * Lê a saída do PowerShell que emite `{ Status, Subject }` em JSON compacto.
 *
 * Tolerante a ruído porque o `powershell.exe` pode imprimir avisos antes da
 * linha útil: percorre de trás para frente e usa a última linha que seja um
 * objeto JSON com `Status` string. Sem isso, um aviso qualquer faria a
 * verificação passar por engano (ou falhar sempre).
 */
export function parseAuthenticodeJson(raw: string): AuthenticodeReport {
  if (typeof raw !== 'string') return { status: 'unknown', signerSubject: null }

  const lines = raw.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim()
    if (!line.startsWith('{')) continue
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isRecord(parsed) || typeof parsed.Status !== 'string') continue
      const subject = typeof parsed.Subject === 'string' ? parsed.Subject.trim() : ''
      return {
        status: mapAuthenticodeStatus(parsed.Status),
        signerSubject: subject && subject.length <= MAX_SIGNER_SUBJECT ? subject : null
      }
    } catch {
      // Linha com JSON quebrado: tenta a anterior (ruído do PowerShell).
    }
  }

  return { status: 'unknown', signerSubject: null }
}

/**
 * Política de assinatura do instalador: aceita `Valid` **e** `NotSigned`
 * (unsigned); recusa assinatura quebrada/desconhecida. O projeto decidiu em
 * 18/11/2026 não comprar certificado (item 2.4), e o instalador atual é
 * `NotSigned` — exigir `Valid` aqui bloquearia toda atualização.
 *
 * O endurecimento opcional vive em `REQUIRE_SIGNED_INSTALLER` (`appUpdates.ts`):
 * com `true`, só `valid` passa.
 */
export function isInstallerSignatureAcceptable(report: AuthenticodeReport): boolean {
  return report.status === 'valid' || report.status === 'unsigned'
}
