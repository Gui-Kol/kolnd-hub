<script setup>
import { computed, ref } from 'vue'
import {
  Info,
  TriangleAlert,
} from '@lucide/vue'
import Checkbox from "../../Checkbox.vue";

const props = defineProps({
  platform: String,
  config: Object,
})

const defaultMoonlightPort = 47989

const config = ref(props.config)
const effectivePort = computed(() => Number(config.value?.port ?? defaultMoonlightPort))
</script>

<template>
  <div id="network" class="config-page">
    <!-- UPnP -->
    <Checkbox class="kg-field"
              id="upnp"
              locale-prefix="config"
              v-model="config.upnp"
              default="false"
    ></Checkbox>

    <!-- Address family -->
    <div class="kg-field">
      <label for="address_family" class="kg-label">{{ $t('config.address_family') }}</label>
      <select id="address_family" class="kg-select" v-model="config.address_family">
        <option value="ipv4">{{ $t('config.address_family_ipv4') }}</option>
        <option value="both">{{ $t('config.address_family_both') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.address_family_desc') }}</div>
    </div>

    <!-- Bind address -->
    <div class="kg-field">
      <label for="bind_address" class="kg-label">{{ $t('config.bind_address') }}</label>
      <input type="text" class="kg-input" id="bind_address" v-model="config.bind_address" />
      <div class="kg-help">{{ $t('config.bind_address_desc') }}</div>
    </div>

    <!-- Port family -->
    <div class="kg-field">
      <label for="port" class="kg-label">{{ $t('config.port') }}</label>
      <input type="number" min="1029" max="65514" class="kg-input" id="port" :placeholder="defaultMoonlightPort"
             v-model="config.port" />
      <div class="kg-help">{{ $t('config.port_desc') }}</div>
      <!-- Add warning if any port is less than 1024 -->
      <div class="kg-callout kg-callout-danger" v-if="(+effectivePort - 5) < 1024">
        <TriangleAlert :size="20" /> {{ $t('config.port_alert_1') }}
      </div>
      <!-- Add warning if any port is above 65535 -->
      <div class="kg-callout kg-callout-danger" v-if="(+effectivePort + 21) > 65535">
        <TriangleAlert :size="20" /> {{ $t('config.port_alert_2') }}
      </div>
      <!-- Create a port table for the various ports needed by KLOUD_GAMES -->
      <table class="kg-table">
        <thead>
        <tr>
          <th scope="col">{{ $t('config.port_protocol') }}</th>
          <th scope="col">{{ $t('config.port_port') }}</th>
          <th scope="col">{{ $t('config.port_note') }}</th>
        </tr>
        </thead>
        <tbody>
        <tr>
          <!-- HTTPS -->
          <td>{{ $t('config.port_tcp') }}</td>
          <td>{{+effectivePort - 5}}</td>
          <td></td>
        </tr>
        <tr>
          <!-- HTTP -->
          <td>{{ $t('config.port_tcp') }}</td>
          <td>{{+effectivePort}}</td>
          <td>
            <div class="kg-callout kg-callout-info" role="alert" v-if="+effectivePort !== defaultMoonlightPort">
              <Info :size="20" /> {{ $t('config.port_http_port_note') }}
            </div>
          </td>
        </tr>
        <tr>
          <!-- Web UI -->
          <td>{{ $t('config.port_tcp') }}</td>
          <td>{{+effectivePort + 1}}</td>
          <td>{{ $t('config.port_web_ui') }}</td>
        </tr>
        <tr>
          <!-- RTSP -->
          <td>{{ $t('config.port_tcp') }}</td>
          <td>{{+effectivePort + 21}}</td>
          <td></td>
        </tr>
        <tr>
          <!-- Video, Control, Audio -->
          <td>{{ $t('config.port_udp') }}</td>
          <td>{{+effectivePort + 9}} - {{+effectivePort + 11}}</td>
          <td></td>
        </tr>
        </tbody>
      </table>
      <!-- add warning about exposing web ui to the internet -->
      <div class="kg-callout kg-callout-warning" v-if="config.origin_web_ui_allowed === 'wan'">
        <TriangleAlert :size="20" /> {{ $t('config.port_warning') }}
      </div>
    </div>

    <!-- Origin Web UI Allowed -->
    <div class="kg-field">
      <label for="origin_web_ui_allowed" class="kg-label">{{ $t('config.origin_web_ui_allowed') }}</label>
      <select id="origin_web_ui_allowed" class="kg-select" v-model="config.origin_web_ui_allowed">
        <option value="pc">{{ $t('config.origin_web_ui_allowed_pc') }}</option>
        <option value="lan">{{ $t('config.origin_web_ui_allowed_lan') }}</option>
        <option value="wan">{{ $t('config.origin_web_ui_allowed_wan') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.origin_web_ui_allowed_desc') }}</div>
    </div>

    <!-- CSRF Allowed Origins -->
    <div class="kg-field">
      <label for="csrf_allowed_origins" class="kg-label">{{ $t('config.csrf_allowed_origins') }}</label>
      <input type="text"
             class="kg-input"
             id="csrf_allowed_origins"
             v-model="config.csrf_allowed_origins" />
      <div class="kg-help">{{ $t('config.csrf_allowed_origins_desc') }}</div>
    </div>

    <!-- External IP -->
    <div class="kg-field">
      <label for="external_ip" class="kg-label">{{ $t('config.external_ip') }}</label>
      <input type="text" class="kg-input" id="external_ip" placeholder="123.456.789.12" v-model="config.external_ip" />
      <div class="kg-help">{{ $t('config.external_ip_desc') }}</div>
    </div>

    <!-- LAN Encryption Mode -->
    <div class="kg-field">
      <label for="lan_encryption_mode" class="kg-label">{{ $t('config.lan_encryption_mode') }}</label>
      <select id="lan_encryption_mode" class="kg-select" v-model="config.lan_encryption_mode">
        <option value="0">{{ $t('_common.disabled_def') }}</option>
        <option value="1">{{ $t('config.lan_encryption_mode_1') }}</option>
        <option value="2">{{ $t('config.lan_encryption_mode_2') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.lan_encryption_mode_desc') }}</div>
    </div>

    <!-- WAN Encryption Mode -->
    <div class="kg-field">
      <label for="wan_encryption_mode" class="kg-label">{{ $t('config.wan_encryption_mode') }}</label>
      <select id="wan_encryption_mode" class="kg-select" v-model="config.wan_encryption_mode">
        <option value="0">{{ $t('_common.disabled') }}</option>
        <option value="1">{{ $t('config.wan_encryption_mode_1') }}</option>
        <option value="2">{{ $t('config.wan_encryption_mode_2') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.wan_encryption_mode_desc') }}</div>
    </div>

    <!-- Ping Timeout -->
    <div class="kg-field">
      <label for="ping_timeout" class="kg-label">{{ $t('config.ping_timeout') }}</label>
      <input type="text" class="kg-input" id="ping_timeout" placeholder="10000" v-model="config.ping_timeout" />
      <div class="kg-help">{{ $t('config.ping_timeout_desc') }}</div>
    </div>

    <!-- Packet Size Limit -->
    <div class="kg-field">
      <label for="packetsize" class="kg-label">{{ $t('config.packetsize') }}</label>
      <input type="number" min="0" max="65535" class="kg-input" id="packetsize" placeholder="0" v-model="config.packetsize" />
      <div class="kg-help">{{ $t('config.packetsize_desc') }}</div>
    </div>

    <!-- DSCP Tagging -->
    <Checkbox class="kg-field"
              id="dscp_tagging"
              locale-prefix="config"
              v-model="config.dscp_tagging"
              default="true"
    ></Checkbox>

  </div>
</template>
