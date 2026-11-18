<template>
  <AppShell>
    <div class="kg-page-head">
      <div>
        <h1>{{ $t('config.configuration') }}</h1>
        <p class="kg-sub">{{ $t('config.configuration_desc') }}</p>
      </div>
      <div class="kg-page-actions" v-if="config">
        <span v-if="dirtyCount" class="kg-badge kg-badge-warning">{{ $t('config.unsaved_changes', { count: dirtyCount }) }}</span>
        <span v-else class="kg-badge kg-badge-neutral">{{ $t('config.no_changes') }}</span>
      </div>
    </div>

    <div class="kg-settings-layout" v-if="config">
      <aside class="kg-card kg-rail" aria-label="$t('config.configuration')">
        <div class="kg-search-field">
          <Search :size="15" aria-hidden="true"></Search>
          <label for="config-search" class="kg-visually-hidden">{{ $t('config.search_options') }}</label>
          <input
            id="config-search"
            ref="searchInput"
            v-model="searchQuery"
            class="kg-input"
            type="search"
            :placeholder="$t('config.search_hint')"
            list="config-options"
            autocomplete="off"
            @input="handleSearch"
          />
        </div>
        <datalist id="config-options">
          <option v-for="option in allConfigOptions" :key="option.key" :value="option.label">
            {{ option.tab }} - {{ option.label }}
          </option>
        </datalist>
        <p v-if="searchQuery" class="kg-help" aria-live="polite">
          {{ searchResults.length
            ? $t('config.search_results', { count: searchResults.length })
            : $t('config.search_no_results', { query: searchQuery }) }}
        </p>

        <div class="kg-rail-group">
          <p class="kg-rail-label">{{ $t('config.category_general') }}</p>
          <button
            v-for="tab in generalTabs"
            :key="tab.id"
            type="button"
            class="kg-rail-item"
            :aria-current="tab.id === currentTab ? 'true' : undefined"
            @click="selectTab(tab.id)"
          >
            <component :is="getTabIcon(tab.id)" :size="16" class="kg-icon" aria-hidden="true"></component>
            <span class="kg-grow">{{ $t(tab.nameKey) }}</span>
          </button>
        </div>

        <div class="kg-rail-group" v-if="encoderTabs.length">
          <p class="kg-rail-label">{{ $t('config.encoders') }}</p>
          <button
            v-for="tab in encoderTabs"
            :key="tab.id"
            type="button"
            class="kg-rail-item"
            :aria-current="tab.id === currentTab ? 'true' : undefined"
            @click="selectTab(tab.id)"
          >
            <component :is="getTabIcon(tab.id)" :size="16" class="kg-icon" aria-hidden="true"></component>
            <span class="kg-grow">{{ $t(tab.nameKey) }}</span>
          </button>
        </div>
        <div class="kg-rail-group" v-if="config">
          <p class="kg-rail-label">{{ $t('config.host_detected') }}</p>
          <p class="kg-help">{{ platform }}</p>
          <p class="kg-help">{{ $t('index.port_label') }}: {{ config.port }}</p>
          <p class="kg-help">{{ $t('config.locale') }}: {{ config.locale }}</p>
          <p class="kg-help">{{ $t('index.encoder') }}: {{ config.encoder || $t('index.encoder_auto') }}</p>
        </div>
      </aside>

      <div class="kg-settings-content">
        <div v-if="saved && !restarted" class="kg-callout kg-callout-success" role="status">
          <CheckCircle :size="16" class="kg-icon" aria-hidden="true"></CheckCircle>
          <span><strong>{{ $t('_common.success') }}</strong> {{ $t('config.apply_note') }}</span>
        </div>
        <div v-if="restarted" class="kg-callout kg-callout-success" role="status">
          <RefreshCw :size="16" class="kg-icon" aria-hidden="true"></RefreshCw>
          <span><strong>{{ $t('_common.success') }}</strong> {{ $t('config.restart_note') }}</span>
        </div>

        <div ref="configContent">
          <div v-if="currentTab === 'general'" class="kg-card kg-card-pad kg-stack-4">
            <general :config="config" :platform="platform"></general>
          </div>
          <div v-if="currentTab === 'input'" class="kg-card kg-card-pad kg-stack-4">
            <inputs :config="config" :platform="platform"></inputs>
          </div>
          <div v-if="currentTab === 'av'" class="kg-card kg-card-pad kg-stack-4">
            <audio-video :config="config" :platform="platform"></audio-video>
          </div>
          <div v-if="currentTab === 'network'" class="kg-card kg-card-pad kg-stack-4">
            <network :config="config" :platform="platform"></network>
          </div>
          <div v-if="currentTab === 'files'" class="kg-card kg-card-pad kg-stack-4">
            <files :config="config" :platform="platform"></files>
          </div>
          <div v-if="currentTab === 'advanced'" class="kg-card kg-card-pad kg-stack-4">
            <advanced :config="config" :platform="platform"></advanced>
          </div>
          <div v-if="encoderTabs.some(tab => tab.id === currentTab)" class="kg-card kg-card-pad kg-stack-4">
            <container-encoders :current-tab="currentTab" :config="config" :platform="platform"></container-encoders>
          </div>
        </div>

        <div class="kg-savebar">
          <div class="kg-savebar-status">
            <span class="kg-dot" :class="dirtyCount ? 'kg-dot-warning' : 'kg-dot-success'" aria-hidden="true"></span>
            <span>{{ dirtyCount ? $t('config.unsaved_changes', { count: dirtyCount }) : $t('config.no_changes') }}</span>
          </div>
          <div class="kg-row kg-row-wrap">
            <button class="kg-btn kg-btn-ghost kg-btn-sm" type="button" :disabled="!dirtyCount" @click="discard">
              <RotateCcw :size="14" class="kg-icon" aria-hidden="true"></RotateCcw>
              {{ $t('config.discard') }}
            </button>
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="save">
              <Save :size="14" class="kg-icon" aria-hidden="true"></Save>
              {{ $t('_common.save') }}
            </button>
            <button class="kg-btn kg-btn-primary kg-btn-sm" type="button" @click="apply">
              <RefreshCw :size="14" class="kg-icon" aria-hidden="true"></RefreshCw>
              {{ $t('config.apply_restart') }}
            </button>
          </div>
        </div>
        <p class="kg-help">{{ $t('config.restart_warning') }}</p>
      </div>
    </div>

    <div v-else-if="loadError" class="kg-card">
      <div class="kg-empty kg-text-danger" role="alert">
        <span>{{ loadError }}</span>
        <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="loadConfig">
          {{ $t('troubleshooting.permissions_refresh') }}
        </button>
      </div>
    </div>
    <div v-else class="kg-card">
      <div class="kg-empty">
        <span class="kg-spinner" aria-hidden="true"></span>
        <span>{{ $t('_common.loading') }}</span>
      </div>
    </div>
  </AppShell>
