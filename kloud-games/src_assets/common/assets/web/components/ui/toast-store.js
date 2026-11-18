import { reactive } from 'vue'

/**
 * @file toast-store.js
 * @brief Estado reativo singleton das notificacoes globais.
 *
 * Modulos JS puros (como `fetch_utils.js`) e componentes Vue compartilham o
 * mesmo objeto reativo; qualquer host montado (KgToastHost) reage as mudancas.
 */

/** @type {{notifications: Array<object>, _nextId: number}} */
export const state = reactive({
  notifications: [],
  _nextId: 1,
})

/**
 * @brief Push a notification using raw strings.
 *
 * @param {'danger'|'warning'|'success'|'info'} type Notification tone.
 * @param {string} message Body text.
 * @param {string} [title] Optional bold title.
 * @return {void}
 */
function push(type, message, title) {
  state.notifications.push({
    id: state._nextId++,
    type,
    message,
    title: title || null,
    messageKey: null,
    titleKey: null,
  })
}

/**
 * @brief Push a notification using i18n translation keys.
 *
 * @param {'danger'|'warning'|'success'|'info'} type Notification tone.
 * @param {string} messageKey i18n key for the body.
 * @param {string} [titleKey] Optional i18n key for the title.
 * @return {void}
 */
function pushKey(type, messageKey, titleKey) {
  state.notifications.push({
    id: state._nextId++,
    type,
    message: null,
    title: null,
    messageKey,
    titleKey: titleKey || null,
  })
}

/**
 * @brief Remove a notification by id.
 *
 * @param {number} id Notification id.
 * @return {void}
 */
export function dismiss(id) {
  const index = state.notifications.findIndex(notification => notification.id === id)
  if (index !== -1) state.notifications.splice(index, 1)
}

/** Helpers using raw strings. */
export const notify = {
  /** @param {string} message @param {string} [title] @return {void} */
  error: (message, title) => push('danger', message, title),
  /** @param {string} message @param {string} [title] @return {void} */
  warning: (message, title) => push('warning', message, title),
  /** @param {string} message @param {string} [title] @return {void} */
  success: (message, title) => push('success', message, title),
  /** @param {string} message @param {string} [title] @return {void} */
  info: (message, title) => push('info', message, title),
}

/** Helpers using i18n keys. */
export const notifyKey = {
  /** @param {string} messageKey @param {string} [titleKey] @return {void} */
  error: (messageKey, titleKey) => pushKey('danger', messageKey, titleKey),
  /** @param {string} messageKey @param {string} [titleKey] @return {void} */
  warning: (messageKey, titleKey) => pushKey('warning', messageKey, titleKey),
  /** @param {string} messageKey @param {string} [titleKey] @return {void} */
  success: (messageKey, titleKey) => pushKey('success', messageKey, titleKey),
  /** @param {string} messageKey @param {string} [titleKey] @return {void} */
  info: (messageKey, titleKey) => pushKey('info', messageKey, titleKey),
}
