import { reactive } from 'vue'

/**
 * @file host-meta.js
 * @brief Metadados do host publicados pelas paginas que ja carregaram `/api/config`.
 *
 * O shell nao faz requisicoes: ele apenas exibe a versao depois que alguma
 * pagina publica o valor recebido da API.
 */

/** @type {{version: string, name: string}} */
export const hostMeta = reactive({
  version: '',
  name: '',
})

/**
 * @brief Publish the host metadata read from `/api/config`.
 *
 * @param {object|null} config Host configuration payload.
 * @return {void}
 */
export function publishHostMeta(config) {
  if (!config) return
  if (config.version) hostMeta.version = String(config.version)
  const name = config.KLOUD_GAMES_name || config.host_name
  if (name) hostMeta.name = String(name)
}
