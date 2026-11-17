<template>
  <NavbarSimple></NavbarSimple>
  <main class="kg-main kg-main--narrow" style="justify-content: center; min-height: 60vh">
    <section class="kg-card" aria-labelledby="logout-title">
      <div class="kg-card-pad kg-stack-3 kg-center">
        <h1 id="logout-title" style="font-size: 23px">{{ $t('logout.logged_out') }}</h1>
        <p class="kg-muted">{{ $t('logout.logged_out_desc') }}</p>
        <div>
          <a class="kg-btn kg-btn-primary" href="./">
            <LogIn :size="16" class="kg-icon" aria-hidden="true"></LogIn>
            {{ $t('logout.login') }}
          </a>
        </div>
      </div>
    </section>
  </main>
</template>

<script>
  import { LogIn } from '@lucide/vue'
  import NavbarSimple from './NavbarSimple.vue'

  export default {
    components: {
      LogIn,
      NavbarSimple,
    },
  }
</script>
