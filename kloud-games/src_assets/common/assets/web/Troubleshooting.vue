<template>
  <AppShell>
    <div class="kg-page-head">
      <div>
        <h1>{{ $t('troubleshooting.troubleshooting') }}</h1>
        <p class="kg-sub">{{ $t('troubleshooting.permissions_desc') }}</p>
      </div>
      <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" @click="refreshPermissions">
        <RefreshCw :size="14" class="kg-icon" aria-hidden="true"></RefreshCw>
        {{ $t('troubleshooting.permissions_refresh') }}
      </button>
    </div>

    <!-- Permissoes -->
    <section class="kg-card" aria-labelledby="permissions">
      <div class="kg-card-head">
        <h2 id="permissions">{{ $t('troubleshooting.permissions_title') }}</h2>
      </div>
      <div class="kg-card-pad kg-stack-3">
        <p class="kg-muted">{{ $t('troubleshooting.permissions_desc') }}</p>
        <div v-if="permissionError" class="kg-callout kg-callout-danger" role="alert">{{ permissionError }}</div>
        <div v-if="permissions.length" class="kg-table-wrap permission-table-shell">
          <table class="kg-table">
            <thead>
              <tr>
                <th scope="col">{{ $t('troubleshooting.permissions_name') }}</th>
                <th scope="col">{{ $t('troubleshooting.permissions_status') }}</th>
                <th scope="col">{{ $t('troubleshooting.permissions_requirement') }}</th>
                <th scope="col">
                  <span class="kg-visually-hidden">{{ $t('troubleshooting.permissions_action') }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="permission in orderedPermissions" :key="permission.id">
                <th scope="row">
                  <strong>{{ $t('troubleshooting.permission_' + permission.id +
                    (permission.id === 'input' && (platform === 'linux' || platform === 'freebsd') ? '_unix' : '')) }}</strong>
                  <p class="permission-detail">{{ $t('troubleshooting.permission_' + permission.id + '_desc' +
                    (permission.id === 'input' && (platform === 'linux' || platform === 'freebsd') ? '_unix' : '')) }}</p>
                  <output v-if="permissionHelp === permission.id" class="permission-help">
                    {{ $t('troubleshooting.permission_' + permission.id + '_help' +
                      (permission.id === 'input' && platform !== 'macos' ? '_' + platform : '')) }}
                  </output>
                </th>
                <td>
                  <span class="status-icon" :class="permissionStatusClass(permission.status)"
                        :title="$t('troubleshooting.permissions_status_' + permission.status)">
                    <CheckCircle v-if="permission.status === 'granted'" :size="19" aria-hidden="true"></CheckCircle>
                    <XCircle v-else-if="permission.status === 'denied'" :size="19" aria-hidden="true"></XCircle>
                    <Clock3 v-else-if="permission.status === 'on_use'" :size="19" aria-hidden="true"></Clock3>
                    <AlertCircle v-else-if="permission.status === 'not_determined'" :size="19" aria-hidden="true"></AlertCircle>
                    <AlertTriangle v-else :size="19" aria-hidden="true"></AlertTriangle>
                    <span class="kg-visually-hidden">{{ $t('troubleshooting.permissions_status_' + permission.status) }}</span>
                  </span>
                </td>
                <td>
                  <span class="kg-badge" :class="permission.required ? 'kg-badge-accent' : 'kg-badge-neutral'">
                    {{ $t(permission.required ? 'troubleshooting.permissions_required' : 'troubleshooting.permissions_optional') }}
                  </span>
                </td>
                <td>
                  <button v-if="permission.status !== 'granted' && permission.requestable" class="kg-btn kg-btn-secondary kg-btn-sm"
                          type="button" :disabled="permissionBusy === permission.id"
                          @click="requestPermission(permission.id)">
                    {{ $t(permission.id === 'local_network'
                      ? 'troubleshooting.permissions_privacy_settings' : 'troubleshooting.permissions_request') }}
                  </button>
                  <button v-else-if="permission.status !== 'granted'" class="kg-btn kg-btn-secondary kg-btn-sm"
                          type="button" @click="permissionHelp = permissionHelp === permission.id ? '' : permission.id">
                    {{ $t('troubleshooting.permissions_instructions') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="!permissionError" class="kg-help">{{ $t('_common.not_available') }}</p>
      </div>
    </section>

    <!-- Entrada virtual e licenca -->
    <section class="kg-card virtual-gamepad-card" v-if="platform === 'windows' || platform === 'macos'" aria-labelledby="virtualhid">
      <div class="kg-card-pad kg-stack-4">
        <header class="kg-hero-panel">
          <div class="kg-hero-panel-icon" aria-hidden="true">
            <Gamepad2 :size="24"></Gamepad2>
          </div>
          <div class="kg-grow">
            <h2 id="virtualhid">{{ $t('troubleshooting.virtual_gamepad') }}</h2>
            <p class="kg-muted kg-mt-2">{{ $t(virtualInputDescriptionKey) }}</p>
            <RouterLink v-if="platform === 'windows' && gamepadDriver === 'vigembus'"
               class="kg-btn kg-btn-primary kg-btn-sm kg-mt-2"
               to="/config#gamepad_driver">
              <Gamepad2 :size="14" class="kg-icon" aria-hidden="true"></Gamepad2>
              {{ $t('troubleshooting.change_gamepad_driver') }}
            </RouterLink>
          </div>
        </header>

        <div class="kg-feature-grid" v-if="showVirtualhidBenefits" :aria-label="$t('troubleshooting.virtualhid_benefits_title')">
          <article class="kg-feature">
            <Gamepad2 :size="18" class="kg-icon kg-feature-icon" aria-hidden="true"></Gamepad2>
            <div>
              <h3>{{ $t('troubleshooting.virtualhid_benefit_gamepads_title') }}</h3>
              <p>{{ $t('troubleshooting.virtualhid_benefit_gamepads') }}</p>
            </div>
          </article>
          <article class="kg-feature">
            <MousePointer2 :size="18" class="kg-icon kg-feature-icon" aria-hidden="true"></MousePointer2>
            <div>
              <h3>{{ $t('troubleshooting.virtualhid_benefit_mouse_title') }}</h3>
              <p>{{ $t('troubleshooting.virtualhid_benefit_mouse') }}</p>
            </div>
          </article>
          <article class="kg-feature">
            <Sparkles :size="18" class="kg-icon kg-feature-icon" aria-hidden="true"></Sparkles>
            <div>
              <h3>{{ $t('troubleshooting.virtualhid_benefit_features_title') }}</h3>
              <p>{{ $t('troubleshooting.virtualhid_benefit_features') }}</p>
            </div>
          </article>
          <article class="kg-feature">
            <ShieldCheck :size="18" class="kg-icon kg-feature-icon" aria-hidden="true"></ShieldCheck>
            <div>
              <h3>{{ $t('troubleshooting.virtualhid_benefit_maintained_title') }}</h3>
              <p>{{ $t('troubleshooting.virtualhid_benefit_maintained') }}</p>
            </div>
          </article>
        </div>

        <section class="virtual-gamepad-section">
          <div class="kg-between kg-row-wrap">
            <div>
              <h3>{{ $t('troubleshooting.virtual_gamepad_drivers') }}</h3>
              <p class="kg-help">{{ $t('troubleshooting.virtual_gamepad_drivers_desc') }}</p>
            </div>
            <button class="kg-btn kg-btn-secondary kg-btn-sm driver-refresh-button" type="button" @click="refreshDriverInformation">
              <RefreshCw :size="14" :class="{ 'kg-spin': driverReleaseLoading }" aria-hidden="true"></RefreshCw>
              {{ $t('troubleshooting.driver_refresh') }}
            </button>
          </div>

          <div class="kg-table-wrap driver-table-shell kg-mt-3">
            <table class="kg-table">
              <thead>
                <tr>
                  <th scope="col">{{ $t('troubleshooting.driver_name') }}</th>
                  <th scope="col">{{ $t('troubleshooting.driver_installed_version') }}</th>
                  <th scope="col">{{ $t('troubleshooting.driver_latest_version') }}</th>
                  <th scope="col">{{ $t('troubleshooting.driver_supported_versions') }}</th>
                  <th scope="col">{{ $t('troubleshooting.driver_status') }}</th>
                  <th scope="col"><span class="kg-visually-hidden">{{ $t('troubleshooting.driver_download') }}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="showVirtualhid">
                  <th scope="row">{{ $t('troubleshooting.virtualhid_driver') }}</th>
                  <td>{{ driverVersion(virtualhid) }}</td>
                  <td>
                    <div class="driver-release-state" :class="driverReleaseStateClass(virtualhid, virtualhidRelease)"
                         :title="driverReleaseStatusText(virtualhid, virtualhidRelease)" aria-live="polite">
                      <RefreshCw v-if="virtualhidRelease.loading" :size="15" class="kg-spin"></RefreshCw>
                      <CheckCircle v-else-if="driverReleaseState(virtualhid, virtualhidRelease) === 'current'" :size="15"></CheckCircle>
                      <AlertTriangle v-else-if="driverReleaseState(virtualhid, virtualhidRelease) === 'outdated'" :size="15"></AlertTriangle>
                      <AlertCircle v-else :size="15"></AlertCircle>
                      <span>{{ driverLatestVersion(virtualhidRelease) }}</span>
                    </div>
                    <small class="driver-release-detail">{{ driverReleaseStatusText(virtualhid, virtualhidRelease) }}</small>
                  </td>
                  <td>{{ virtualhid.supported_versions }}</td>
                  <td>
                    <span class="status-icon driver-status-icon" :class="driverStatusClass(virtualhid)" :title="driverStatusText(virtualhid)">
                      <AlertCircle v-if="!virtualhid.installed" :size="19" aria-hidden="true"></AlertCircle>
                      <CheckCircle v-else-if="virtualhid.version_compatible" :size="19" aria-hidden="true"></CheckCircle>
                      <XCircle v-else :size="19" aria-hidden="true"></XCircle>
                      <span class="kg-visually-hidden">{{ driverStatusText(virtualhid) }}</span>
                    </span>
                  </td>
                  <td>
                    <a class="kg-btn kg-btn-secondary kg-btn-sm driver-download-button" :href="virtualhidRelease.url" target="_blank" rel="noopener noreferrer">
                      <Download :size="14" aria-hidden="true"></Download>
                      {{ $t('troubleshooting.driver_download') }}
                    </a>
                  </td>
                </tr>
                <tr id="vigembus" v-if="showVigembus">
                  <th scope="row">{{ $t('troubleshooting.vigembus_driver') }}</th>
                  <td>{{ driverVersion(vigembus) }}</td>
                  <td>
                    <div class="driver-release-state driver-release-neutral">
                      <AlertCircle :size="15"></AlertCircle>
                      <span>{{ $t('troubleshooting.driver_release_eol') }}</span>
                    </div>
                  </td>
                  <td>{{ vigembus.supported_versions }}</td>
                  <td>
                    <span class="status-icon driver-status-icon" :class="driverStatusClass(vigembus)" :title="driverStatusText(vigembus)">
                      <AlertCircle v-if="!vigembus.installed" :size="19" aria-hidden="true"></AlertCircle>
                      <CheckCircle v-else-if="vigembus.version_compatible" :size="19" aria-hidden="true"></CheckCircle>
                      <XCircle v-else :size="19" aria-hidden="true"></XCircle>
                      <span class="kg-visually-hidden">{{ driverStatusText(vigembus) }}</span>
                    </span>
                  </td>
                  <td>
                    <a class="kg-btn kg-btn-secondary kg-btn-sm driver-download-button" href="https://github.com/nefarius/ViGEmBus/releases/latest" target="_blank" rel="noopener noreferrer">
                      <Download :size="14" aria-hidden="true"></Download>
                      {{ $t('troubleshooting.driver_download') }}
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="virtualhid-license-section" aria-labelledby="virtualhid-license" v-if="showVirtualhid">
          <div class="kg-between kg-row-wrap">
            <div>
              <h3 id="virtualhid-license">{{ $t('troubleshooting.virtualhid_broker_license') }}</h3>
              <p class="kg-help">{{ $t(platform === 'macos' ? 'troubleshooting.virtualhid_macos_license_desc' : 'troubleshooting.virtualhid_license_desc') }}</p>
            </div>
            <span class="kg-badge" :class="licenseStatusClass()">{{ licenseStatusText() }}</span>
          </div>

          <div class="kg-callout kg-callout-danger kg-mt-3" role="alert" v-if="licenseError">
            <AlertCircle :size="16" class="kg-icon" aria-hidden="true"></AlertCircle>
            <span>{{ licenseError }}</span>
          </div>
          <div class="kg-callout kg-callout-warning kg-mt-3" role="alert" v-else-if="!virtualhidLicense.service_available">
            <AlertTriangle :size="16" class="kg-icon" aria-hidden="true"></AlertTriangle>
            <span>{{ virtualhidLicense.message || $t('troubleshooting.virtualhid_broker_unavailable') }}</span>
          </div>

          <div class="kg-stat-grid kg-mt-3">
            <dl class="kg-stat-tile virtualhid-license-stat" v-if="virtualhidLicense.plan_name">
              <dt>{{ $t('troubleshooting.virtualhid_license_plan') }}</dt>
              <dd>{{ virtualhidLicense.plan_name }}</dd>
            </dl>
            <dl class="kg-stat-tile virtualhid-license-stat">
              <dt>{{ $t('troubleshooting.virtualhid_license_activation_limit') }}</dt>
              <dd>{{ licenseActivationLimitText() }}</dd>
            </dl>
            <dl class="kg-stat-tile virtualhid-license-stat">
              <dt>{{ $t('troubleshooting.virtualhid_license_active_devices') }}</dt>
              <dd>{{ virtualhidLicense.active_devices }}</dd>
            </dl>
            <dl class="kg-stat-tile virtualhid-license-stat" v-if="virtualhidLicense.customer_email">
              <dt>{{ $t('troubleshooting.virtualhid_license_customer') }}</dt>
              <dd>{{ virtualhidLicense.customer_email }}</dd>
            </dl>
          </div>

          <p class="kg-muted kg-mt-3" v-if="virtualhidLicense.message && virtualhidLicense.service_available">
            {{ virtualhidLicense.message }}
          </p>

          <div class="kg-row kg-row-wrap kg-mt-3 virtualhid-license-toolbar">
            <button class="kg-btn kg-btn-secondary kg-btn-sm" type="button" :disabled="licenseBusy || !virtualhidLicense.service_available" @click="updateLicense('validate')">
              <RefreshCw :size="14" :class="{ 'kg-spin': licenseBusy }" aria-hidden="true"></RefreshCw>
              {{ $t('troubleshooting.virtualhid_license_refresh') }}
            </button>
            <a class="kg-btn kg-btn-secondary kg-btn-sm" v-if="virtualhidLicense.manage_account_url" :href="virtualhidLicense.manage_account_url" target="_blank" rel="noopener noreferrer">
              <ExternalLink :size="14" aria-hidden="true"></ExternalLink>
              {{ $t('troubleshooting.virtualhid_license_manage') }}
            </a>
            <a class="kg-btn kg-btn-success kg-btn-sm" v-if="virtualhidLicense.purchase_url && !virtualhidLicense.licensed" :href="virtualhidLicense.purchase_url" target="_blank" rel="noopener noreferrer">
              {{ $t('troubleshooting.virtualhid_license_buy') }}
            </a>
            <button class="kg-btn kg-btn-danger kg-btn-sm" type="button" v-if="virtualhidLicense.licensed" :disabled="licenseBusy || !virtualhidLicense.service_available" @click="updateLicense('deactivate')">
              <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
              {{ $t('troubleshooting.virtualhid_license_deactivate') }}
            </button>
          </div>

          <div class="kg-field kg-mt-3" v-if="!virtualhidLicense.licensed">
            <label for="virtualhid-license-key" class="kg-label">{{ $t('troubleshooting.virtualhid_license_key') }}</label>
            <div class="kg-input-group">
              <input id="virtualhid-license-key" class="kg-input" type="password" v-model="licenseKey"
                     :placeholder="$t('troubleshooting.virtualhid_license_key_placeholder')"
                     :disabled="licenseBusy || !virtualhidLicense.service_available"
                     autocomplete="off" autocapitalize="off" spellcheck="false"
                     @keyup.enter="updateLicense('activate')" />
              <button class="kg-btn kg-btn-primary kg-btn-sm" type="button"
                      :disabled="licenseBusy || !virtualhidLicense.service_available || !licenseKey.trim()"
                      @click="updateLicense('activate')">
                <KeyRound :size="14" aria-hidden="true"></KeyRound>
                {{ $t('troubleshooting.virtualhid_license_activate') }}
              </button>
            </div>
            <p class="kg-help">{{ $t('troubleshooting.virtualhid_license_key_desc') }}</p>
          </div>

          <div class="kg-callout kg-callout-success kg-mt-3 virtualhid-license-active" v-else>
            <CheckCircle :size="18" class="kg-icon" aria-hidden="true"></CheckCircle>
            <div>
              <strong>{{ $t('troubleshooting.virtualhid_license_machine_activated') }}</strong>
              <p>{{ $t('troubleshooting.virtualhid_broker_activated_desc') }}</p>
            </div>
          </div>
        </section>
      </div>
    </section>

    <!-- Acoes -->
    <section class="kg-card" aria-labelledby="actions-title">
      <div class="kg-card-head">
        <h2 id="actions-title">{{ $t('troubleshooting.actions_title') }}</h2>
      </div>
      <div class="kg-card-pad kg-stack-4">
        <div id="close_apps" class="kg-stack-2">
          <h3>{{ $t('troubleshooting.force_close') }}</h3>
          <p class="kg-help">{{ $t('troubleshooting.force_close_desc') }}</p>
          <div v-if="closeAppStatus === true" class="kg-callout kg-callout-success" role="status">{{ $t('troubleshooting.force_close_success') }}</div>
          <div v-if="closeAppStatus === false" class="kg-callout kg-callout-danger" role="alert">{{ $t('troubleshooting.force_close_error') }}</div>
          <div>
            <button class="kg-btn kg-btn-warning kg-btn-sm" :disabled="closeAppPressed" @click="closeApp">
              <XCircle :size="14" class="kg-icon" aria-hidden="true"></XCircle>
              {{ $t('troubleshooting.force_close') }}
            </button>
          </div>
        </div>

        <div class="kg-divider"></div>

        <div id="restart" class="kg-stack-2">
          <h3>{{ $t('troubleshooting.restart_KLOUD_GAMES') }}</h3>
          <p class="kg-help">{{ $t('troubleshooting.restart_KLOUD_GAMES_desc') }}</p>
          <div v-if="restartPressed === true" class="kg-callout kg-callout-success" role="status">{{ $t('troubleshooting.restart_KLOUD_GAMES_success') }}</div>
          <div>
            <button class="kg-btn kg-btn-warning kg-btn-sm" :disabled="restartPressed" @click="restart">
              <RefreshCw :size="14" class="kg-icon" aria-hidden="true"></RefreshCw>
              {{ $t('troubleshooting.restart_KLOUD_GAMES') }}
            </button>
          </div>
        </div>

        <template v-if="platform === 'linux' || platform === 'freebsd'">
          <div class="kg-divider"></div>
          <div id="portal_reset" class="kg-stack-2">
            <h3>{{ $t('troubleshooting.portal_reset') }}</h3>
            <p class="kg-help">{{ $t('troubleshooting.portal_reset_desc') }}</p>
            <div v-if="portalResetStatus === true" class="kg-callout kg-callout-success" role="status">{{ $t('troubleshooting.portal_reset_success') }}</div>
            <div v-if="portalResetStatus === false" class="kg-callout kg-callout-danger" role="alert">{{ $t('troubleshooting.portal_reset_error') }}</div>
            <div>
              <button class="kg-btn kg-btn-warning kg-btn-sm" :disabled="portalResetPressed" @click="resetPortalToken">
                <RotateCcw :size="14" class="kg-icon" aria-hidden="true"></RotateCcw>
                {{ $t('troubleshooting.portal_reset') }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="platform === 'windows'">
          <div class="kg-divider"></div>
          <div id="dd_reset" class="kg-stack-2">
            <h3>{{ $t('troubleshooting.dd_reset') }}</h3>
            <p class="kg-help" style="white-space: pre-line">{{ $t('troubleshooting.dd_reset_desc') }}</p>
            <div v-if="ddResetStatus === true" class="kg-callout kg-callout-success" role="status">{{ $t('troubleshooting.dd_reset_success') }}</div>
            <div v-if="ddResetStatus === false" class="kg-callout kg-callout-danger" role="alert">{{ $t('troubleshooting.dd_reset_error') }}</div>
            <div>
              <button class="kg-btn kg-btn-warning kg-btn-sm" :disabled="ddResetPressed" @click="ddResetPersistence">
                <RotateCcw :size="14" class="kg-icon" aria-hidden="true"></RotateCcw>
                {{ $t('troubleshooting.dd_reset') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </section>

    <!-- Clientes -->
    <section class="kg-card" aria-labelledby="unpair">
      <div class="kg-card-head">
        <div>
          <h2 id="unpair">{{ $t('troubleshooting.unpair_title') }}</h2>
          <p class="kg-card-sub">{{ $t('troubleshooting.unpair_desc') }}</p>
        </div>
      </div>
      <div class="kg-card-pad">
        <ClientsPanel compact :title-key="'troubleshooting.unpair_title'" :description-key="'troubleshooting.unpair_desc'" />
      </div>
    </section>

    <LogsPanel :text="logs" />
  </AppShell>
</template>

<script>
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock3,
  Download,
  ExternalLink,
  Gamepad2,
  KeyRound,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from '@lucide/vue'
import AppShell from './components/AppShell.vue'
import ClientsPanel from './components/clients/ClientsPanel.vue'
import LogsPanel from './components/diagnostics/LogsPanel.vue'
import { publishHostMeta } from './components/host-meta'
import { apiFetch } from './fetch_utils'

const permissionOrder = ['screen_recording', 'input', 'notifications', 'microphone', 'system_audio', 'local_network'];

export default {
  components: {
    AppShell,
    ClientsPanel,
    LogsPanel,
    AlertCircle,
    AlertTriangle,
    CheckCircle,
    Clock3,
    Download,
    ExternalLink,
    Gamepad2,
    KeyRound,
    MousePointer2,
    RefreshCw,
    RotateCcw,
    ShieldCheck,
    Sparkles,
    Trash2,
    XCircle,
  },
  data() {
    return {
      closeAppPressed: false,
      closeAppStatus: null,
      ddResetPressed: false,
      ddResetStatus: null,
      logs: '',
      logInterval: null,
      licenseBusy: false,
      licenseError: '',
      licenseKey: '',
      portalResetPressed: false,
      portalResetStatus: null,
      permissions: [],
      permissionBusy: '',
      permissionError: '',
      permissionHelp: '',
      restartPressed: false,
      platform: "",
      gamepadDriver: '',
      virtualhid: {
        installed: false,
        version: '',
        version_compatible: false,
        minimum_version: '',
        supported_versions: '',
      },
      virtualhidLicense: {
        operation_ok: false,
        service_available: false,
        state: 'unavailable',
        licensed: false,
        active_devices: 0,
        activation_limit: 0,
        activation_usage: 0,
        plan_name: '',
        customer_email: '',
        message: '',
        purchase_url: '',
        manage_account_url: '',
      },
      virtualhidRelease: {
        loading: false,
        version: '',
        url: 'https://github.com/LizardByte/libvirtualhid/releases/latest',
        error: false,
      },
      vigembus: {
        installed: false,
        version: '',
        version_compatible: false,
        minimum_version: '',
        supported_versions: '',
      },
    };
  },
  computed: {
    /** Keep known permissions in troubleshooting order on every platform. */
    orderedPermissions() {
      return this.permissions.slice().sort((left, right) => {
        const leftRank = permissionOrder.indexOf(left.id);
        const rightRank = permissionOrder.indexOf(right.id);
        return (leftRank < 0 ? permissionOrder.length : leftRank) -
          (rightRank < 0 ? permissionOrder.length : rightRank);
      });
    },

    showVirtualhid() {
      return this.gamepadDriver !== 'none' && (this.platform === 'macos' || this.gamepadDriver !== 'vigembus');
    },

    showVigembus() {
      return this.platform === 'windows' && this.gamepadDriver !== 'none' && this.gamepadDriver !== 'virtualhid';
    },

    showVirtualhidBenefits() {
      return this.platform === 'windows' && this.gamepadDriver !== 'none' && !(this.virtualhid.installed && this.virtualhidLicense.licensed);
    },

    virtualInputDescriptionKey() {
      if (this.gamepadDriver === 'none') {
        return 'troubleshooting.virtual_gamepad_none_desc';
      }
      if (this.platform === 'macos') {
        return 'troubleshooting.virtual_gamepad_macos_desc';
      }
      if (!this.gamepadDriver) {
        return 'troubleshooting.virtual_gamepad_unset_desc';
      }
      if (this.gamepadDriver === 'vigembus') {
        return 'troubleshooting.virtual_gamepad_vigembus_desc';
      }
      if (this.virtualhid.installed && this.virtualhidLicense.licensed) {
        return this.gamepadDriver === 'all' ?
          'troubleshooting.virtual_gamepad_licensed_all_desc' :
          'troubleshooting.virtual_gamepad_licensed_desc';
      }
      return 'troubleshooting.virtual_gamepad_desc';
    },

    driverReleaseLoading() {
      return this.showVirtualhid && this.virtualhidRelease.loading;
    }
  },
  created() {
    fetch("/api/config")
      .then((r) => r.json())
      .then((r) => {
        this.platform = r.platform;
        this.gamepadDriver = r.gamepad_driver || '';
        publishHostMeta(r)
        this.refreshPermissions();
        // The Windows broker also backs relative mouse input when gamepads are disabled.
        if (this.platform === 'windows' || this.platform === 'macos') {
          this.refreshDriverInformation();
        }
        if ((this.platform === 'windows' || this.platform === 'macos') && this.showVirtualhid) {
          this.refreshLicenseStatus();
        }
      });

    this.logInterval = setInterval(() => {
      this.refreshLogs();
      if (this.platform) this.refreshPermissions();
    }, 5000);
    this.refreshLogs();
  },
  beforeUnmount() {
    clearInterval(this.logInterval);
  },
  methods: {
    /** Refresh the current platform's permission status. */
    async refreshPermissions() {
      try {
        const response = await fetch('./api/permissions');
        if (!response.ok) throw new Error(this.$t('troubleshooting.permissions_error'));
        this.permissions = (await response.json()).permissions || [];
        this.permissionError = '';
      } catch (error) {
        this.permissionError = error.message;
      }
    },
    /** Initiate the selected native permission action. */
    async requestPermission(id) {
      this.permissionBusy = id;
      try {
        const response = await apiFetch('./api/permissions/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        if (!response.ok) throw new Error(this.$t('troubleshooting.permissions_error'));
        if (id === 'local_network' || (this.platform === 'macos' && (id === 'screen_recording' || id === 'input'))) {
          this.permissionHelp = id;
        }
        await this.refreshPermissions();
      } catch (error) {
        this.permissionError = error.message;
      } finally {
        this.permissionBusy = '';
      }
    },
    refreshLogs() {
      fetch("./api/logs")
        .then((r) => r.text())
        .then((r) => {
          this.logs = r;
        });
    },
    closeApp() {
      this.closeAppPressed = true;
      apiFetch("./api/apps/close", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        } })
        .then((r) => r.json())
        .then((r) => {
          this.closeAppPressed = false;
          this.closeAppStatus = r.status;
          setTimeout(() => {
            this.closeAppStatus = null;
          }, 5000);
        });
    },
    restart() {
      this.restartPressed = true;
      setTimeout(() => {
        this.restartPressed = false;
      }, 5000);
      apiFetch("./api/restart", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        }
      });
    },
    resetPortalToken() {
      this.portalResetPressed = true;
      apiFetch("./api/reset-portal-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      })
        .then((r) => r.json())
        .then((r) => {
          this.portalResetStatus = r.status;
          if (r.status) {
            apiFetch("./api/restart", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              }
            });
          }
          setTimeout(() => {
            this.portalResetPressed = false;
            this.portalResetStatus = null;
          }, 5000);
        })
        .catch(() => {
          this.portalResetPressed = false;
          this.portalResetStatus = false;
        });
    },
    ddResetPersistence() {
      this.ddResetPressed = true;
      apiFetch("/api/reset-display-device-persistence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        }
      })
        .then((r) => r.json())
        .then((r) => {
          this.ddResetPressed = false;
          this.ddResetStatus = r.status;
          setTimeout(() => {
            this.ddResetStatus = null;
          }, 5000);
        });
    },
    /**
     * @brief Refresh the installed backend details and latest stable Virtual HID Broker release.
     */
    refreshDriverInformation() {
      this.refreshVirtualInputStatus();
      this.refreshDriverReleases();
    },
    /**
     * @brief Refresh the latest stable release metadata for Virtual HID Broker.
     */
    refreshDriverReleases() {
      if (this.showVirtualhid) {
        this.updateLatestRelease(
          'virtualhidRelease',
          'LizardByte/libvirtualhid',
          'https://github.com/LizardByte/libvirtualhid/releases/latest',
        );
      }
    },
    /**
     * @brief Fetch one repository's latest non-prerelease release from GitHub.
     *
     * @param {string} property Component data property that stores the release metadata.
     * @param {string} repository GitHub repository in owner/name form.
     * @param {string} fallbackUrl Releases page used if the API request fails.
     */
    updateLatestRelease(property, repository, fallbackUrl) {
      this[property] = {
        ...this[property],
        loading: true,
        error: false,
      };

      fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
        },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`GitHub returned ${response.status}`);
          }
          return response.json();
        })
        .then((release) => {
          if (!release.tag_name || release.draft || release.prerelease) {
            throw new Error('GitHub did not return a stable release');
          }
          this[property] = {
            loading: false,
            version: release.tag_name,
            url: release.html_url || fallbackUrl,
            error: false,
          };
        })
        .catch((error) => {
          console.error(`Failed to fetch the latest ${repository} release:`, error);
          this[property] = {
            loading: false,
            version: '',
            url: fallbackUrl,
            error: true,
          };
        });
    },
    refreshVirtualInputStatus() {
      fetch("/api/virtual-input/status")
        .then((r) => r.json())
        .then((r) => {
          const virtualhid = r.virtualhid || {};
          const vigembus = r.vigembus || {};
          this.virtualhid = {
            installed: virtualhid.installed || false,
            version: virtualhid.version || '',
            version_compatible: virtualhid.version_compatible || false,
            minimum_version: virtualhid.minimum_version || '',
            supported_versions: virtualhid.supported_versions || '',
          };
          this.vigembus = {
            installed: vigembus.installed || false,
            version: vigembus.version || '',
            version_compatible: vigembus.version_compatible || false,
            minimum_version: vigembus.minimum_version || '',
            supported_versions: vigembus.supported_versions || '',
          };
        })
        .catch((err) => {
          console.error("Failed to fetch virtual input driver status:", err);
        });
    },
    /**
     * @brief Parse a numeric dotted driver or release version.
     *
     * @param {string} version Version string, optionally prefixed with "v".
     * @return {number[]|null} Numeric version parts, or null for an invalid version.
     */
    parseDriverVersion(version) {
      const match = /^v?(\d+(?:\.\d+)*)/i.exec(String(version || '').trim());
      return match ? match[1].split('.').map(Number) : null;
    },
    /**
     * @brief Compare installed and latest driver versions.
     *
     * @param {string} installedVersion Installed driver version.
     * @param {string} latestVersion Latest stable release version.
     * @return {number|null} Negative if outdated, zero if equal, positive if newer, or null if invalid.
     */
    compareDriverVersions(installedVersion, latestVersion) {
      const installedParts = this.parseDriverVersion(installedVersion);
      const latestParts = this.parseDriverVersion(latestVersion);
      if (!installedParts || !latestParts) {
        return null;
      }

      const partCount = Math.max(installedParts.length, latestParts.length);
      for (let index = 0; index < partCount; ++index) {
        const installedPart = installedParts[index] || 0;
        const latestPart = latestParts[index] || 0;
        if (installedPart !== latestPart) {
          return installedPart > latestPart ? 1 : -1;
        }
      }
      return 0;
    },
    /**
     * @brief Get the availability state for one installed driver and GitHub release.
     *
     * @param {object} driver Installed driver status.
     * @param {object} release Latest GitHub release status.
     * @return {string} Release state used to select the icon and message.
     */
    driverReleaseState(driver, release) {
      if (release.loading) {
        return 'loading';
      }
      if (release.error || !release.version) {
        return 'unavailable';
      }
      if (!driver.installed) {
        return 'not-installed';
      }

      const comparison = this.compareDriverVersions(driver.version, release.version);
      if (comparison === null) {
        return 'unknown';
      }
      return comparison >= 0 ? 'current' : 'outdated';
    },
    /**
     * @brief Get the localized release comparison message for a driver.
     *
     * @param {object} driver Installed driver status.
     * @param {object} release Latest GitHub release status.
     * @return {string} Localized release comparison message.
     */
    driverReleaseStatusText(driver, release) {
      const state = this.driverReleaseState(driver, release).replace('-', '_');
      return this.$t(`troubleshooting.driver_release_${state}`);
    },
    /**
     * @brief Get a theme-aware text class for a driver release state.
     *
     * @param {object} driver Installed driver status.
     * @param {object} release Latest GitHub release status.
     * @return {string} CSS class for the release icon and version.
     */
    driverReleaseStateClass(driver, release) {
      const state = this.driverReleaseState(driver, release);
      if (state === 'current') {
        return 'driver-release-current';
      }
      if (state === 'outdated') {
        return 'driver-release-outdated';
      }
      return 'driver-release-neutral';
    },
    /**
     * @brief Format a latest release version for the drivers table.
     *
     * @param {object} release Latest GitHub release status.
     * @return {string} Release version or a localized placeholder.
     */
    driverLatestVersion(release) {
      if (release.loading) {
        return this.$t('troubleshooting.driver_release_checking');
      }
      return release.version || this.$t('troubleshooting.driver_release_unavailable');
    },
    applyLicenseStatus(status) {
      this.virtualhidLicense = {
        ...this.virtualhidLicense,
        ...status,
      };
      this.licenseError = status.error || '';
    },
    refreshLicenseStatus() {
      this.licenseBusy = true;
      this.licenseError = '';
      fetch("/api/virtual-input/license")
        .then(async (response) => {
          const status = await response.json();
          if (!response.ok) {
            throw new Error(status.error || this.$t('troubleshooting.virtualhid_license_request_failed'));
          }
          this.applyLicenseStatus(status);
        })
        .catch((error) => {
          this.licenseError = error.message;
        })
        .finally(() => {
          this.licenseBusy = false;
        });
    },
    updateLicense(action) {
      if (this.licenseBusy || (action === 'activate' && !this.licenseKey.trim())) {
        return;
      }

      this.licenseBusy = true;
      this.licenseError = '';
      const body = { action };
      if (action === 'activate') {
        body.license_key = this.licenseKey.trim();
      }

      apiFetch("/api/virtual-input/license", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      })
        .then(async (response) => {
          const status = await response.json();
          if (!response.ok) {
            throw new Error(status.error || this.$t('troubleshooting.virtualhid_license_request_failed'));
          }
          this.applyLicenseStatus(status);
          if (action === 'activate' && status.operation_ok) {
            this.licenseKey = '';
          }
        })
        .catch((error) => {
          this.licenseError = error.message;
        })
        .finally(() => {
          body.license_key = '';
          this.licenseBusy = false;
        });
    },
    licenseStatusClass() {
      if (this.virtualhidLicense.state === 'licensed') {
        return 'kg-badge-success';
      }
      if (['expired', 'disabled', 'invalid'].includes(this.virtualhidLicense.state)) {
        return 'kg-badge-danger';
      }
      return 'kg-badge-neutral';
    },
    licenseStatusText() {
      const key = `troubleshooting.virtualhid_license_state_${this.virtualhidLicense.state}`;
      return this.$t(key);
    },
    licenseActivationLimitText() {
      if (!this.virtualhidLicense.activation_limit) {
        return this.$t('troubleshooting.virtualhid_license_not_reported');
      }
      return String(this.virtualhidLicense.activation_limit);
    },
    driverVersion(driver) {
      if (!driver.installed) {
        return this.$t('troubleshooting.driver_not_installed');
      }
      return driver.version || this.$t('troubleshooting.driver_version_unknown');
    },
    /**
     * @brief Choose a visual state for a permission status icon.
     *
     * @param {string} status Permission status returned by the platform.
     * @return {string} Theme-aware status icon class.
     */
    permissionStatusClass(status) {
      if (status === 'granted') return 'status-icon-success';
      if (status === 'denied') return 'status-icon-danger';
      if (status === 'on_use') return 'status-icon-primary';
      if (status === 'not_determined') return 'status-icon-neutral';
      return 'status-icon-warning';
    },
    /**
     * @brief Choose a visual state for a virtual input backend status icon.
     *
     * @param {object} driver Installed backend status.
     * @return {string} Theme-aware status icon class.
     */
    driverStatusClass(driver) {
      if (!driver.installed) {
        return 'status-icon-neutral';
      }
      return driver.version_compatible ? 'status-icon-success' : 'status-icon-danger';
    },
    driverStatusText(driver) {
      if (!driver.installed) {
        return this.$t('troubleshooting.driver_status_not_installed');
      }
      if (driver.version_compatible) {
        return this.$t('troubleshooting.driver_status_compatible');
      }
      return this.$t('troubleshooting.driver_status_unsupported');
    },
  },
}
</script>
