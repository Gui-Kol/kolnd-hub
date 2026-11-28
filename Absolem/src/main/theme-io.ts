import {
  normalizeTheme,
  themeNormalizationWarnings,
  THEME_SCHEMA_VERSION,
  type ThemeConfig
} from '../shared/theme'

/**
 * Exportação e importação de tema em JSON.
 *
 * O módulo não importa `electron` nem `fs` diretamente: `fs` e `dialog` são
 * injetados pelo handler IPC, o que permite testar os quatro caminhos em Node
 * puro (sem GPU, sem Electron real).
 *
 * O arquivo exportado contém APENAS o tema e metadados: nada de dados pessoais,
 * chave ou preferências de voz. Import é entrada não confiável: tamanho máximo,
 * JSON válido, formato `app/kind` e normalização campo a campo. Um arquivo
 * inválido nunca altera o tema atual.
 */

export const THEME_APP_ID = 'absolem'
export const THEME_FILE_KIND = 'theme'
export const THEME_EXPORT_VERSION = THEME_SCHEMA_VERSION
export const MAX_THEME_FILE_BYTES = 64 * 1024

export interface ThemeExportFile {
  app: typeof THEME_APP_ID
  kind: typeof THEME_FILE_KIND
  version: number
  theme: ThemeConfig
}

/** Subconjunto de `fs/promises` usado aqui (injetável no teste). */
export interface ThemeIOFs {
  stat: (path: string) => Promise<{ size: number }>
  readFile: (path: string, encoding: 'utf8') => Promise<string>
  writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>
}

export interface ThemeFileFilter {
  name: string
  extensions: string[]
}

export interface ThemeSaveDialogOptions {
  title: string
  defaultPath: string
  filters: ThemeFileFilter[]
}

export interface ThemeOpenDialogOptions {
  title: string
  properties: Array<'openFile'>
  filters: ThemeFileFilter[]
}

/** Subconjunto de `dialog` do Electron (injetável no teste). */
export interface ThemeIODialog {
  showSaveDialog: (
    options: ThemeSaveDialogOptions
  ) => Promise<{ canceled: boolean; filePath?: string }>
  showOpenDialog: (
    options: ThemeOpenDialogOptions
  ) => Promise<{ canceled: boolean; filePaths?: string[] }>
}

export type ThemeApplyResult = { success: boolean; error?: string }

export interface ThemeIOOptions {
  fs: ThemeIOFs
  dialog: ThemeIODialog
  /** Tema vigente; o export sempre parte dele. */
  getTheme: () => ThemeConfig
  /** Persiste (e faz push) num import válido. Ausente = apenas valida. */
  applyTheme?: (theme: ThemeConfig) => ThemeApplyResult
}

export type ThemeExportResult =
  { ok: true; canceled: boolean; filePath?: string } | { ok: false; error: string }

export type ThemeImportResult =
  | { ok: true; canceled: boolean; theme?: ThemeConfig; warnings: string[] }
  | { ok: false; error: string }

export interface ThemeIO {
  buildExportFile: () => ThemeExportFile
  exportTheme: () => Promise<ThemeExportResult>
  importTheme: () => Promise<ThemeImportResult>
}

const FILE_FILTERS: ThemeFileFilter[] = [{ name: 'Tema do Absolem (JSON)', extensions: ['json'] }]

/** Payload de export puro: só tema e metadados. */
export function buildThemeExportFile(theme: ThemeConfig): ThemeExportFile {
  return {
    app: THEME_APP_ID,
    kind: THEME_FILE_KIND,
    version: THEME_EXPORT_VERSION,
    theme: normalizeTheme(theme)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function createThemeIO(options: ThemeIOOptions): ThemeIO {
  const { fs, dialog } = options

  return {
    buildExportFile(): ThemeExportFile {
      return buildThemeExportFile(options.getTheme())
    },

    async exportTheme(): Promise<ThemeExportResult> {
      try {
        const picked = await dialog.showSaveDialog({
          title: 'Exportar tema do Absolem',
          defaultPath: 'absolem-tema.json',
          filters: FILE_FILTERS
        })
        if (picked.canceled) return { ok: true, canceled: true }
        if (!picked.filePath) {
          return { ok: false, error: 'Nenhum arquivo de destino foi escolhido.' }
        }

        const file = buildThemeExportFile(options.getTheme())
        await fs.writeFile(picked.filePath, JSON.stringify(file, null, 2), 'utf8')
        return { ok: true, canceled: false, filePath: picked.filePath }
      } catch (err) {
        return { ok: false, error: `Falha ao exportar o tema: ${errorMessage(err)}` }
      }
    },

    async importTheme(): Promise<ThemeImportResult> {
      try {
        const picked = await dialog.showOpenDialog({
          title: 'Importar tema do Absolem',
          properties: ['openFile'],
          filters: FILE_FILTERS
        })
        if (picked.canceled) return { ok: true, canceled: true, warnings: [] }
        const filePath = picked.filePaths?.[0]
        if (!filePath) {
          return { ok: false, error: 'Nenhum arquivo de tema foi escolhido.' }
        }

        const info = await fs.stat(filePath)
        if (info.size > MAX_THEME_FILE_BYTES) {
          return {
            ok: false,
            error: 'O arquivo de tema passa de 64 KB e não foi importado.'
          }
        }

        const text = await fs.readFile(filePath, 'utf8')
        if (Buffer.byteLength(text, 'utf8') > MAX_THEME_FILE_BYTES) {
          return {
            ok: false,
            error: 'O arquivo de tema passa de 64 KB e não foi importado.'
          }
        }

        let parsed: unknown
        try {
          parsed = JSON.parse(text) as unknown
        } catch {
          return { ok: false, error: 'O arquivo não contém JSON válido.' }
        }
        if (!isRecord(parsed)) {
          return { ok: false, error: 'O arquivo não contém um objeto de tema.' }
        }

        let rawTheme: unknown = parsed
        if ('app' in parsed || 'kind' in parsed || 'theme' in parsed) {
          if (parsed.app !== THEME_APP_ID || parsed.kind !== THEME_FILE_KIND) {
            return { ok: false, error: 'O arquivo não é um tema do Absolem.' }
          }
          rawTheme = parsed.theme
        }
        if (!isRecord(rawTheme)) {
          return { ok: false, error: 'O arquivo não contém um objeto de tema.' }
        }

        const theme = normalizeTheme(rawTheme)
        const warnings = themeNormalizationWarnings(rawTheme)
        if (options.applyTheme) {
          const applied = options.applyTheme(theme)
          if (!applied.success) {
            return {
              ok: false,
              error: `Falha ao aplicar o tema importado: ${applied.error ?? 'erro desconhecido'}`
            }
          }
        }

        return { ok: true, canceled: false, theme, warnings }
      } catch (err) {
        return { ok: false, error: `Falha ao importar o tema: ${errorMessage(err)}` }
      }
    }
  }
}
