<template>
  <AppShell>
    <div class="kg-page-head">
      <div>
        <h1>{{ $t('pin.pin_pairing') }}</h1>
        <p class="kg-sub">{{ $t('pin.pin_hint') }}</p>
      </div>
      <span class="kg-badge kg-badge-neutral">
        {{ $t('pin.auto_refresh') }}
      </span>
    </div>

    <div class="kg-grid kg-grid-2">
      <section class="kg-card" aria-labelledby="pin-form-title">
        <div class="kg-card-head">
          <h2 id="pin-form-title">{{ $t('pin.pairing_requests') }}</h2>
          <span v-if="pendingPairings.length" class="kg-count-chip">{{ pendingPairings.length }}</span>
        </div>
        <form class="kg-card-pad kg-stack-4" id="form" @submit.prevent="registerDevice">
          <div class="kg-field">
            <label for="pairing-input" class="kg-label">{{ $t('pin.select_pairing') }}</label>
            <div class="kg-input-group">
              <select id="pairing-input" v-model="selectedPairingId" class="kg-select" required>
                <option disabled value="">
                  {{ pendingPairings.length ? $t('pin.select_pairing') : $t('pin.no_pending_pairings') }}
                </option>
                <option v-for="pairing in pendingPairings" :key="pairing.id" :value="pairing.id">
                  {{ pairing.name || $t('pin.unknown_device') }} — {{ pairing.address || $t('pin.unknown_address') }}
                </option>
              </select>
              <button
                type="button"
                class="kg-btn kg-btn-danger kg-btn-sm"
                :disabled="!selectedPairingId"
                :title="$t('pin.cancel_pairing')"
                :aria-label="$t('pin.cancel_pairing')"
                @click="cancelSelectedPairing"
              >
                <X :size="15" class="kg-icon" aria-hidden="true"></X>
              </button>
            </div>
          </div>

          <div class="kg-field">
            <span class="kg-label">{{ $t('pin.pin_label') }}</span>
            <div class="kg-pin-boxes" role="group" :aria-label="$t('pin.pin_label')">
              <input
                v-for="(digit, index) in pinDigits"
                :key="index"
                :ref="`pinBox${index}`"
                v-model="pinDigits[index]"
                class="kg-pin-box"
                type="text"
                inputmode="numeric"
                pattern="\d"
                maxlength="1"
                autocomplete="one-time-code"
                :aria-label="`${$t('pin.pin_label')} ${index + 1}`"
                @input="onPinInput(index, $event)"
                @keydown.backspace="onPinBackspace(index, $event)"
                @paste="onPinPaste"
              />
            </div>
            <p class="kg-help">{{ $t('pin.pin_hint') }}</p>
          </div>

          <div class="kg-field">
            <label for="name-input" class="kg-label">{{ $t('pin.device_name') }}</label>
            <input id="name-input" v-model="name" class="kg-input" type="text" :placeholder="$t('pin.device_name')" required />
          </div>

          <div v-if="status" class="kg-callout" :class="status.type === 'success' ? 'kg-callout-success' : 'kg-callout-danger'" role="alert">
            {{ status.message }}
          </div>

          <button type="submit" class="kg-btn kg-btn-primary kg-btn-block">
            <Forward :size="16" class="kg-icon" aria-hidden="true"></Forward>
            {{ $t('pin.send') }}
          </button>

          <div class="kg-callout kg-callout-warning">
            <AlertTriangle :size="16" class="kg-icon" aria-hidden="true"></AlertTriangle>
            <span><strong>{{ $t('_common.warning') }}</strong> {{ $t('pin.warning_msg') }}</span>
          </div>
        </form>
      </section>

      <ClientsPanel />
    </div>
  </AppShell>
</template>

<script>
import { AlertTriangle, Forward, X } from '@lucide/vue'
import AppShell from './components/AppShell.vue'
import ClientsPanel from './components/clients/ClientsPanel.vue'
import { apiFetch } from './fetch_utils'

