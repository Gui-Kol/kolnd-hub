<script>
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { AlertCircle, CheckCircle, Download, Package } from '@lucide/vue'

/**
 * @file VersionCard.vue
 * @brief Cartao de versao, atualizacoes e release notes sanitizadas.
 */
export default {
  name: 'VersionCard',
  components: { AlertCircle, CheckCircle, Download, Package },
  props: {
    version: { type: String, default: '' },
    githubVersion: { type: Object, default: null },
    preReleaseVersion: { type: Object, default: null },
    notifyPreReleases: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    dirty: { type: Boolean, default: false },
    notStable: { type: Boolean, default: false },
    stableAvailable: { type: Boolean, default: false },
    preReleaseAvailable: { type: Boolean, default: false },
  },
  methods: {
    /**
     * @brief Render sanitized markdown for release notes.
     *
     * @param {string} markdown Release body from GitHub.
     * @return {string} Sanitized HTML.
     */
    releaseNotes(markdown) {
      if (!markdown) return ''
      return DOMPurify.sanitize(marked.parse(markdown, { gfm: true, breaks: true }))
    },
  },
}
</script>

<template>
  <section class="kg-card" aria-labelledby="home-version-title">
    <div class="kg-card-head">
      <h2 id="home-version-title">{{ $t('index.version_title') }}</h2>
      <span v-if="version" class="kg-count-chip">{{ $t('index.installed_version') }} {{ version }}</span>
    </div>
    <div class="kg-card-pad kg-stack-3">
      <p v-if="loading" class="kg-muted kg-row">
        <span class="kg-spinner kg-spinner-sm" aria-hidden="true"></span>
        {{ $t('index.loading_latest') }}
      </p>

      <div v-if="dirty" class="kg-callout kg-callout-success" role="status">
        <Package :size="16" class="kg-icon" aria-hidden="true"></Package>
        <span>{{ $t('index.version_dirty') }}</span>
      </div>

      <div v-if="notStable" class="kg-callout kg-callout-info" role="status">
        <AlertCircle :size="16" class="kg-icon" aria-hidden="true"></AlertCircle>
        <span>{{ $t('index.installed_version_not_stable') }}</span>
      </div>
      <div
        v-else-if="(!preReleaseAvailable || !notifyPreReleases) && !stableAvailable && !dirty"
        class="kg-callout kg-callout-success"
        role="status"
      >
        <CheckCircle :size="16" class="kg-icon" aria-hidden="true"></CheckCircle>
        <span>{{ $t('index.version_latest') }}</span>
      </div>

      <article v-if="notifyPreReleases && preReleaseAvailable" class="kg-callout kg-callout-warning">
        <AlertCircle :size="16" class="kg-icon" aria-hidden="true"></AlertCircle>
        <div class="kg-grow">
          <div class="kg-between kg-row-wrap">
            <span>
              {{ $t('index.new_pre_release') }}
              <strong>{{ preReleaseVersion.release.name }}</strong>
            </span>
            <a class="kg-btn kg-btn-success kg-btn-sm" :href="preReleaseVersion.release.html_url" target="_blank" rel="noopener noreferrer">
              <Download :size="14" class="kg-icon" aria-hidden="true"></Download>
              {{ $t('index.download') }}
            </a>
          </div>
          <details class="kg-mt-2">
            <summary class="kg-muted">{{ $t('index.release_notes') }}</summary>
            <div class="kg-markdown kg-mt-2" v-html="releaseNotes(preReleaseVersion.release.body)"></div>
          </details>
        </div>
      </article>

      <article v-if="stableAvailable" class="kg-callout kg-callout-warning">
        <AlertCircle :size="16" class="kg-icon" aria-hidden="true"></AlertCircle>
        <div class="kg-grow">
          <div class="kg-between kg-row-wrap">
            <span>
              {{ $t('index.new_stable') }}
              <strong>{{ githubVersion.release.name }}</strong>
            </span>
            <a class="kg-btn kg-btn-success kg-btn-sm" :href="githubVersion.release.html_url" target="_blank" rel="noopener noreferrer">
              <Download :size="14" class="kg-icon" aria-hidden="true"></Download>
              {{ $t('index.download') }}
            </a>
          </div>
          <details class="kg-mt-2">
            <summary class="kg-muted">{{ $t('index.release_notes') }}</summary>
            <div class="kg-markdown kg-mt-2" v-html="releaseNotes(githubVersion.release.body)"></div>
          </details>
        </div>
      </article>
    </div>
  </section>
</template>
