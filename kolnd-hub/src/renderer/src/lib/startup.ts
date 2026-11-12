import { AppConfig, SystemProcess, StartupItem, ImportanceLevel } from '../types'

/** Extrai o nome do executável a partir do comando salvo (suporta caminhos com aspas). */
export function executableName(command: string): string {
  let token = command.trim()
  if (!token) return ''

  if (token.startsWith('"')) {
    const end = token.indexOf('"', 1)
    token = end === -1 ? token.slice(1) : token.slice(1, end)
  } else {
    token = token.split(/\s+/, 1)[0] ?? ''
  }

  const base = token.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(exe|cmd|bat|ps1|com)$/i, '').toLowerCase()
}

const EXEC_EXT = /\.(exe|cmd|bat|ps1|com)$/i

/** Verifica se um processo do sistema corresponde ao aplicativo configurado. */
export function matchesProcess(app: AppConfig, proc: SystemProcess): boolean {
  const exe = executableName(app.command)
  if (!exe) return false

  const stripExt = (s: string): string => s.toLowerCase().replace(EXEC_EXT, '')

  if (proc.name && stripExt(proc.name) === exe) return true

  const pathBase = (proc.path ?? '').split(/[\\/]/).pop() ?? ''
  return Boolean(pathBase && stripExt(pathBase) === exe)
}

const CRITICO =
  /defender|antiv[ií]rus|seguran.?a|security|firewall|[áa]udio|audio|realtek|nvidia|amd|cuda|driver|synaptics|elantech|touchpad|wmi|spooler|sysmain|superfetch|indexer|windows update|atualiza|wof|acpi|hotkey|keyboard filter|mouse filter|intel(R)?\s*(graphics|display|audio)/i
const RECOMENDADO =
  /steam|discord|spotify|teams|skype|slack|whatsapp|telegram|onedrive|dropbox|google drive|geforce experience|adrenalin|amd software|corsair|razer|logitech|msi|asus|armoury|aura|icue|vpn|dell command|hp support|lenovo vantage|nuvem/i
const INUTIL =
  /quicktime|itunes|bonjour|apple |apple$|adobe reader|acrobat|java update|adobe update|bing|cortana|widget|weather|news|xbox|game bar|overwolf|curseforge|steam web helper|steamwebhelper|click-to-run/i

/**
 * Classifica a importância de o item iniciar com o PC.
 * Pode ser sobrescrito pelo usuário (escolha salva no electron-store; ver lib/hubConfig.ts).
 */
export function classifyImportance(item: StartupItem): ImportanceLevel {
  const text = `${item.name ?? ''} ${item.path ?? ''}`.toLowerCase()
  if (CRITICO.test(text)) return 'critico'
  if (RECOMENDADO.test(text)) return 'recomendado'
  if (INUTIL.test(text)) return 'inutil'
  return 'opcional'
}
