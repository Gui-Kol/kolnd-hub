<template>
  <nav class="navbar navbar-KLOUD_GAMES">
    <div class="container-fluid">
      <span class="navbar-brand" title="KLOUD_GAMES">
        <img src="/images/logo-KLOUD_GAMES-45.png" height="45" alt="KLOUD_GAMES">
      </span>
      <ThemeToggle/>
    </div>
  </nav>
</template>

<script>
import ThemeToggle from './ThemeToggle.vue'

export default {
  components: {
    ThemeToggle,
  },
}
</script>
