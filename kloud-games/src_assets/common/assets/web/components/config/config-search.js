/**
 * @file config-search.js
 * @brief Indice e filtro da busca de opcoes de configuracao.
 *
 * A busca e puramente local: nao mexe em `style.display` global nem faz
 * requisicoes. O componente usa o resultado para trocar de aba e destacar.
 */

/**
 * @brief Build a searchable index of every configuration option.
 *
 * @param {Array<{id: string, nameKey: string, options: object}>} tabs Configuration tabs.
 * @param {(key: string) => string} translate Translation helper.
 * @return {Array<{key: string, label: string, tab: string, tabId: string}>} Option index.
 */
export function buildOptionIndex(tabs, translate = key => key) {
  const options = []
  for (const tab of tabs) {
    for (const key of Object.keys(tab.options || {})) {
      options.push({
        key,
        label: key.replaceAll('_', ' ').replaceAll(/\b\w/g, letter => letter.toUpperCase()),
        tab: translate(tab.nameKey),
        tabId: tab.id,
      })
    }
  }
  return options
}

/**
 * @brief Filter option index entries by key or label.
 *
 * @param {Array<object>} options Option index.
 * @param {string} query User query.
 * @return {Array<object>} Matching options, preserving index order.
 */
export function filterOptions(options, query) {
  const trimmed = (query || '').trim().toLowerCase()
  if (!trimmed) return []
  return options.filter(option =>
    option.key.toLowerCase().includes(trimmed) || option.label.toLowerCase().includes(trimmed)
  )
}
