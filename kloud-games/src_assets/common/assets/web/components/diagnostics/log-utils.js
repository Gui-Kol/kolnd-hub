/**
 * @file log-utils.js
 * @brief Parse e filtragem segura do log textual do host.
 *
 * O host devolve texto puro no formato `[YYYY-MM-DD HH:MM:SS.mmm]: Level: msg`.
 * Nada aqui produz HTML: os componentes renderizam os campos como texto, o que
 * elimina qualquer risco de injecao (nao ha `v-html`).
 */

const TIMESTAMP = /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]:/g
const LEVEL = /^\[[^\]]+\]:\s*([A-Za-z]+):/

/**
 * @brief Split raw log text into timestamp-prefixed entries.
 *
 * @param {string} text Raw log output.
 * @return {Array<{index: number, raw: string, timestamp: string, level: string, levelClass: string, message: string}>} Parsed entries.
 */
export function parseLogEntries(text) {
  const source = text || ''
  const matches = Array.from(source.matchAll(TIMESTAMP))
  if (!matches.length) {
    const raw = source.trim()
    if (!raw) return []
    return [{ index: 0, raw, timestamp: '', level: 'Info', levelClass: 'kg-log-info', message: raw }]
  }

  const entries = []
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length
    const raw = source.slice(start, end).trimEnd()
    if (!raw) continue

    const timestamp = matches[i][0]
    const remainder = raw.slice(timestamp.length).trimStart()
    const levelMatch = LEVEL.exec(raw)
    const declared = levelMatch ? levelMatch[1] : 'Info'
    const level = ['Fatal', 'Error', 'Critical', 'Warning', 'Debug', 'Info'].includes(declared)
      ? declared
      : 'Info'

    entries.push({
      index: entries.length,
      raw,
      timestamp,
      level,
      levelClass: levelClass(level),
      message: remainder,
    })
  }
  return entries
}

/**
 * @brief Map a log level to the terminal line class.
 *
 * @param {string} level Declared log level.
 * @return {string} CSS class for the line.
 */
export function levelClass(level) {
  if (level === 'Fatal') return 'kg-log-fatal'
  if (level === 'Error' || level === 'Critical') return 'kg-log-error'
  if (level === 'Warning') return 'kg-log-warning'
  if (level === 'Debug') return 'kg-log-debug'
  return 'kg-log-info'
}

/**
 * @brief Filter raw log text by a case-insensitive substring.
 *
 * @param {string} text Raw log output.
 * @param {string} filter User filter.
 * @return {string} Filtered log text (whole lines).
 */
export function filterLogText(text, filter) {
  if (!filter) return text || ''
  const needle = filter.toLowerCase()
  return (text || '')
    .split('\n')
    .filter(line => line.toLowerCase().includes(needle))
    .join('\n')
}

/**
 * @brief Return the last entries of the log, newest last.
 *
 * @param {string} text Raw log output.
 * @param {number} [limit] Maximum number of entries.
 * @return {Array<object>} Recent parsed entries.
 */
export function recentLogEntries(text, limit = 5) {
  const entries = parseLogEntries(text)
  return entries.slice(-limit)
}

/**
 * @brief Collect the indices of warning/error/fatal entries for navigation.
 *
 * @param {Array<object>} entries Parsed entries.
 * @return {number[]} Indices to navigate.
 */
export function navigableEntryIndices(entries) {
  return entries
    .filter(entry => ['Warning', 'Error', 'Fatal', 'Critical'].includes(entry.level))
    .map(entry => entry.index)
}
