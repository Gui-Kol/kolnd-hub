<script setup>
import { ref } from 'vue'
import Checkbox from "../../../Checkbox.vue";

const props = defineProps({
  platform: String,
  config: Object,
})

const config = ref(props.config)
</script>

<template>
  <div id="vaapi-encoder" class="config-page">
    <!-- VAAPI Rate Control group options -->
    <details class="kg-card kg-card-pad kg-mt-3" open>
      <summary class="kg-label" style="cursor: pointer">{{ $t('config.vaapi_rc_group') }}</summary>
      <div class="kg-stack-3 kg-mt-3">
<!-- VAAPI Rate Control -->
            <div class="kg-field">
              <label for="vaapi_rc" class="kg-label">{{ $t('config.vaapi_rc') }}</label>
              <select id="vaapi_rc" class="kg-select" v-model="config.vaapi_rc">
                <option value="auto">{{ $t('_common.auto') }}</option>
                <option value="avbr">{{ $t('config.vaapi_rc_avbr') }}</option>
                <option value="vbr">{{ $t('config.vaapi_rc_vbr') }}</option>
                <option value="cbr">{{ $t('config.vaapi_rc_cbr') }}</option>
                <option value="cqp">{{ $t('config.vaapi_rc_cqp') }}</option>
                <option value="icq">{{ $t('config.vaapi_rc_icq') }}</option>
                <option value="qvbr">{{ $t('config.vaapi_rc_qvbr') }}</option>
              </select>
              <div class="kg-help">{{ $t('config.vaapi_rc_desc') }}</div>
            </div>

            <!-- BLBRC -->
            <Checkbox class="kg-field"
                      id="vaapi_blbrc"
                      locale-prefix="config"
                      v-model="config.vaapi_blbrc"
                      default="false"
            ></Checkbox>

            <!-- Strict RC Buffer -->
            <Checkbox class="kg-field"
                      id="vaapi_strict_rc_buffer"
                      locale-prefix="config"
                      v-model="config.vaapi_strict_rc_buffer"
                      default="false"
            ></Checkbox>
      </div>
    </details>

    <!-- VAAPI Quality group options -->
    <details class="kg-card kg-card-pad kg-mt-3" open>
      <summary class="kg-label" style="cursor: pointer">{{ $t('config.vaapi_quality_group') }}</summary>
      <div class="kg-stack-3 kg-mt-3">
<!-- VAAPI Quality -->
            <div class="kg-field">
              <label for="vaapi_quality" class="kg-label">{{ $t('config.vaapi_quality') }}</label>
              <select id="vaapi_quality" class="kg-select" v-model="config.vaapi_quality">
                <option value="auto">{{ $t('_common.auto') }}</option>
                <option value="speed">{{ $t('config.vaapi_quality_speed') }}</option>
                <option value="balanced">{{ $t('config.vaapi_quality_balanced') }}</option>
                <option value="quality">{{ $t('config.vaapi_quality_quality') }}</option>
              </select>
              <div class="kg-help">{{ $t('config.vaapi_quality_desc') }}</div>
            </div>
      </div>
    </details>
  </div>
</template>
