<script>
import AppShell from './components/AppShell.vue'

/**
 * @file Navbar.vue
 * @brief Wrapper historico do shell completo (mantido para imports existentes).
 *
 * Renderiza a faixa de marca + topbar + toasts; o conteudo da pagina continua
 * sendo renderizado por ela mesma (fora do Navbar).
 */
export default {
  name: 'Navbar',
  components: { AppShell },
}
</script>

<template>
  <AppShell chrome-only />
</template>
