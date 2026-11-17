<template>
  <AppShell>
    <HostHero
      :config="config"
      :clients-count="clientsCount"
      :encoder-label="encoderLabel"
      :load-failed="configLoadFailed"
    />

    <!-- Erros fatais -->
    <section
      v-if="fatalLogs.length"
      class="kg-callout kg-callout-danger"
      data-notice="fatal"
      role="alert"
    >
      <AlertCircle :size="18" class="kg-icon" aria-hidden="true"></AlertCircle>
      <div class="kg-grow">
        <strong>{{ startupErrorsText }}</strong>
        <ul class="kg-mt-2">
          <li v-for="entry in fatalLogs" :key="`${entry.timestamp}-${entry.message}`">{{ entry.message }}</li>
        </ul>
        <RouterLink class="kg-btn kg-btn-danger kg-btn-sm kg-mt-2" to="/troubleshooting#logs">
          <FileText :size="14" class="kg-icon" aria-hidden="true"></FileText>
          {{ $t('troubleshooting.logs') }}
        </RouterLink>
      </div>
    </section>

    <!-- Permissoes obrigatorias ausentes -->
    <section
      v-if="missingPermissions.length"
      class="kg-callout kg-callout-warning"
      data-notice="permissions"
      role="alert"
    >
      <AlertTriangle :size="18" class="kg-icon" aria-hidden="true"></AlertTriangle>
      <div class="kg-grow">
        <strong>{{ $t('index.permissions_missing_title') }}</strong>
        <p class="kg-mt-2">{{ $t('index.permissions_missing_desc') }}</p>
        <RouterLink class="kg-btn kg-btn-warning kg-btn-sm kg-mt-2" to="/troubleshooting#permissions">
          {{ $t('index.permissions_review') }}
        </RouterLink>
      </div>
    </section>

    <!-- Entrada virtual -->
    <section
      v-if="virtualInputNotice"
      class="kg-callout"
      :class="virtualInputNotice.tone === 'warning' ? 'kg-callout-warning' : 'kg-callout-info'"
      data-notice="virtual-input"
      :role="virtualInputNotice.warning ? 'alert' : 'status'"
    >
      <AlertTriangle v-if="virtualInputNotice.warning" :size="18" class="kg-icon" aria-hidden="true"></AlertTriangle>
      <Info v-else :size="18" class="kg-icon" aria-hidden="true"></Info>
      <div class="kg-grow">
        <strong>{{ $t(virtualInputNotice.title) }}</strong>
        <p v-for="message in virtualInputNotice.messages" :key="message.key" class="kg-mt-2">
          {{ $t(message.key, message.params || {}) }}
        </p>
        <RouterLink class="kg-btn kg-btn-sm kg-mt-2" :class="virtualInputNotice.warning ? 'kg-btn-warning' : 'kg-btn-secondary'" :to="virtualInputNotice.to">
          <Gamepad2 v-if="virtualInputNotice.chooseDriver" :size="14" class="kg-icon" aria-hidden="true"></Gamepad2>
          <Wrench v-else :size="14" class="kg-icon" aria-hidden="true"></Wrench>
          {{ $t(virtualInputNotice.action) }}
        </RouterLink>
      </div>
    </section>

    <!-- Indicadores com fonte real -->
    <section class="kg-grid kg-grid-3" :aria-label="$t('index.host_status')">
      <article class="kg-card kg-stat">
        <div class="kg-stat-top">
          <span class="kg-label">{{ $t('index.clients_paired') }}</span>
          <span class="kg-icon-wrap" aria-hidden="true"><Monitor :size="14"></Monitor></span>
        </div>
        <p class="kg-value">{{ clientsCount === null ? '—' : clientsCount }}</p>
        <p class="kg-foot">
          <RouterLink to="/pin">{{ $t('pin.clients_title') }}</RouterLink>
        </p>
      </article>
      <article class="kg-card kg-stat">
        <div class="kg-stat-top">
          <span class="kg-label">{{ $t('index.encoder') }}</span>
          <span class="kg-icon-wrap" aria-hidden="true"><Cpu :size="14"></Cpu></span>
        </div>
        <p class="kg-value">{{ encoderLabel }}</p>
        <p class="kg-foot">
          {{ config?.hevc_mode !== undefined ? `HEVC ${config.hevc_mode}` : '' }}
          {{ config?.av1_mode !== undefined ? `· AV1 ${config.av1_mode}` : '' }}
        </p>
      </article>
      <article class="kg-card kg-stat">
        <div class="kg-stat-top">
          <span class="kg-label">{{ $t('index.health') }}</span>
          <span class="kg-icon-wrap" aria-hidden="true"><Activity :size="14"></Activity></span>
        </div>
        <p class="kg-value" :class="healthRows.some(row => row.tone === 'warning') ? 'kg-text-warning' : ''">
          {{ healthRows.some(row => row.tone === 'warning') ? $t('index.health_attention') : $t('index.health_ok') }}
        </p>
        <p class="kg-foot">
          {{ config?.platform || '' }}
        </p>
      </article>
    </section>

    <section class="kg-grid kg-grid-2">
      <HealthPanel :rows="healthRows" />
      <RecentActivity :entries="recentEntries" />
    </section>

    <VersionCard
      :version="versionLabel"
      :github-version="githubVersion"
      :pre-release-version="preReleaseVersion"
      :notify-pre-releases="notifyPreReleases"
      :loading="loading"
      :dirty="buildVersionIsDirty"
      :not-stable="installedVersionNotStable"
      :stable-available="stableBuildAvailable"
      :pre-release-available="preReleaseBuildAvailable"
    />

    <ResourceCard />
  </AppShell>
