<template>
  <NavbarSimple></NavbarSimple>
  <main id="content" class="kg-main kg-main--narrow" role="main">
    <div class="kg-page-head">
      <div>
        <h1>{{ $t('welcome.greeting') }}</h1>
        <p class="kg-sub">{{ $t('welcome.create_creds') }}</p>
      </div>
    </div>

    <div class="kg-grid kg-grid-2" style="align-items: start">
      <section class="kg-card" aria-labelledby="welcome-form-title">
        <div class="kg-card-head">
          <h2 id="welcome-form-title">{{ $t('welcome.create_creds') }}</h2>
        </div>
        <div class="kg-card-pad">
          <div class="kg-callout kg-callout-warning">
            {{ $t('welcome.create_creds_alert') }}
          </div>
          <form class="kg-stack-4 kg-mt-3" @submit.prevent="save">
            <div class="kg-field">
              <label for="usernameInput" class="kg-label">{{ $t('_common.username') }}</label>
              <input id="usernameInput" v-model="passwordData.newUsername" class="kg-input" type="text" autocomplete="username" />
            </div>
            <div class="kg-field">
              <label for="passwordInput" class="kg-label">{{ $t('_common.password') }}</label>
              <input required id="passwordInput" v-model="passwordData.newPassword" class="kg-input" type="password" autocomplete="new-password" />
            </div>
            <div class="kg-field">
              <label for="confirmPasswordInput" class="kg-label">{{ $t('welcome.confirm_password') }}</label>
              <input required id="confirmPasswordInput" v-model="passwordData.confirmNewPassword" class="kg-input" type="password" autocomplete="new-password" />
            </div>
            <button type="submit" class="kg-btn kg-btn-primary" :disabled="loading">
              <LogIn :size="16" class="kg-icon" aria-hidden="true"></LogIn>
              {{ $t('welcome.login') }}
            </button>
            <div v-if="error" class="kg-callout kg-callout-danger" role="alert">
              <strong>{{ $t('_common.error') }}</strong> {{ error }}
            </div>
            <div v-if="success" class="kg-callout kg-callout-success" role="status">
              <strong>{{ $t('_common.success') }}</strong> {{ $t('welcome.welcome_success') }}
            </div>
          </form>
        </div>
      </section>
      <ResourceCard />
    </div>
  </main>
</template>

<script>
  import ResourceCard from './ResourceCard.vue'
  import { apiFetch } from './fetch_utils'
  import NavbarSimple from './NavbarSimple.vue'
  import { LogIn } from '@lucide/vue'

  export default {
    components: {
      ResourceCard,
      NavbarSimple,
      LogIn,
    },
    data() {
      return {
        error: null,
        success: false,
        loading: false,
        passwordData: {
          newUsername: "KLOUD_GAMES",
          newPassword: "",
          confirmNewPassword: "",
        },
      };
    },
    methods: {
      /**
       * @brief Create credentials and reload after a successful response.
       *
       * @return {Promise<void>} Completion of the credential request and response processing.
       */
      async save() {
        this.error = null;
        this.loading = true;
        const response = await apiFetch("./api/password", {
          method: "POST",
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.passwordData),
        });
        this.loading = false;
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