export default {
  components: {
    AppShell,
    ClientsPanel,
    AlertTriangle,
    Forward,
    X,
  },
  inject: ['i18n'],
  data() {
    return {
      name: '',
      pendingPairings: [],
      pin: '',
      pinDigits: ['', '', '', ''],
      refreshTimer: null,
      selectedPairingId: '',
      status: null,
    };
  },
  watch: {
    pinDigits: {
      deep: true,
      handler(digits) {
        this.pin = digits.join('')
      },
    },
  },
  mounted() {
    this.loadPendingPairings();
    this.refreshTimer = window.setInterval(() => this.loadPendingPairings(), 2000);
  },
  beforeUnmount() {
    window.clearInterval(this.refreshTimer);
  },
  methods: {
    /**
     * @brief Accept a single digit and advance to the next box.
     *
     * @param {number} index Box index.
     * @param {InputEvent} event Input event.
     * @return {void}
     */
    onPinInput(index, event) {
      const digits = String(event.target.value || '').replace(/\D/g, '')
      this.pinDigits[index] = digits.slice(-1)
      event.target.value = this.pinDigits[index]
      if (this.pinDigits[index] && index < 3) {
        this.focusPinBox(index + 1)
      }
    },
    /**
     * @brief Focus one PIN box (refs inside v-for are arrays).
     *
     * @param {number} index Box index.
     * @return {void}
     */
    focusPinBox(index) {
      const ref = this.$refs[`pinBox${index}`]
      const element = Array.isArray(ref) ? ref[0] : ref
      element?.focus?.()
    },
    /**
     * @brief Move focus back when deleting an empty box.
     *
     * @param {number} index Box index.
     * @param {KeyboardEvent} event Key event.
     * @return {void}
     */
    onPinBackspace(index, event) {
      if (this.pinDigits[index] || index === 0) return
      event.preventDefault()
      this.focusPinBox(index - 1)
    },
    /**
     * @brief Distribute a pasted PIN across the four boxes.
     *
     * @param {ClipboardEvent} event Paste event.
     * @return {void}
     */
    onPinPaste(event) {
      const digits = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 4)
      if (!digits) return
      event.preventDefault()
      for (let index = 0; index < 4; index++) {
        this.pinDigits[index] = digits[index] || ''
      }
      this.focusPinBox(3)
    },
    /**
     * @brief Clear the PIN boxes after a successful pairing.
     *
     * @return {void}
     */
    clearPin() {
      this.pin = ''
      this.pinDigits = ['', '', '', '']
    },
    /**
     * @brief Refresh the authenticated list of pairing requests awaiting approval.
     */
    async loadPendingPairings() {
      try {
        const response = await apiFetch('./api/pin', {method: 'GET'});
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const body = await response.json();
        this.pendingPairings = body.pairings || [];
        if (!this.pendingPairings.some((pairing) => pairing.id === this.selectedPairingId)) {
          this.selectedPairingId = this.pendingPairings.length === 1 ? this.pendingPairings[0].id : '';
        }
      } catch (error) {
        console.error('Failed to load pending pairing requests', error);
        this.status = {type: 'danger', message: this.i18n.t('pin.load_failure')};
      }
    },

    /**
     * @brief Apply the entered PIN only to the pairing request selected by the operator.
     */
    async registerDevice() {
      this.status = null;
      if (!this.selectedPairingId) {
        this.status = {type: 'danger', message: this.i18n.t('pin.select_pairing_required')};
        return;
      }

      const body = JSON.stringify({
        pairing_id: this.selectedPairingId,
        pin: this.pin,
        name: this.name,
      });
      const response = await apiFetch('./api/pin', {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body,
      });
      const result = await response.json();
      if (result.status === true) {
        this.status = {type: 'success', message: this.i18n.t('pin.pair_success')};
        this.clearPin();
        this.name = '';
      } else {
        this.status = {type: 'danger', message: this.i18n.t('pin.pair_failure')};
      }
      await this.loadPendingPairings();
    },

    /**
     * @brief Cancel the selected pending request without affecting other clients.
     */
    async cancelSelectedPairing() {
      if (!this.selectedPairingId) {
        return;
      }

      const response = await apiFetch('./api/pin', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({pairing_id: this.selectedPairingId}),
      });
      const result = await response.json();
      this.status = result.status === true
        ? {type: 'success', message: this.i18n.t('pin.cancel_success')}
        : {type: 'danger', message: this.i18n.t('pin.cancel_failure')};
      await this.loadPendingPairings();
    }
  }
}
</script>
