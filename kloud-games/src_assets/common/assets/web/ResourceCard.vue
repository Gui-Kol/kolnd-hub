<template>
    <!-- Legal -->
    <div class="card">
        <div class="card-body">
            <h2>{{ $t('resource_card.legal') }}</h2>
            <p>{{ $t('resource_card.legal_desc') }}</p>
            <div class="d-flex flex-wrap gap-2 mt-4">
                <a class="btn btn-danger" href="https://github.com/KLOUD_GAMESStream/KLOUD_GAMES/blob/master/LICENSE"
                    target="_blank">
                  <FileText :size="18" class="icon"></FileText>
                  {{ $t('resource_card.license') }}
                </a>
                <a class="btn btn-danger" href="https://github.com/KLOUD_GAMESStream/KLOUD_GAMES/blob/master/NOTICE"
                    target="_blank">
                  <AlertCircle :size="18" class="icon"></AlertCircle>
                  {{ $t('resource_card.third_party_notice') }}
                </a>
            </div>
        </div>
    </div>
</template>

<script>
import {
  AlertCircle,
  FileText,
} from '@lucide/vue'

export default {
  components: {
    AlertCircle,
    FileText,
  },
}
</script>
