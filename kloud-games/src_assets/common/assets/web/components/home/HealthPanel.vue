<script>
/**
 * @file HealthPanel.vue
 * @brief Linhas de saude do host derivadas de dados reais (sem numeros inventados).
 */
export default {
  name: 'HealthPanel',
  props: {
    rows: { type: Array, default: () => [] },
  },
}
</script>

<template>
  <section class="kg-card" aria-labelledby="home-health-title">
    <div class="kg-card-head">
      <h2 id="home-health-title">{{ $t('index.health') }}</h2>
      <span class="kg-hint">{{ $t('index.host_status') }}</span>
    </div>
    <div v-if="rows.length" class="kg-list">
      <RouterLink
        v-for="row in rows"
        :key="row.key"
        class="kg-list-row"
        :to="row.to"
      >
        <span class="kg-dot" :class="`kg-dot-${row.tone === 'neutral' ? 'accent' : row.tone}`" aria-hidden="true"></span>
        <span class="kg-grow">
          <span class="kg-title">{{ $t(row.label) }}</span>
        </span>
        <span v-if="row.detail" class="kg-subtle kg-mono kg-truncate">{{ row.detail }}</span>
      </RouterLink>
    </div>
    <div v-else class="kg-empty">
      <span>{{ $t('index.health_ok') }}</span>
    </div>
  </section>
</template>
