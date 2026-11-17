<script>
import { CircleUserRound, LogOut, Shield } from '@lucide/vue'
import KgDropdown from './ui/KgDropdown.vue'

/**
 * @file UserMenu.vue
 * @brief Menu de usuario: troca de senha e saida.
 */
export default {
  name: 'UserMenu',
  components: { KgDropdown, CircleUserRound, LogOut, Shield },
  methods: {
    /**
     * @brief Expire the session with the historical basic-auth trick, then open `/logout`.
     *
     * @return {void}
     */
    logout() {
      const cacheBuster = Date.now().toString()
      const logoutPageUrl = new URL('/logout', globalThis.location.href)
      const request = new XMLHttpRequest()
      const finish = () => {
        globalThis.location.replace(logoutPageUrl.toString())
      }

      request.open('GET', '/', true, 'KLOUD_GAMES-logout', cacheBuster)
      request.setRequestHeader('Cache-Control', 'no-store')
      request.onload = finish
      request.onerror = finish
      request.ontimeout = finish
      request.timeout = 5000
      request.send()
    },
  },
}
</script>

<template>
  <KgDropdown :label="$t('navbar.password')" align="right">
    <template #trigger>
      <CircleUserRound :size="18" class="kg-icon" aria-hidden="true"></CircleUserRound>
    </template>
    <template #default>
      <RouterLink role="menuitem" class="kg-dropdown-item" to="/password">
        <Shield :size="16" class="kg-icon" aria-hidden="true"></Shield>
        <span class="kg-grow">{{ $t('navbar.password') }}</span>
      </RouterLink>
      <div class="kg-dropdown-divider" role="separator"></div>
      <button type="button" role="menuitem" class="kg-dropdown-item" @click="logout">
        <LogOut :size="16" class="kg-icon" aria-hidden="true"></LogOut>
        <span class="kg-grow">{{ $t('navbar.logout') }}</span>
      </button>
    </template>
  </KgDropdown>
</template>