</template>

<script>
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Cpu,
  FileText,
  Gamepad2,
  Info,
  Monitor,
  Wrench,
} from '@lucide/vue'
import DOMPurify from 'dompurify'
import AppShell from './components/AppShell.vue'
import HealthPanel from './components/home/HealthPanel.vue'
import HostHero from './components/home/HostHero.vue'
import RecentActivity from './components/home/RecentActivity.vue'
import VersionCard from './components/home/VersionCard.vue'
import ResourceCard from './ResourceCard.vue'
import KLOUD_GAMESVersion from './KLOUD_GAMES_version'
import { buildHealthRows, buildVirtualInputNotice, missingRequiredPermissions } from './components/home/notices'
import { publishHostMeta } from './components/host-meta'
import { parseLogEntries, recentLogEntries } from './components/diagnostics/log-utils'

/**
 * @brief Mapa de rotulos i18n dos codificadores conhecidos.
 *
 * @param {object} config Host configuration.
 * @return {string} Localized encoder label or an empty string.
 */
function encoderLabel(config) {
  if (!config) return ''
  const encoder = config.encoder
  if (!encoder || encoder === 'auto') return 'index.encoder_auto'
  return String(encoder)
}

export default {
  components: {
    Activity,
    AlertCircle,
    AlertTriangle,
    Cpu,
    FileText,
    Gamepad2,
    Info,
    Monitor,
    Wrench,
    AppShell,
    HealthPanel,
    HostHero,
    RecentActivity,
    ResourceCard,
    VersionCard,
  },
  data() {
    return {
      config: null,
      configLoadFailed: false,
      clientsCount: null,
      version: null,
      githubVersion: null,
      notifyPreReleases: false,
      preReleaseVersion: null,
      loading: true,
      logs: null,
      platform: '',
      controllerEnabled: false,
      gamepadDriver: '',
      virtualhid: null,
      virtualhidLicense: null,
      vigembus: null,
      permissions: [],
    }
  },
  async created() {
    try {
      const config = await fetch('./api/config').then(response => response.json())
      this.config = config
      publishHostMeta(config)
      this.notifyPreReleases = config.notify_pre_releases
      this.platform = config.platform
      this.controllerEnabled = config.controller !== 'disabled'
      this.gamepadDriver = config.gamepad_driver || ''
      this.version = new KLOUD_GAMESVersion(null, config.version)
    } catch (error) {
      console.error(error)
      this.configLoadFailed = true
    }

    this.clientsCount = await fetch('./api/clients/list')
      .then(response => response.json())
      .then(body => (body.status === true && Array.isArray(body.named_certs) ? body.named_certs.length : 0))
      .catch(() => null)

    try {
      const response = await fetch('./api/permissions')
      this.permissions = (await response.json()).permissions || []
    } catch (error) {
      console.error('Failed to fetch permission status:', error)
    }

    // A GitHub outage must not mark the local configuration as unavailable.
    try {
      this.githubVersion = new KLOUD_GAMESVersion(
        await fetch('https://api.github.com/repos/KLOUD_GAMESStream/KLOUD_GAMES/releases/latest').then(response => response.json()),
        null,
      )
      const releases = await fetch('https://api.github.com/repos/KLOUD_GAMESStream/KLOUD_GAMES/releases').then(response => response.json())
      const preRelease = Array.isArray(releases) ? releases.find(release => release.prerelease) : null
      this.preReleaseVersion = preRelease ? new KLOUD_GAMESVersion(preRelease, null) : null
    } catch (error) {
      console.error('Failed to fetch release information:', error)
    }

    if (this.platform === 'windows' || this.platform === 'macos') {
      try {
        const virtualInputStatus = await fetch('./api/virtual-input/status').then(response => response.json())
        this.virtualhid = virtualInputStatus.virtualhid
        if (this.platform === 'windows') {
          this.vigembus = virtualInputStatus.vigembus
        }
      } catch (error) {
        console.error('Failed to fetch virtual input driver status:', error)
      }
      try {
        this.virtualhidLicense = await fetch('./api/virtual-input/license').then(response => response.json())
      } catch (error) {
        console.error('Failed to fetch Virtual HID Broker license status:', error)
      }
    }
    try {
      this.logs = await fetch('./api/logs').then(response => response.text())
    } catch (error) {
      console.error(error)
    }
    this.loading = false
  },
  computed: {
    /** @return {object|null} Virtual-input notice for the current host state. */
    virtualInputNotice() {
      return buildVirtualInputNotice({
        platform: this.platform,
        controllerEnabled: this.controllerEnabled,
        gamepadDriver: this.gamepadDriver,
        virtualhid: this.virtualhid,
        vigembus: this.vigembus,
        virtualhidLicense: this.virtualhidLicense,
      })
    },
    /** @return {object[]} Required permissions that are not granted. */
    missingPermissions() {
      return missingRequiredPermissions(this.permissions)
    },
    /** @return {Array<object>} Host-health rows derived from real API values. */
    healthRows() {
      return buildHealthRows({
        platform: this.platform,
        permissions: this.permissions,
        virtualhid: this.virtualhid,
        gamepadDriver: this.gamepadDriver,
        upnp: this.config?.upnp,
        port: this.config?.port,
        stream_audio: this.config?.stream_audio,
        audio_sink: this.config?.audio_sink,
        virtual_sink: this.config?.virtual_sink,
      })
    },
    /** @return {Array<object>} Latest log entries (max 5). */
    recentEntries() {
      return recentLogEntries(this.logs, 5)
    },
    /** @return {Array<object>} Fatal log entries. */
    fatalLogs() {
      return parseLogEntries(this.logs).filter(entry => entry.level === 'Fatal')
    },
    /** @return {string} Localized encoder label. */
    encoderLabel() {
      const key = encoderLabel(this.config)
      return key.startsWith('index.') ? this.$t(key) : key
    },
    /** @return {string} Installed version string. */
    versionLabel() {
      return this.version?.version || ''
    },
    /** @return {string} Startup error heading without inline HTML markup. */
    startupErrorsText() {
      return DOMPurify.sanitize(this.$t('index.startup_errors'), { ALLOWED_TAGS: [] })
    },
    installedVersionNotStable() {
      if (!this.githubVersion || !this.version) return false
      return this.version.isGreater(this.githubVersion)
    },
    stableBuildAvailable() {
      if (!this.githubVersion || !this.version) return false
      return this.githubVersion.isGreater(this.version)
    },
    preReleaseBuildAvailable() {
      if (!this.preReleaseVersion || !this.githubVersion || !this.version) return false
      return this.preReleaseVersion.isGreater(this.version) && this.preReleaseVersion.isGreater(this.githubVersion)
    },
    buildVersionIsDirty() {
      return this.version?.version?.split('.').length === 5 && this.version.version.includes('dirty')
    },
  },
}
</script>
