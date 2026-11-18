<script>
/**
 * @file RecentActivity.vue
 * @brief Ultimas entradas do log (maximo configuravel), com nivel e horario.
 */
export default {
  name: 'RecentActivity',
  props: {
    entries: { type: Array, default: () => [] },
  },
  methods: {
    /**
     * @brief Map a parsed level to a badge tone.
     *
     * @param {string} level Log level.
     * @return {string} Badge tone suffix.
     */
    tone(level) {
      if (level === 'Fatal' || level === 'Error' || level === 'Critical') return 'danger'
      if (level === 'Warning') return 'warning'
      if (level === 'Debug') return 'neutral'
      return 'accent'
    },
  },
}
</script>

<template>
  <section class="kg-card" aria-labelledby="home-activity-title">
    <div class="kg-card-head">
      <h2 id="home-activity-title">{{ $t('index.recent_activity') }}</h2>
      <RouterLink class="kg-hint" to="/troubleshooting#logs">{{ $t('troubleshooting.logs') }}</RouterLink>
    </div>
    <p class="kg-card-sub" style="padding: 10px 18px 0">{{ $t('index.activity_desc') }}</p>
    <div v-if="entries.length" class="kg-list">
      <div v-for="entry in entries" :key="entry.index" class="kg-list-row">
        <span class="kg-badge" :class="`kg-badge-${tone(entry.level)}`">{{ entry.level }}</span>
        <span class="kg-grow">
          <span class="kg-desc kg-mono kg-truncate">{{ entry.message }}</span>
        </span>
        <span v-if="entry.timestamp" class="kg-subtle kg-mono kg-nowrap">{{ entry.timestamp }}</span>
      </div>
    </div>
    <div v-else class="kg-empty">
      <span>{{ $t('index.no_activity') }}</span>
    </div>
  </section>
</template>
