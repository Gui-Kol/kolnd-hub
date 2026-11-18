<script>
import { Check, Palette, Shuffle, MonitorSmartphone } from '@lucide/vue'
import KgDropdown from './ui/KgDropdown.vue'
import { THEME_IDS, applyRandomTheme, applyTheme, getPreferredTheme } from '../theme'

/**
 * @file ThemeMenu.vue
 * @brief Menu de temas (21 temas + auto + aleatorio) no novo shell.
 */
export default {
  name: 'ThemeMenu',
  components: { KgDropdown, Check, Palette, Shuffle, MonitorSmartphone },
  data() {
    return {
      current: getPreferredTheme(),
      themes: THEME_IDS,
      // Chaves i18n existentes; nenhuma string hardcoded na UI.
      labelKeys: {
        KLOUD_GAMES: 'navbar.theme_KLOUD_GAMES',
        dark: 'navbar.theme_dark',
        dracula: 'navbar.theme_dracula',
        mocha: 'navbar.theme_mocha',
        ember: 'navbar.theme_ember',
        'ember-light': 'navbar.theme_ember_light',
        'rose-pine': 'navbar.theme_rose_pine',
        'rose-pine-dawn': 'navbar.theme_rose_pine_dawn',
        moonlight: 'navbar.theme_moonlight',
        slate: 'navbar.theme_slate',
        midnight: 'navbar.theme_midnight',
        nord: 'navbar.theme_nord',
        light: 'navbar.theme_light',
        alucard: 'navbar.theme_alucard',
        latte: 'navbar.theme_latte',
        indigo: 'navbar.theme_indigo',
        ocean: 'navbar.theme_ocean',
        forest: 'navbar.theme_forest',
        rose: 'navbar.theme_rose',
        lavender: 'navbar.theme_lavender',
        monochrome: 'navbar.theme_monochrome',
      },
    }
  },
  methods: {
    /**
     * @brief Apply a theme preference and close the menu.
     *
     * @param {string} theme Theme identifier or `auto`.
     * @param {Function} close Dropdown close callback.
     * @return {void}
     */
    choose(theme, close) {
      this.current = theme
      applyTheme(theme)
      close()
    },
    /**
     * @brief Apply a random theme and close the menu.
     *
     * @param {Function} close Dropdown close callback.
     * @return {void}
     */
    random(close) {
      this.current = applyRandomTheme()
      close()
    },
    /**
     * @brief Localized theme name.
     *
     * @param {string} theme Theme identifier.
     * @return {string} Translated label.
     */
    themeLabel(theme) {
      return this.$t(this.labelKeys[theme] || 'navbar.theme_dark')
    },
  },
}
</script>

<template>
  <KgDropdown :label="$t('navbar.toggle_theme')">
    <template #trigger>
      <MonitorSmartphone :size="18" class="kg-icon" aria-hidden="true"></MonitorSmartphone>
      <span id="kg-theme-text" class="kg-visually-hidden" :data-kg-theme-label="$t('navbar.toggle_theme')">{{ $t('navbar.toggle_theme') }}</span>
    </template>
    <template #default="{ close }">
      <button
        type="button"
        role="menuitem"
        class="kg-dropdown-item"
        data-kg-theme-value="auto"
        :data-kg-theme-label="$t('navbar.theme_auto')"
        :aria-pressed="current === 'auto' ? 'true' : 'false'"
        @click="choose('auto', close)"
      >
        <MonitorSmartphone :size="16" class="kg-icon" aria-hidden="true"></MonitorSmartphone>
        <span class="kg-grow">{{ $t('navbar.theme_auto') }}</span>
        <Check v-if="current === 'auto'" :size="15" class="kg-icon" aria-hidden="true"></Check>
      </button>
      <button
        type="button"
        role="menuitem"
        id="kg-theme-random"
        class="kg-dropdown-item"
        @click="random(close)"
      >
        <Shuffle :size="16" class="kg-icon" aria-hidden="true"></Shuffle>
        <span class="kg-grow">{{ $t('navbar.theme_random') }}</span>
      </button>
      <div class="kg-dropdown-divider" role="separator"></div>
      <p class="kg-dropdown-header">{{ $t('navbar.theme_group_dark') }}</p>
      <button
        v-for="theme in themes"
        :key="theme"
        type="button"
        role="menuitem"
        class="kg-dropdown-item"
        :data-kg-theme-value="theme"
        :data-kg-theme-label="themeLabel(theme)"
        :aria-pressed="current === theme ? 'true' : 'false'"
        @click="choose(theme, close)"
      >
        <Palette :size="16" class="kg-icon" aria-hidden="true"></Palette>
        <span class="kg-grow">{{ themeLabel(theme) }}</span>
        <Check v-if="current === theme" :size="15" class="kg-icon" aria-hidden="true"></Check>
      </button>
    </template>
  </KgDropdown>
</template>