</template>

<script>
import { computed, toRaw } from 'vue'
import AppShell from './components/AppShell.vue'
import { apiFetch } from './fetch_utils'
import configTabs from './configs/config_tabs.json'
import General from './configs/tabs/General.vue'
import Inputs from './configs/tabs/Inputs.vue'
import Network from './configs/tabs/Network.vue'
import Files from './configs/tabs/Files.vue'
import Advanced from './configs/tabs/Advanced.vue'
import AudioVideo from './configs/tabs/AudioVideo.vue'
import ContainerEncoders from './configs/tabs/ContainerEncoders.vue'
import { buildOptionIndex, filterOptions } from './components/config/config-search'
import { publishHostMeta } from './components/host-meta'
import {
  CheckCircle,
  Cpu,
  FileCog,
  Gamepad2,
  Gpu,
  Network as NetworkIcon,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sliders,
  Volume2,
} from '@lucide/vue'

const ENCODER_TAB_IDS = new Set(["nv", "amd", "qsv", "vaapi", "vt", "vulkan", "sw"]);

/**
 * Compare configuration values without coercing their types.
 *
 * @param {*} value Configured value.
 * @param {*} defaultValue Default value for the option.
 * @returns {boolean} Whether both values have the same type and contents.
 */
function configValuesEqual(value, defaultValue) {
  if (Object.is(value, defaultValue)) {
    return true;
  }
  if (typeof value !== typeof defaultValue || value === null || defaultValue === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value) !== Array.isArray(defaultValue)) {
    return false;
  }

  const valueKeys = Object.keys(value);
  const defaultKeys = Object.keys(defaultValue);
  return valueKeys.length === defaultKeys.length && valueKeys.every(key =>
    Object.hasOwn(defaultValue, key) && configValuesEqual(value[key], defaultValue[key])
  );
}

