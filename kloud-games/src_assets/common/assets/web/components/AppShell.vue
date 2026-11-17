<script>
import { Home, Info, Layers, Lock, Menu, Search, Settings, Zap } from '@lucide/vue'
import ThemeMenu from './ThemeMenu.vue'
import UserMenu from './UserMenu.vue'
import KgToastHost from './ui/KgToastHost.vue'
import { hostMeta } from './host-meta'

/**
 * @file AppShell.vue
 * @brief Shell comum: faixa de marca (40 px), topbar (56 px), conteudo e toasts.
 *
 * O shell nao faz requisicoes: nome do host vem de `location.hostname` e a
 * versao do servico, quando existir, e renderizada pela propria pagina.
 */
export default {
  name: 'AppShell',
  components: { ThemeMenu, UserMenu, KgToastHost, Home, Info, Layers, Lock, Menu, Search, Settings, Zap },
  props: {
    // Wrappers historicos (Navbar) renderizam apenas o cromo do shell.
    chromeOnly: { type: Boolean, default: false },
  },
  data() {
    return {
      navOpen: false,
      host: '',
      activePath: '/',
      unwatchRoute: null,
    }
  },
  computed: {
    hostInfo() {
      return hostMeta
    },
    links() {
      return [
        { to: '/', label: 'navbar.home', icon: 'Home' },
        { to: '/apps', label: 'navbar.applications', icon: 'Layers' },
        { to: '/pin', label: 'navbar.pin', icon: 'Lock' },
        { to: '/config', label: 'navbar.configuration', icon: 'Settings' },
        { to: '/troubleshooting', label: 'navbar.troubleshoot', icon: 'Info' },
      ]
    },
    currentPath() {
      return this.activePath
    },
    hasPageSearch() {
      return this.activePath === '/apps' || this.activePath === '/config'
    },
  },
  watch: {
    activePath() {
      this.navOpen = false
    },
  },
  mounted() {
    this.host = globalThis.location?.hostname || ''
    this.activePath = globalThis.location?.pathname || '/'
    if ('$router' in this && this.$router) {
      this.unwatchRoute = this.$router.afterEach(to => {
        this.activePath = to.path
      })
    }
    document.addEventListener('keydown', this.onKeydown)
  },
  beforeUnmount() {
    document.removeEventListener('keydown', this.onKeydown)
    if (this.unwatchRoute) this.unwatchRoute()
  },
  methods: {
    /**
     * @brief Close the mobile navigation with `Esc`.
     *
     * @param {KeyboardEvent} event Key event.
     * @return {void}
     */
    onKeydown(event) {
      if (event.key === 'Escape' && this.navOpen) {
        this.navOpen = false
        this.$refs.navToggle?.focus()
      }
    },
    /**
     * @brief Check whether a navigation entry is the current page.
     *
     * @param {string} to Route path.
     * @return {boolean} Whether the link points to the active route.
     */
    isActive(to) {
      return to === '/' ? this.currentPath === '/' : this.currentPath.startsWith(to)
    },
    /**
     * @brief Move focus to the page search input, when the page has one.
     *
     * @return {void}
     */
    focusSearch() {
      globalThis.dispatchEvent(new CustomEvent('kg:focus-search'))
    },
  },
}
</script>

<template>
  <div class="kg-shell">
    <a class="kg-skip-link" href="#content">{{ $t('_common.skip_to_content') }}</a>

    <div class="kg-brandstrip">
      <div class="kg-brandstrip-left">
        <div class="kg-brandmark" aria-hidden="true">
          <Zap :size="14"></Zap>
        </div>
        <span class="kg-brandname">Kloud Games</span>
        <span v-if="host" class="kg-pill-meta">
          <span class="kg-truncate">{{ host }}</span>
        </span>
      </div>
      <div class="kg-brandstrip-right">
        <span v-if="hostInfo.name" class="kg-truncate">{{ hostInfo.name }}</span>
        <span v-if="hostInfo.version" class="kg-mono">v{{ hostInfo.version }}</span>
        <span v-if="!hostInfo.version">{{ $t('_common.local_server') }}</span>
      </div>
    </div>

    <header class="kg-topbar">
      <nav class="kg-nav" :class="{ 'is-open': navOpen }" :aria-label="$t('_common.main_navigation')">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          class="kg-navlink"
          :to="link.to"
          :aria-current="isActive(link.to) ? 'page' : undefined"
          @click="navOpen = false"
        >
          <component :is="link.icon" :size="16" class="kg-icon" aria-hidden="true"></component>
          <span>{{ $t(link.label) }}</span>
        </RouterLink>
      </nav>

      <div class="kg-topbar-right">
        <button
          v-if="hasPageSearch"
          type="button"
          class="kg-iconbtn kg-iconbtn-bordered"
          :aria-label="$t('_common.search')"
          :title="$t('_common.search')"
          @click="focusSearch"
        >
          <Search :size="17" class="kg-icon" aria-hidden="true"></Search>
        </button>
        <ThemeMenu />
        <UserMenu />
        <button
          ref="navToggle"
          type="button"
          class="kg-nav-toggle"
          :aria-expanded="navOpen ? 'true' : 'false'"
          :aria-label="$t('_common.main_navigation')"
          @click="navOpen = !navOpen"
        >
          <Menu :size="18" class="kg-icon" aria-hidden="true"></Menu>
        </button>
      </div>
    </header>

    <main v-if="!chromeOnly" id="content" class="kg-main">
      <slot></slot>
    </main>

    <slot name="overlay"></slot>
    <KgToastHost />
  </div>
</template>
