import { existsSync, mkdirSync, cpSync, copyFileSync, renameSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { findKloudGamesExe, getKloudGamesDir } from './kloudGames'

export interface ProgramDeployResult {
  id: string
  name: string
  installed: boolean
  path?: string
  error?: string
}

/** Caminho base do Kolnd Hub (diretório do .exe em produção, raiz do projeto em dev). */
function getHubBaseDir(): string {
  return app?.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
}

/** Caminho onde os programas embutidos ficam dentro do app. */
function getProgramsDir(): string {
  // Em produção, os recursos extras ficam em <install-dir>/resources/programs.
  // Em dev, ficam em <project>/resources/programs.
  if (app?.isPackaged) {
    return join(process.resourcesPath, 'programs')
  }
  return join(getHubBaseDir(), 'resources', 'programs')
}

/**
 * Pasta de dados graváveis do Mark LVI para quando o Hub o lança.
 * `%APPDATA%/kolnd-hub/mark-lvi` — ver `MARK_LVI_HOME` em core/paths.py do Mark LVI.
 * Manter fora da pasta de instalação evita (a) falha de permissão se um dia o
 * Hub for instalado em Program Files e (b) perda silenciosa de dados no
 * desinstalador (que remove o diretório da instalação).
 */
export function getMarkLviDataDir(): string {
  return join(app.getPath('userData'), 'mark-lvi')
}

/**
 * Copia, arquivo a arquivo (temp → rename atômico), os arquivos de
 * `config/` e `memory/` do Mark LVI empacotado para a pasta de dados do
 * usuário. Só copia quando o destino não existe ou é mais antigo que a
 * fonte. Roda a cada boot — no pior caso stats alguns arquivos.
 *
 * Por quê: quem já usou a versão anterior tem config/memory AO LADO do exe
 * (recursos/resources/programs/MarkLVI). O Mark LVI reconstruído (com
 * core/paths.py honrando MARK_LVI_HOME) passa a ler/gravar em
 * %APPDATA%/kolnd-hub/mark-lvi — sem este seed a chave de API e a memória
 * ficariam "perdidas" na troca. Falha aqui NUNCA bloqueia o app.
 */
export function seedMarkLviData(): void {
  try {
    const source = join(getProgramsDir(), 'MarkLVI')
    const dataDir = getMarkLviDataDir()
    let copied = 0

    for (const sub of ['config', 'memory']) {
      const srcDir = join(source, sub)
      if (!existsSync(srcDir)) continue

      let entries: string[] = []
      try {
        entries = readdirSync(srcDir)
      } catch {
        continue // sem permissão para ler — não bloqueia
      }

      for (const name of entries) {
        const src = join(srcDir, name)
        let srcStat
        try {
          srcStat = statSync(src)
        } catch {
          continue
        }
        if (!srcStat.isFile()) continue // certs/ whatsapp_web/ são diretórios — fora do seed

        const destDir = join(dataDir, sub)
        const dest = join(destDir, name)
        try {
          const destStat = existsSync(dest) ? statSync(dest) : null
          if (destStat && destStat.mtimeMs >= srcStat.mtimeMs) continue

          mkdirSync(destDir, { recursive: true })
          const tmp = join(destDir, `.${name}.tmp-${process.pid}`)
          copyFileSync(src, tmp)
          renameSync(tmp, dest)
          copied++
        } catch (err) {
          console.warn(`[programsDeployer] seed do Mark LVI: falha em ${src} → ${dest}:`, err)
        }
      }
    }

    if (copied > 0) {
      console.log(
        `[programsDeployer] seed do Mark LVI: ${copied} arquivo(s) copiado(s) para ${dataDir}`
      )
    }
  } catch (err) {
    console.warn('[programsDeployer] seed do Mark LVI falhou (não bloqueia o app):', err)
  }
}

/** Verifica/copia o build do Mark LVI para resources/programs/MarkLVI. */
function deployMarkLvi(): ProgramDeployResult {
  const targetDir = join(getProgramsDir(), 'MarkLVI')
  const targetExe = join(targetDir, 'MarkLVI.exe')

  if (existsSync(targetExe)) {
    return { id: 'mark-lvi', name: 'Mark LVI (JARVIS)', installed: true, path: targetDir }
  }

  // Em desenvolvimento, tenta copiar do fonte/build local se existir.
  // NUNCA em produção: o pacote instalado deve vir exclusivamente dos
  // resources/ embutidos no .exe (extraResources) — copiar de uma árvore de
  // desenvolvimento para dentro da instalação mascararia um pacote quebrado.
  const isDev = !app?.isPackaged
  if (isDev) {
    const sourceDir = join(getHubBaseDir(), '..', 'Mark-LVI', 'dist', 'MarkLVI')
    const sourceExe = join(sourceDir, 'MarkLVI.exe')

    if (existsSync(sourceExe)) {
      try {
        console.log(
          `[programsDeployer] DEV fallback: copiando Mark LVI de ${sourceDir} para ${targetDir} (não ocorre em produção)`
        )
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true })
        }
        cpSync(sourceDir, targetDir, { recursive: true })
        return { id: 'mark-lvi', name: 'Mark LVI (JARVIS)', installed: true, path: targetDir }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          id: 'mark-lvi',
          name: 'Mark LVI (JARVIS)',
          installed: false,
          error: `Falha ao copiar Mark LVI: ${message}`
        }
      }
    }
  }

  return {
    id: 'mark-lvi',
    name: 'Mark LVI (JARVIS)',
    installed: false,
    error: `Executável não encontrado em ${targetExe}. Em produção, o instalador deve embutir este programa em resources/programs/MarkLVI.`
  }
}

/** Verifica se o Kloud Games está instalado (instala via MSI embutido no 1º run). */
function deployKloudGames(): ProgramDeployResult {
  const installedExe = findKloudGamesExe()

  if (installedExe) {
    return { id: 'kloud-games', name: 'Kloud Games', installed: true, path: installedExe }
  }

  const msi = join(getKloudGamesDir(), 'KLOUD_GAMES.msi')
  if (existsSync(msi)) {
    return {
      id: 'kloud-games',
      name: 'Kloud Games',
      installed: false,
      error: `MSI do Kloud Games embutido em ${msi}, mas ainda não instalado. Execute a instalação pela tela de primeira execução (ou instale manualmente com msiexec /i "${msi}").`
    }
  }

  return {
    id: 'kloud-games',
    name: 'Kloud Games',
    installed: false,
    error:
      'KLOUD_GAMES.exe não encontrado e MSI do Kloud Games não embutido em resources/programs/kloud-games/.'
  }
}

/** Verifica/implanta todos os programas do ecossistema. */
export async function deployPrograms(): Promise<ProgramDeployResult[]> {
  return [deployMarkLvi(), deployKloudGames()]
}

/** Gera um relatório em texto do resultado da implantação. */
export function formatDeployReport(results: ProgramDeployResult[]): string {
  const lines: string[] = ['=== Implantação de Programas ===']
  for (const result of results) {
    lines.push(
      `${result.name}: ${result.installed ? 'OK' : 'FALHOU'}${result.path ? ` (${result.path})` : ''}${result.error ? ` — ${result.error}` : ''}`
    )
  }
  return lines.join('\n')
}