export default {
  components: {
    AppShell,
    General,
    Inputs,
    Network,
    Files,
    Advanced,
    // They will be accessible via audio-video, container-encoders only.
    AudioVideo,
    ContainerEncoders,
    // icons
    CheckCircle,
    Cpu,
    FileCog,
    Gamepad2,
    Gpu,
    NetworkIcon,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Settings,
    Sliders,
    Volume2,
  },
  data() {
    return {
      platform: "",
      saved: false,
      restarted: false,
      config: null,
      snapshot: null,
      loadError: '',
      currentTab: "general",
      searchQuery: "",
      hashChangeHandler: null,
      // Keep a private copy because platform filtering replaces this array at runtime.
      tabs: structuredClone(configTabs),
    };
  },
  provide() {
    return {
      platform: computed(() => this.platform),
      searchQuery: computed(() => this.searchQuery),
    }
  },
  computed: {
    generalTabs() {
      return this.tabs.filter(tab => !ENCODER_TAB_IDS.has(tab.id));
    },
    encoderTabs() {
      return this.tabs.filter(tab => ENCODER_TAB_IDS.has(tab.id));
    },
    allConfigOptions() {
      return buildOptionIndex(this.tabs, key => this.$t(key))
    },
    searchResults() {
      return filterOptions(this.allConfigOptions, this.searchQuery)
    },
    dirtyCount() {
      return this.dirtyKeys.length
    },
    dirtyKeys() {
      if (!this.config || !this.snapshot) return []
      const keys = new Set([...Object.keys(this.config), ...Object.keys(this.snapshot)])
      return [...keys].filter(key => !configValuesEqual(toRaw(this.config[key]), this.snapshot[key]))
    },
  },
  created() {
    this.loadConfig()
    if (typeof window !== 'undefined') {
      window.addEventListener('kg:focus-search', this.focusSearch)
    }
  },
  mounted() {
    this.hashChangeHandler = () => this.applyHash()
    this.hashChangeHandler()
    window.addEventListener("hashchange", this.hashChangeHandler);
  },
  beforeUnmount() {
    window.removeEventListener("hashchange", this.hashChangeHandler);
    window.removeEventListener('kg:focus-search', this.focusSearch)
  },
  methods: {
    /** @return {void} Focus the configuration search input. */
    focusSearch() {
      this.$refs.searchInput?.focus()
    },
    /**
     * @brief Load the host configuration, filter platform tabs and apply defaults.
     *
     * @return {Promise<void>} Completion of the configuration load.
     */
    async loadConfig() {
      this.loadError = ''
      let config
      try {
        const response = await fetch("./api/config")
        config = await response.json()
      } catch (error) {
        this.loadError = error.message
        return
      }
      this.config = config
      this.platform = this.config.platform
      publishHostMeta(config)

      if (this.platform === "windows") {
        this.tabs = this.tabs.filter((el) => {
          return el.id !== "vt" && el.id !== "vaapi" && el.id !== "vulkan";
        });
      }
      if (this.platform === "freebsd" || this.platform === "linux") {
        this.tabs = this.tabs.filter((el) => {
          return el.id !== "amd" && el.id !== "qsv" && el.id !== "vt";
        });
      }
      if (this.platform === "macos") {
        this.tabs = this.tabs.filter((el) => {
          return el.id !== "amd" && el.id !== "nv" && el.id !== "qsv" && el.id !== "vaapi" && el.id !== "vulkan";
        });
      }

      // remove values we don't want in the config file
      delete this.config.platform;
      delete this.config.status;
      delete this.config.version;

      // Parse the special options before population if available
      const specialOptions = ["dd_mode_remapping", "global_prep_cmd"]
      for (const optionKey of specialOptions) {
        if (Object.hasOwn(this.config, optionKey)) {
          this.config[optionKey] = JSON.parse(this.config[optionKey]);
        }
      }

      // Populate default values from tabs options
      this.tabs.forEach(tab => {
        Object.keys(tab.options).forEach(optionKey => {
          if (this.config[optionKey] === undefined) {
            // Make sure to copy by value
            this.config[optionKey] = structuredClone(toRaw(tab.options[optionKey]));
          }
        });
      });

      this.snapshot = structuredClone(toRaw(this.config))
      this.applyHash()
    },
    getTabIcon(tabId) {
      const iconMap = {
        'general': 'Settings',
        'input': 'Gamepad2',
        'av': 'Volume2',
        'network': 'NetworkIcon',
        'files': 'FileCog',
        'advanced': 'Sliders',
        'nv': 'Gpu',
        'amd': 'Gpu',
        'qsv': 'Gpu',
        'vaapi': 'Gpu',
        'vt': 'Gpu',
        'vulkan': 'Gpu',
        'sw': 'Cpu',
      };
      return iconMap[tabId] || 'Settings';
    },
    /**
     * @brief Activate a configuration tab.
     *
     * @param {string} tabId Tab identifier.
     * @return {void}
     */
    selectTab(tabId) {
      this.currentTab = tabId
    },
    serialize() {
      return structuredClone(toRaw(this.config));
    },
    /**
     * @brief Build the payload that omits values equal to their defaults.
     *
     * @return {object} Serialized configuration.
     */
    buildPayload() {
      const config = this.serialize()
      this.tabs.forEach(tab => {
        Object.keys(tab.options).forEach(optionKey => {
          if (configValuesEqual(config[optionKey], tab.options[optionKey])) {
            delete config[optionKey]
          }
        })
      })
      return config
    },
    save() {
      this.saved = false;
      this.restarted = false;

      return apiFetch("./api/config", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(this.buildPayload()),
      }).then((r) => {
        if (r.status === 200) {
          this.snapshot = structuredClone(toRaw(this.config))
          this.saved = true
          return this.saved
        }
        return false
      });
    },
    apply() {
      this.saved = this.restarted = false;
      let saved = this.save();

      saved.then((result) => {
        if (result === true) {
          this.restarted = true;
          setTimeout(() => {
            this.saved = this.restarted = false;
          }, 5000);
          apiFetch("./api/restart", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            }
          });
        }
      });
    },
    /**
     * @brief Restore the configuration loaded from the host.
     *
     * @return {void}
     */
    discard() {
      if (!this.snapshot) return
      for (const key of Object.keys(this.config)) delete this.config[key]
      Object.assign(this.config, structuredClone(toRaw(this.snapshot)))
      this.saved = false
      this.restarted = false
    },
    handleSearch() {
      this.applySearchToDom()
    },
    /**
     * @brief Hide non-matching fields inside the active tab without touching global styles.
     *
     * Uses a scoped root element and a CSS class instead of `style.display`.
     *
     * @return {void}
     */
    applySearchToDom() {
      const root = this.$refs.configContent
      if (!root) return

      root.querySelectorAll('.kg-search-hidden').forEach(element => element.classList.remove('kg-search-hidden'))
      root.querySelectorAll('.kg-config-highlight').forEach(element => element.classList.remove('kg-config-highlight'))

      if (!this.searchQuery || !this.searchResults.length) return

      const first = this.searchResults[0]
      if (first.tabId !== this.currentTab) this.currentTab = first.tabId

      this.$nextTick(() => {
        const container = this.$refs.configContent
        if (!container) return
        const matches = new Set(this.searchResults.map(result => result.key))
        const groups = container.querySelectorAll('.kg-field, .mb-3, .kg-field-grid > *')
        groups.forEach(group => {
          const hasMatch = [...group.querySelectorAll('[id]')].some(element => matches.has(element.id))
          const itself = group.id && matches.has(group.id)
          if (!hasMatch && !itself) group.classList.add('kg-search-hidden')
        })

        const firstElement = this.findOptionElement(container, first.key)
        if (firstElement) {
          const group = firstElement.closest('.kg-field, .mb-3, .kg-field-grid > *') || firstElement
          group.classList.add('kg-config-highlight')
          group.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
          setTimeout(() => group.classList.remove('kg-config-highlight'), 3000)
        }
      })
    },
    /**
     * @brief Find an option element by id without relying on `CSS.escape`.
     *
     * @param {Element} root Search root.
     * @param {string} id Element id.
     * @return {Element|null} Matching element.
     */
    findOptionElement(root, id) {
      return [...root.querySelectorAll('[id]')].find(element => element.id === id) || null
    },
    /**
     * @brief Apply a `#<tabId>` or `#<optionId>` deep link.
     *
     * @return {void}
     */
    applyHash() {
      const hash = window.location.hash
      if (!hash || !this.config) return
      const stripped = hash.substring(1)
      if (!stripped) return

      const tab = this.tabs.find(item => item.id === stripped)
      if (tab) {
        this.currentTab = tab.id
        return
      }
      const option = this.allConfigOptions.find(item => item.key === stripped)
      if (option) {
        this.currentTab = option.tabId
        this.$nextTick(() => {
          const element = this.findOptionElement(this.$refs.configContent, stripped)
          if (element) {
            element.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
            element.focus?.({ preventScroll: true })
          }
        })
      }
    },
  },
}
</script>
