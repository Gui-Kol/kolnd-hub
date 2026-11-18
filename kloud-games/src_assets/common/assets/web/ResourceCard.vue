<template>
  <section class="kg-card" aria-labelledby="resource-legal-title">
    <div class="kg-card-head">
      <h2 id="resource-legal-title">{{ $t('resource_card.legal') }}</h2>
    </div>
    <div class="kg-card-pad kg-stack-3">
      <p class="kg-muted">{{ $t('resource_card.legal_desc') }}</p>
      <div class="kg-row kg-row-wrap">
        <a class="kg-btn kg-btn-danger" href="https://github.com/KLOUD_GAMESStream/KLOUD_GAMES/blob/master/LICENSE" target="_blank" rel="noopener noreferrer">
          <FileText :size="16" class="kg-icon" aria-hidden="true"></FileText>
          {{ $t('resource_card.license') }}
        </a>
        <a class="kg-btn kg-btn-secondary" href="https://github.com/KLOUD_GAMESStream/KLOUD_GAMES/blob/master/NOTICE" target="_blank" rel="noopener noreferrer">
          <AlertCircle :size="16" class="kg-icon" aria-hidden="true"></AlertCircle>
          {{ $t('resource_card.third_party_notice') }}
        </a>
      </div>
    </div>
  </section>
</template>

<script>
import {
  AlertCircle,
  FileText,
} from '@lucide/vue'

/**
 * @file ResourceCard.vue
 * @brief Cartao legal (licenca e NOTICE) reutilizado na Home e no Welcome.
 */
export default {
  name: 'ResourceCard',
  components: {
    AlertCircle,
    FileText,
  },
}
</script>
