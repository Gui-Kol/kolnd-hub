<script setup>
import { ref } from 'vue'
const props = defineProps({
  platform: String,
  config: Object,
})
const config = ref(props.config)
</script>

<template>
  <!--max_bitrate-->
  <div class="kg-field">
    <label for="max_bitrate" class="kg-label">{{ $t("config.max_bitrate") }}</label>
    <input type="number" class="kg-input" id="max_bitrate" placeholder="0" v-model="config.max_bitrate" />
    <div class="kg-help">{{ $t("config.max_bitrate_desc") }}</div>
  </div>

  <!--minimum_fps_target-->
  <div class="kg-field">
    <label for="minimum_fps_target" class="kg-label">{{ $t("config.minimum_fps_target") }}</label>
    <input type="number" min="0" max="1000" class="kg-input" id="minimum_fps_target" placeholder="0" v-model="config.minimum_fps_target" />
    <div class="kg-help">{{ $t("config.minimum_fps_target_desc") }}</div>
  </div>
</template>

<style scoped>
.ms-item {
  background-color: var(--bs-dark-bg-subtle);
  font-size: 12px;
  font-weight: bold;
}
</style>
