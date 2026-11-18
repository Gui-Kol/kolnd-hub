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
  <div id="amd-amf-encoder" class="config-page">
    <!-- AMF Usage -->
    <div class="kg-field">
      <label for="amd_usage" class="kg-label">{{ $t('config.amd_usage') }}</label>
      <select id="amd_usage" class="kg-select" v-model="config.amd_usage">
        <option value="transcoding">{{ $t('config.amd_usage_transcoding') }}</option>
        <option value="webcam">{{ $t('config.amd_usage_webcam') }}</option>
        <option value="lowlatency_high_quality">{{ $t('config.amd_usage_lowlatency_high_quality') }}</option>
        <option value="lowlatency">{{ $t('config.amd_usage_lowlatency') }}</option>
        <option value="ultralowlatency">{{ $t('config.amd_usage_ultralowlatency') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.amd_usage_desc') }}</div>
    </div>

    <!-- AMD Rate Control group options -->
    <details class="kg-card kg-card-pad kg-mt-3" open>
      <summary class="kg-label" style="cursor: pointer">{{ $t('config.amd_rc_group') }}</summary>
      <div class="kg-stack-3 kg-mt-3">
<!-- AMF Rate Control -->
            <div class="kg-field">
              <label for="amd_rc" class="kg-label">{{ $t('config.amd_rc') }}</label>
              <select id="amd_rc" class="kg-select" v-model="config.amd_rc">
                <option value="cbr">{{ $t('config.amd_rc_cbr') }}</option>
                <option value="cqp">{{ $t('config.amd_rc_cqp') }}</option>
                <option value="vbr_latency">{{ $t('config.amd_rc_vbr_latency') }}</option>
                <option value="vbr_peak">{{ $t('config.amd_rc_vbr_peak') }}</option>
              </select>
              <div class="kg-help">{{ $t('config.amd_rc_desc') }}</div>
            </div>

            <!-- AMF HRD Enforcement -->
            <Checkbox class="kg-field"
                      id="amd_enforce_hrd"
                      locale-prefix="config"
                      v-model="config.amd_enforce_hrd"
                      default="false"
            ></Checkbox>

            <!-- AMF Max AU Size -->
            <div class="kg-field">
              <label for="amd_max_au_size" class="kg-label">{{ $t('config.amd_max_au_size') }}</label>
              <input type="number" class="kg-input" id="amd_max_au_size"
                     placeholder="-1" min="-1" max="2147483647" v-model="config.amd_max_au_size" />
              <div class="kg-help">{{ $t('config.amd_max_au_size_desc') }}</div>
            </div>
      </div>
    </details>

    <!-- AMF Quality group options -->
    <details class="kg-card kg-card-pad kg-mt-3" open>
      <summary class="kg-label" style="cursor: pointer">{{ $t('config.amd_quality_group') }}</summary>
      <div class="kg-stack-3 kg-mt-3">
<!-- AMF Quality -->
            <div class="kg-field">
              <label for="amd_quality" class="kg-label">{{ $t('config.amd_quality') }}</label>
              <select id="amd_quality" class="kg-select" v-model="config.amd_quality">
                <option value="speed">{{ $t('config.amd_quality_speed') }}</option>
                <option value="balanced">{{ $t('config.amd_quality_balanced') }}</option>
                <option value="quality">{{ $t('config.amd_quality_quality') }}</option>
              </select>
              <div class="kg-help">{{ $t('config.amd_quality_desc') }}</div>
            </div>

            <!-- AMD Preanalysis -->
            <Checkbox class="kg-field"
                      id="amd_preanalysis"
                      locale-prefix="config"
                      v-model="config.amd_preanalysis"
                      default="false"
            ></Checkbox>

            <!-- AMD VBAQ -->
            <Checkbox class="kg-field"
                      id="amd_vbaq"
                      locale-prefix="config"
                      v-model="config.amd_vbaq"
                      default="true"
            ></Checkbox>

            <!-- AMF Coder (H264) -->
            <div class="kg-field">
              <label for="amd_coder" class="kg-label">{{ $t('config.amd_coder') }}</label>
              <select id="amd_coder" class="kg-select" v-model="config.amd_coder">
                <option value="auto">{{ $t('config.ffmpeg_auto') }}</option>
                <option value="cabac">{{ $t('config.coder_cabac') }}</option>
                <option value="cavlc">{{ $t('config.coder_cavlc') }}</option>
              </select>
              <div class="kg-help">{{ $t('config.amd_coder_desc') }}</div>
            </div>
      </div>
    </details>
  </div>
</template>
