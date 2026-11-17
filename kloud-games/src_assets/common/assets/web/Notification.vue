<script>
/**
 * @file Notification.vue
 * @brief Fachada historica das notificacoes globais.
 *
 * Mantem os exports `state`, `notify` e `notifyKey` usados por `fetch_utils.js`
 * e por outros modulos; a apresentacao fica em `KgToastHost`.
 */
import KgToastHost from './components/ui/KgToastHost.vue'

export { state, notify, notifyKey, dismiss } from './components/ui/toast-store.js'

export default {
  name: 'Notification',
  components: { KgToastHost },
}
</script>

<template>
  <KgToastHost />
</template>
