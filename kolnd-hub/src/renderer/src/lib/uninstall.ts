// Helpers puros para os fluxos de desinstalação (Kloud Games e Kolnd Hub).
// Nenhuma leitura de registro/disco acontece aqui — só classificação de estado
// vindo do main (via window.api.getKloudGamesUninstallStatus). Testada em
// uninstall.test.ts (ambiente node).

/** Espelho mínimo da detecção vinda do main (sem importar tipos do processo principal). */
export interface KloudDetectionLike {
  status: 'installed' | 'partial' | 'missing'
  exePath: string | null
  service: 'running' | 'stopped' | 'missing'
  entry: { productCode: string | null } | null
}

export type KloudPartialKind = 'exe-orphan' | 'registry-orphan' | 'service-orphan' | null

/**
 * Classifica uma detecção 'partial':
 * - 'exe-orphan': arquivos presentes, registro e (geralmente) serviço ausentes —
 *   o MSI não é possível; a remoção manual dos arquivos restantes é oferecida;
 * - 'registry-orphan': registro consta, executável não — o msiexec funciona,
 *   a desinstalação normal ("Desinstalar pelo registro") é oferecida;
 * - 'service-orphan': nada além do serviço KLOUD_GAMESsvc restou — só a remoção
 *   do serviço (elevada) faz sentido.
 */
export function getKloudPartialKind(
  detection: KloudDetectionLike | null | undefined
): KloudPartialKind {
  if (!detection || detection.status !== 'partial') return null
  if (detection.exePath) return 'exe-orphan'
  if (detection.entry) return 'registry-orphan'
  if (detection.service !== 'missing') return 'service-orphan'
  return null
}

/** Status honesto e amigável para cada órfão (usado no card da Zona de perigo). */
export function getKloudPartialStatusText(kind: KloudPartialKind): string {
  switch (kind) {
    case 'exe-orphan':
      return 'Instalação quebrada detectada (arquivos sem registro) — a remoção dos arquivos restantes é oferecida.'
    case 'registry-orphan':
      return 'Instalação quebrada detectada (registro sem o programa) — a desinstalação pelo registro será tentada.'
    case 'service-orphan':
      return 'Instalação quebrada detectada (só o serviço KLOUD_GAMESsvc restou) — remova o serviço.'
    default:
      return 'Instalação parcial detectada — a desinstalação tentará limpar o que for possível.'
  }
}

/** Diretório pai de um caminho Windows, tolerante a barras finais e mescladas. */
export function getParentDir(path: string): string {
  const trimmed = (path ?? '').replace(/[\\/]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (idx === -1) return trimmed
  // Filho direto da raiz do drive ("C:\arquivo") → pai é a raiz "C:\".
  if (idx === 2 && /^[a-zA-Z]:/.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, idx)
}

export interface HubOnlyArgs {
  wipeUserData: boolean
  skipKloud: true
  backupPath: string | null
}

/**
 * Argumentos do retry "Desinstalar só o Hub" (após o Kloud Games falhar):
 * preserva a escolha de dados (apagar/manter) e o backup já feito na confirmação.
 */
export function buildSkipKloudHubArgs(
  wipeUserData: boolean,
  backupPath: string | null
): HubOnlyArgs {
  return { wipeUserData: wipeUserData === true, skipKloud: true, backupPath }
}
