<script>
import { Trash2, Users } from '@lucide/vue'
import KgSwitch from '../ui/KgSwitch.vue'
import { apiFetch } from '../../fetch_utils'

/**
 * @file ClientsPanel.vue
 * @brief Lista de clientes pareados (toggle enabled / desparear), usada em /pin e /diagnostics.
 *
 * O host so expoe `name`, `uuid` e `enabled`; nao ha endereco, plataforma ou
 * ultimo acesso (nao se inventa dado). Nenhum polling proprio: o pai decide.
 */
export default {
  name: 'ClientsPanel',
  components: { KgSwitch, Trash2, Users },
  props: {
    // Compacto: sem cabecalho de cartao proprio (usado dentro de outro cartao).
    compact: { type: Boolean, default: false },
    showUnpairAll: { type: Boolean, default: true },
    titleKey: { type: String, default: 'pin.clients_title' },
    descriptionKey: { type: String, default: 'pin.clients_desc' },
    emptyKey: { type: String, default: 'troubleshooting.unpair_single_no_devices' },
  },
  emits: ['changed'],
  data() {
    return {
      clients: [],
      loading: false,
      error: '',
      unpairAllPressed: false,
      unpairAllStatus: null,
      applyMessage: false,
      busyClient: '',
    }
  },
  mounted() {
    this.refreshClients()
  },
  methods: {
    /**
     * @brief Load paired clients.
     *
     * @return {Promise<void>} Completion of the request.
     */
    async refreshClients() {
      this.loading = true
      try {
        const response = await fetch('./api/clients/list')
        const body = await response.json()
        if (body.status === true && Array.isArray(body.named_certs) && body.named_certs.length) {
          this.clients = [...body.named_certs].sort((a, b) => {
            return ((a.name || '').toLowerCase() > (b.name || '').toLowerCase() || a.name === '' ? 1 : -1)
          })
        } else {
          this.clients = []
        }
        this.error = ''
      } catch (error) {
        this.error = error.message
      } finally {
        this.loading = false
      }
    },
    /**
     * @brief Enable or disable a paired client.
     *
     * @param {string} uuid Client UUID.
     * @param {boolean} enabled Desired state.
     * @return {Promise<void>} Completion of the update.
     */
    async toggleClient(uuid, enabled) {
      this.busyClient = uuid
      try {
        await fetch('./api/clients/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid, enabled }),
        })
        await this.refreshClients()
        this.$emit('changed')
      } catch (error) {
        this.error = error.message
      } finally {
        this.busyClient = ''
      }
    },
    /**
     * @brief Unpair a single client.
     *
     * @param {string} uuid Client UUID.
     * @return {Promise<void>} Completion of the request.
     */
    async unpairSingle(uuid) {
      this.busyClient = uuid
      try {
        await apiFetch('./api/clients/unpair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uuid }),
        })
        this.applyMessage = true
        await this.refreshClients()
        this.$emit('changed')
      } catch (error) {
        this.error = error.message
      } finally {
        this.busyClient = ''
      }
    },
    /**
     * @brief Unpair every paired client.
     *
     * @return {Promise<void>} Completion of the request and status reset timer.
     */
    async unpairAll() {
      this.unpairAllPressed = true
      try {
        const response = await apiFetch('./api/clients/unpair-all', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const body = await response.json()
        this.unpairAllStatus = body.status
        await this.refreshClients()
        this.$emit('changed')
      } catch (error) {
        this.unpairAllStatus = false
        this.error = error.message
      } finally {
        this.unpairAllPressed = false
        setTimeout(() => {
          this.unpairAllStatus = null
        }, 5000)
      }
    },
  },
}
</script>

<template>
  <section :class="compact ? '' : 'kg-card'" :aria-labelledby="compact ? undefined : 'clients-panel-title'">
    <div class="kg-card-head" v-if="!compact">
      <div>
        <h2 id="clients-panel-title">{{ $t(titleKey) }}</h2>
        <p class="kg-card-sub">{{ $t(descriptionKey) }}</p>
      </div>
      <button
        v-if="showUnpairAll && clients.length"
        class="kg-btn kg-btn-danger kg-btn-sm"
        type="button"
        :disabled="unpairAllPressed"
        @click="unpairAll"
      >
        <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
        {{ $t('troubleshooting.unpair_all') }}
      </button>
    </div>
    <div v-else-if="compact && showUnpairAll && clients.length" class="kg-between kg-mt-3">
      <span class="kg-visually-hidden">{{ $t(titleKey) }}</span>
      <button class="kg-btn kg-btn-danger kg-btn-sm" type="button" :disabled="unpairAllPressed" @click="unpairAll">
        <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
        {{ $t('troubleshooting.unpair_all') }}
      </button>
    </div>

    <div v-if="error" class="kg-callout kg-callout-danger" role="alert">{{ error }}</div>
    <div v-if="applyMessage" class="kg-callout kg-callout-success" role="status">
      <span><strong>{{ $t('_common.success') }}</strong> {{ $t('troubleshooting.unpair_single_success') }}</span>
      <button class="kg-btn kg-btn-success kg-btn-sm kg-ml-auto" type="button" @click="applyMessage = false">
        {{ $t('_common.dismiss') }}
      </button>
    </div>
    <div v-if="unpairAllStatus === true" class="kg-callout kg-callout-success" role="status">
      {{ $t('troubleshooting.unpair_all_success') }}
    </div>
    <div v-if="unpairAllStatus === false" class="kg-callout kg-callout-danger" role="alert">
      {{ $t('troubleshooting.unpair_all_error') }}
    </div>

    <div v-if="loading" class="kg-empty">
      <span class="kg-spinner kg-spinner-sm" aria-hidden="true"></span>
      <span>{{ $t('_common.loading') }}</span>
    </div>
    <div v-else-if="clients.length" class="kg-list">
      <div v-for="client in clients" :key="client.uuid" class="kg-list-row">
        <span class="kg-avatar" aria-hidden="true">
          <Users :size="15"></Users>
        </span>
        <div class="kg-grow">
          <p class="kg-title">{{ client.name || $t('troubleshooting.unpair_single_unknown') }}</p>
          <p class="kg-desc kg-mono kg-truncate">{{ client.uuid }}</p>
        </div>
        <div class="kg-right">
          <KgSwitch
            :model-value="client.enabled"
            :label="$t('pin.enable_client')"
            :disabled="busyClient === client.uuid"
            @update:model-value="value => toggleClient(client.uuid, value)"
          />
          <button
            class="kg-btn kg-btn-danger kg-btn-sm"
            type="button"
            :aria-label="$t('pin.unpair_client')"
            :title="$t('pin.unpair_client')"
            :disabled="busyClient === client.uuid"
            @click="unpairSingle(client.uuid)"
          >
            <Trash2 :size="14" class="kg-icon" aria-hidden="true"></Trash2>
          </button>
        </div>
      </div>
    </div>
    <div v-else class="kg-empty">
      <Users :size="22" aria-hidden="true"></Users>
      <em>{{ $t(emptyKey) }}</em>
    </div>
  </section>
</template>
