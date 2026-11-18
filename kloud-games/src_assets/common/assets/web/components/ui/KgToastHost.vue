<script>
import { AlertCircle, AlertTriangle, CheckCircle, Info } from '@lucide/vue'
import { dismiss, state } from './toast-store.js'

/**
 * @file KgToastHost.vue
 * @brief Apresentacao dos toasts globais (canto inferior direito).
 */
export default {
  name: 'KgToastHost',
  components: { AlertCircle, AlertTriangle, CheckCircle, Info },
  setup() {
    return { state, dismiss }
  },
  methods: {
    /**
     * @brief Map a notification tone to its icon component.
     *
     * @param {string} type Notification tone.
     * @return {object} Lucide component.
     */
    iconFor(type) {
      return { danger: 'AlertCircle', warning: 'AlertTriangle', success: 'CheckCircle', info: 'Info' }[type] || 'Info'
    },
  },
}
</script>

<template>
  <div class="kg-toast-host" aria-live="polite" aria-atomic="false">
    <div
      v-for="notification in state.notifications"
      :key="notification.id"
      class="kg-toast"
      :class="`kg-toast-${notification.type}`"
      role="status"
    >
      <component :is="iconFor(notification.type)" :size="18" class="kg-icon" aria-hidden="true"></component>
      <div class="kg-grow">
        <div v-if="notification.titleKey || notification.title" class="kg-toast-title">
          {{ notification.titleKey ? $t(notification.titleKey) : notification.title }}
        </div>
        <span>{{ notification.messageKey ? $t(notification.messageKey) : notification.message }}</span>
      </div>
      <button type="button" class="kg-iconbtn" :aria-label="$t('_common.dismiss')" @click="dismiss(notification.id)">
        <svg class="kg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
