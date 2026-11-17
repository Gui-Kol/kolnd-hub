<template>
  <AppShell>
    <div class="kg-page-head">
      <div>
        <h1>{{ $t('password.password_change') }}</h1>
        <p class="kg-sub">{{ $t('password.password_change_desc') }}</p>
      </div>
    </div>
    <form class="kg-stack-4" @submit.prevent="save">
      <div class="kg-grid kg-grid-2">
        <section class="kg-card" aria-labelledby="current-creds-title">
          <div class="kg-card-head">
            <h2 id="current-creds-title">{{ $t('password.current_creds') }}</h2>
          </div>
          <div class="kg-card-pad kg-stack-4">
            <div class="kg-field">
              <label for="currentUsername" class="kg-label">{{ $t('_common.username') }}</label>
              <input required id="currentUsername" v-model="passwordData.currentUsername" class="kg-input" type="text" autocomplete="username" />
            </div>
            <div class="kg-field">
              <label for="currentPassword" class="kg-label">{{ $t('_common.password') }}</label>
              <input id="currentPassword" v-model="passwordData.currentPassword" class="kg-input" type="password" autocomplete="current-password" />
            </div>
          </div>
        </section>

        <section class="kg-card" aria-labelledby="new-creds-title">
          <div class="kg-card-head">
            <h2 id="new-creds-title">{{ $t('password.new_creds') }}</h2>
          </div>
          <div class="kg-card-pad kg-stack-4">
            <div class="kg-field">
              <label for="newUsername" class="kg-label">{{ $t('_common.username') }}</label>
              <input id="newUsername" v-model="passwordData.newUsername" class="kg-input" type="text" autocomplete="username" />
              <p class="kg-help">{{ $t('password.new_username_desc') }}</p>
            </div>
            <div class="kg-field">
              <label for="newPassword" class="kg-label">{{ $t('_common.password') }}</label>
              <input required id="newPassword" v-model="passwordData.newPassword" class="kg-input" type="password" autocomplete="new-password" />
            </div>
            <div class="kg-field">
              <label for="confirmNewPassword" class="kg-label">{{ $t('password.confirm_password') }}</label>
              <input required id="confirmNewPassword" v-model="passwordData.confirmNewPassword" class="kg-input" type="password" autocomplete="new-password" />
            </div>
          </div>
        </section>
      </div>

      <div v-if="error" class="kg-callout kg-callout-danger" role="alert">
        <strong>{{ $t('_common.error') }}</strong> {{ error }}
      </div>
      <div v-if="success" class="kg-callout kg-callout-success" role="status">
        <strong>{{ $t('_common.success') }}</strong> {{ $t('password.success_msg') }}
      </div>

      <div>
        <button type="submit" class="kg-btn kg-btn-primary">
          <Save :size="16" class="kg-icon" aria-hidden="true"></Save>
          {{ $t('_common.save') }}
        </button>
      </div>
    </form>
  </AppShell>
</template>

<script>
  import AppShell from './components/AppShell.vue'
  import { apiFetch } from './fetch_utils'
  import { Save } from '@lucide/vue'

  export default {
    components: {
      AppShell,
      Save,
    },
    data() {
      return {
        error: null,
        success: false,
        passwordData: {
          currentUsername: "",
          currentPassword: "",
          newUsername: "",
          newPassword: "",
          confirmNewPassword: "",
        },
      };
    },
    methods: {
      /**
       * @brief Update credentials and reload after a successful response.
       *
       * @return {Promise<void>} Completion of the credential request and response processing.
       */
      async save() {
        this.error = null;
        const response = await apiFetch("./api/password", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.passwordData),
        });
        if (response.status !== 200) {
          this.error = "Internal Server Error";
          return;
        }

        const result = await response.json();
        this.success = result.status;
        if (this.success === true) {
          setTimeout(() => {
            document.location.reload();
          }, 5000);
        } else {
          this.error = result.error;
        }
      },
    },
  }
</script>
