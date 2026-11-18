<script setup>
import Checkbox from '../../Checkbox.vue'
import { ref } from 'vue'
import {
  Play,
  Plus,
  Shield,
  Trash2,
  Undo,
} from '@lucide/vue'

const props = defineProps({
  platform: String,
  config: Object
})
const config = ref(props.config)

function addCmd() {
  let template = {
    do: "",
    undo: "",
  };

  if (props.platform === 'windows') {
    template = { ...template, elevated: false };
  }
  config.value.global_prep_cmd.push(template);
}

function removeCmd(index) {
  config.value.global_prep_cmd.splice(index,1)
}
</script>

<template>
  <div id="general" class="config-page">
    <!-- Locale -->
    <div class="kg-field">
      <label for="locale" class="kg-label">{{ $t('config.locale') }}</label>
      <select id="locale" class="kg-select" v-model="config.locale">
        <option value="bg">Български (Bulgarian)</option>
        <option value="cs">Čeština (Czech)</option>
        <option value="de">Deutsch (German)</option>
        <option value="en">English</option>
        <option value="en_GB">English, United Kingdom</option>
        <option value="en_US">English, United States</option>
        <option value="es">Español (Spanish)</option>
        <option value="fr">Français (French)</option>
        <option value="hu">Magyar (Hungarian)</option>
        <option value="it">Italiano (Italian)</option>
        <option value="ja">日本語 (Japanese)</option>
        <option value="ko">한국어 (Korean)</option>
        <option value="pl">Polski (Polish)</option>
        <option value="pt">Português (Portuguese)</option>
        <option value="pt_BR">Português, Brasileiro (Portuguese, Brazilian)</option>
        <option value="ru">Русский (Russian)</option>
        <option value="sv">svenska (Swedish)</option>
        <option value="tr">Türkçe (Turkish)</option>
        <option value="uk">Українська (Ukranian)</option>
        <option value="vi">Tiếng Việt (Vietnamese)</option>
        <option value="zh">简体中文 (Chinese Simplified)</option>
        <option value="zh_TW">繁體中文 (Chinese Traditional)</option>
      </select>
      <div class="kg-help">{{ $t('config.locale_desc') }}</div>
    </div>

    <!-- KLOUD_GAMES Name -->
    <div class="kg-field">
      <label for="KLOUD_GAMES_name" class="kg-label">{{ $t('config.KLOUD_GAMES_name') }}</label>
      <input type="text" class="kg-input" id="KLOUD_GAMES_name" placeholder="KLOUD_GAMES"
             v-model="config.KLOUD_GAMES_name" />
      <div class="kg-help">{{ $t('config.KLOUD_GAMES_name_desc') }}</div>
    </div>

    <!-- Log Level -->
    <div class="kg-field">
      <label for="min_log_level" class="kg-label">{{ $t('config.min_log_level') }}</label>
      <select id="min_log_level" class="kg-select" v-model="config.min_log_level">
        <option value="0">{{ $t('config.min_log_level_0') }}</option>
        <option value="1">{{ $t('config.min_log_level_1') }}</option>
        <option value="2">{{ $t('config.min_log_level_2') }}</option>
        <option value="3">{{ $t('config.min_log_level_3') }}</option>
        <option value="4">{{ $t('config.min_log_level_4') }}</option>
        <option value="5">{{ $t('config.min_log_level_5') }}</option>
        <option value="6">{{ $t('config.min_log_level_6') }}</option>
      </select>
      <div class="kg-help">{{ $t('config.min_log_level_desc') }}</div>
    </div>

    <!-- Global Prep Commands -->
    <div id="global_prep_cmd" class="kg-field kg-row kg-stack-2">
      <div class="kg-label">{{ $t('config.global_prep_cmd') }}</div>
      <div class="kg-help">{{ $t('config.global_prep_cmd_desc') }}</div>
      <table class="kg-table" v-if="config.global_prep_cmd.length > 0">
        <thead>
        <tr>
          <th scope="col"><Play :size="16" /> {{ $t('_common.do_cmd') }}</th>
          <th scope="col"><Undo :size="16" /> {{ $t('_common.undo_cmd') }}</th>
          <th scope="col" v-if="platform === 'windows'">
            <Shield :size="16" /> {{ $t('_common.run_as') }}
          </th>
          <th scope="col"></th>
        </tr>
        </thead>
        <tbody>
        <tr v-for="(c, i) in config.global_prep_cmd" :key="i">
          <td>
            <label :for="`prep-cmd-do-${i}`" class="kg-visually-hidden">{{ $t('_common.do_cmd') }}</label>
            <input :id="`prep-cmd-do-${i}`" type="text" class="kg-input kg-mono" v-model="c.do" />
          </td>
          <td>
            <label :for="`prep-cmd-undo-${i}`" class="kg-visually-hidden">{{ $t('_common.undo_cmd') }}</label>
            <input :id="`prep-cmd-undo-${i}`" type="text" class="kg-input kg-mono" v-model="c.undo" />
          </td>
          <td v-if="platform === 'windows'" >
            <Checkbox :id="'prep-cmd-admin-' + i"
                      label="_common.elevated"
                      desc=""
                      v-model="c.elevated"
            ></Checkbox>
          </td>
          <td>
            <button class="kg-btn kg-btn-danger" @click="removeCmd(i)">
              <Trash2 :size="16" />
            </button>
            <button class="kg-btn kg-btn-success" @click="addCmd">
              <Plus :size="16" />
            </button>
          </td>
        </tr>
        </tbody>
      </table>
      <button class="kg-mt-2 kg-btn kg-btn-success" style="margin: 0 auto" @click="addCmd">
        &plus; {{ $t('config.add') }}
      </button>
    </div>

    <!-- Notify Pre-Releases -->
    <Checkbox class="kg-field"
              id="notify_pre_releases"
              locale-prefix="config"
              v-model="config.notify_pre_releases"
              default="false"
    ></Checkbox>

    <!-- Enable system tray -->
    <Checkbox class="kg-field"
              id="system_tray"
              locale-prefix="config"
              v-model="config.system_tray"
              default="true"
    ></Checkbox>
  </div>
</template>
