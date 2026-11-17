<script>
import { Zap } from '@lucide/vue'
import ThemeMenu from './components/ThemeMenu.vue'
import Notification from './Notification.vue'

/**
 * @file NavbarSimple.vue
 * @brief Faixa minima para paginas sem navegacao (Welcome/Logout).
 *
 * Mantem a identidade e o seletor de tema; nao faz requisicoes.
 */
export default {
  name: 'NavbarSimple',
  components: { ThemeMenu, Notification, Zap },
}
</script>

<template>
  <div>
    <div class="kg-brandstrip">
      <div class="kg-brandstrip-left">
        <div class="kg-brandmark" aria-hidden="true">
          <Zap :size="14"></Zap>
        </div>
        <span class="kg-brandname">Kloud Games</span>
      </div>
      <div class="kg-brandstrip-right">
        <ThemeMenu />
      </div>
    </div>
    <Notification />
  </div>
</template>
