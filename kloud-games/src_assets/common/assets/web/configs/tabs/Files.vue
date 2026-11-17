<script setup>
import { ref } from 'vue'

const props = defineProps({
  platform: String,
  config: Object,
})

const config = ref(props.config)
</script>

<template>
  <div id="files" class="config-page">
    <!-- Apps File -->
    <div class="kg-field">
      <label for="file_apps" class="kg-label">{{ $t('config.file_apps') }}</label>
      <input type="text" class="kg-input" id="file_apps" placeholder="apps.json" v-model="config.file_apps" />
      <div class="kg-help">{{ $t('config.file_apps_desc') }}</div>
    </div>

    <!-- Credentials File -->
    <div class="kg-field">
      <label for="credentials_file" class="kg-label">{{ $t('config.credentials_file') }}</label>
      <input type="text" class="kg-input" id="credentials_file" placeholder="KLOUD_GAMES_state.json" v-model="config.credentials_file" />
      <div class="kg-help">{{ $t('config.credentials_file_desc') }}</div>
    </div>

    <!-- Log Path -->
    <div class="kg-field">
      <label for="log_path" class="kg-label">{{ $t('config.log_path') }}</label>
      <input type="text" class="kg-input" id="log_path" placeholder="KLOUD_GAMES.log" v-model="config.log_path" />
      <div class="kg-help">{{ $t('config.log_path_desc') }}</div>
    </div>

    <!-- Private Key -->
    <div class="kg-field">
      <label for="pkey" class="kg-label">{{ $t('config.pkey') }}</label>
      <input type="text" class="kg-input" id="pkey" placeholder="/dir/pkey.pem" v-model="config.pkey" />
      <div class="kg-help">{{ $t('config.pkey_desc') }}</div>
    </div>

    <!-- Certificate -->
    <div class="kg-field">
      <label for="cert" class="kg-label">{{ $t('config.cert') }}</label>
      <input type="text" class="kg-input" id="cert" placeholder="/dir/cert.pem" v-model="config.cert" />
      <div class="kg-help">{{ $t('config.cert_desc') }}</div>
    </div>

    <!-- State File -->
    <div class="kg-field">
      <label for="file_state" class="kg-label">{{ $t('config.file_state') }}</label>
      <input type="text" class="kg-input" id="file_state" placeholder="KLOUD_GAMES_state.json"
             v-model="config.file_state" />
      <div class="kg-help">{{ $t('config.file_state_desc') }}</div>
    </div>

  </div>
</template>
