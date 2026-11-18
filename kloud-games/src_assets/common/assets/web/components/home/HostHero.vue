<script>
import { Gamepad2, Layers, LifeBuoy, Zap } from '@lucide/vue'

/**
 * @file HostHero.vue
 * @brief Hero de status da Home (modelo 01): identidade, dados reais e atalhos.
 */
export default {
  name: 'HostHero',
  components: { Gamepad2, Layers, LifeBuoy, Zap },
  props: {
    config: { type: Object, default: null },
    clientsCount: { type: Number, default: null },
    encoderLabel: { type: String, default: '' },
    loadFailed: { type: Boolean, default: false },
  },
}
</script>

<template>
  <section class="kg-hero">
    <div class="kg-hero-body">
      <div>
        <p class="kg-eyebrow">
          <span class="kg-dot kg-dot-accent" aria-hidden="true"></span>
          {{ $t('index.host_status') }}
        </p>
        <h1>{{ $t('index.welcome') }}</h1>
        <p class="kg-sub">{{ $t('index.description') }}</p>
        <div class="kg-hero-meta">
          <span class="kg-badge kg-badge-lg" :class="loadFailed ? 'kg-badge-danger' : 'kg-badge-success'">
            <span class="kg-dot" :class="loadFailed ? 'kg-dot-danger' : 'kg-dot-success kg-dot-live'" aria-hidden="true"></span>
            {{ loadFailed ? $t('index.config_failed') : $t('index.config_loaded') }}
          </span>
          <span v-if="config?.platform" class="kg-badge kg-badge-neutral kg-badge-lg">
            {{ config.platform }}
          </span>
          <span v-if="config?.port" class="kg-badge kg-badge-neutral kg-badge-lg">
            {{ $t('index.port_label') }} {{ config.port }}
          </span>
          <span v-if="encoderLabel" class="kg-badge kg-badge-accent kg-badge-lg">
            {{ encoderLabel }}
          </span>
          <span v-if="clientsCount !== null" class="kg-badge kg-badge-neutral kg-badge-lg">
            {{ clientsCount }} {{ $t('index.clients_paired').toLowerCase() }}
          </span>
        </div>
      </div>
      <div class="kg-hero-actions">
        <RouterLink class="kg-btn kg-btn-secondary" to="/apps">
          <Layers :size="15" class="kg-icon" aria-hidden="true"></Layers>
          {{ $t('navbar.applications') }}
        </RouterLink>
        <RouterLink class="kg-btn kg-btn-primary" to="/pin">
          <Gamepad2 :size="15" class="kg-icon" aria-hidden="true"></Gamepad2>
          {{ $t('navbar.pin') }}
        </RouterLink>
        <RouterLink class="kg-btn kg-btn-ghost" to="/troubleshooting">
          <LifeBuoy :size="15" class="kg-icon" aria-hidden="true"></LifeBuoy>
          {{ $t('navbar.troubleshoot') }}
        </RouterLink>
      </div>
    </div>
  </section>
</template>
