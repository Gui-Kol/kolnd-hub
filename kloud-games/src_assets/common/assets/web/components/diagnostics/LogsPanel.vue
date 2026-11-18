<script>
import { Check, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Copy, Search } from '@lucide/vue'
import { filterLogText, navigableEntryIndices, parseLogEntries } from './log-utils'

/**
 * @file LogsPanel.vue
 * @brief Logs do host com filtro, navegacao e copia — renderizacao 100% textual.
 *
 * Cada linha e renderizada com `v-for`/texto (nunca `v-html`), portanto tags
 * vindas do log aparecem escapadas pelo proprio Vue.
 */
export default {
  name: 'LogsPanel',
  components: { Check, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Copy, Search },
  props: {
    text: { type: String, default: '' },
    titleId: { type: String, default: 'logs' },
  },
  data() {
    return {
      filter: '',
      copied: false,
      currentIndex: -1,
      copyTimer: null,
    }
  },
  computed: {
    /** @return {Array<object>} Parsed entries for the filtered text. */
    entries() {
      return parseLogEntries(filterLogText(this.text, this.filter))
    },
    /** @return {number[]} Warning/error/fatal entry indices. */
    errorIndices() {
      return navigableEntryIndices(this.entries)
    },
    hasNext() {
      if (!this.errorIndices.length) return false
      if (this.currentIndex === -1) return true
      return this.errorIndices.some(index => index > this.currentIndex)
    },
    hasPrev() {
      if (this.currentIndex === -1) return false
      return this.errorIndices.some(index => index < this.currentIndex)
    },
    /** @return {string} Text copied by the copy action (filtered view). */
    copyText() {
      return filterLogText(this.text, this.filter)
    },
  },
  watch: {
    filter() {
      this.currentIndex = -1
    },
  },
  beforeUnmount() {
    if (this.copyTimer) clearTimeout(this.copyTimer)
  },
  methods: {
    /**
     * @brief Move to the previous/next warning, error or fatal entry.
     *
     * @param {'prev'|'next'} direction Navigation direction.
     * @return {void}
     */
    navigate(direction) {
      const indices = this.errorIndices
      if (!indices.length) return
      let target = null
      if (direction === 'next') {
        target = this.currentIndex === -1 ? indices[0] : indices.find(index => index > this.currentIndex) ?? null
      } else if (this.currentIndex !== -1) {
        target = [...indices].reverse().find(index => index < this.currentIndex) ?? null
      }
      if (target === null) return
      this.currentIndex = target
      this.$nextTick(() => {
        const line = this.$refs.terminal?.querySelector(`[data-entry-index="${target}"]`)
        line?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
      })
    },
    /**
     * @brief Scroll the log container to the top or bottom.
     *
     * @param {'top'|'bottom'} where Target position.
     * @return {void}
     */
    scrollTo(where) {
      this.currentIndex = -1
      const container = this.$refs.terminal
      if (!container) return
      container.scrollTo?.({
        top: where === 'top' ? 0 : container.scrollHeight,
        behavior: 'smooth',
      })
    },
    /**
     * @brief Copy the filtered log text and show feedback for two seconds.
     *
     * @return {Promise<void>} Completion of the clipboard write.
     */
    async copy() {
      try {
        await navigator.clipboard.writeText(this.copyText)
        this.copied = true
        if (this.copyTimer) clearTimeout(this.copyTimer)
        this.copyTimer = setTimeout(() => {
          this.copied = false
        }, 2000)
      } catch (error) {
        console.error('Failed to copy logs:', error)
      }
    },
  },
}
</script>

<template>
  <section class="kg-card" :aria-labelledby="titleId">
    <div class="kg-card-head">
      <h2 :id="titleId">{{ $t('troubleshooting.logs') }}</h2>
      <div class="kg-search-field" style="max-width: 280px">
        <Search :size="15" aria-hidden="true"></Search>
        <label for="log-filter" class="kg-visually-hidden">{{ $t('troubleshooting.logs_find') }}</label>
        <input
          id="log-filter"
          v-model="filter"
          class="kg-input"
          type="search"
          :placeholder="$t('troubleshooting.logs_find')"
        />
      </div>
    </div>
    <div class="kg-card-pad kg-stack-2">
      <p class="kg-help">{{ $t('troubleshooting.logs_desc') }}</p>
      <div class="kg-terminal-toolbar">
        <div class="kg-log-nav">
          <button class="kg-iconbtn kg-iconbtn-bordered" type="button" :title="$t('troubleshooting.logs_jump_top')" :aria-label="$t('troubleshooting.logs_jump_top')" @click="scrollTo('top')">
            <ChevronsUp :size="16" class="kg-icon" aria-hidden="true"></ChevronsUp>
          </button>
          <button class="kg-iconbtn kg-iconbtn-bordered" type="button" :title="$t('troubleshooting.logs_prev')" :aria-label="$t('troubleshooting.logs_prev')" :disabled="!hasPrev" @click="navigate('prev')">
            <ChevronUp :size="16" class="kg-icon" aria-hidden="true"></ChevronUp>
          </button>
          <button class="kg-iconbtn kg-iconbtn-bordered" type="button" :title="$t('troubleshooting.logs_next')" :aria-label="$t('troubleshooting.logs_next')" :disabled="!hasNext" @click="navigate('next')">
            <ChevronDown :size="16" class="kg-icon" aria-hidden="true"></ChevronDown>
          </button>
          <button class="kg-iconbtn kg-iconbtn-bordered" type="button" :title="$t('troubleshooting.logs_jump_bottom')" :aria-label="$t('troubleshooting.logs_jump_bottom')" @click="scrollTo('bottom')">
            <ChevronsDown :size="16" class="kg-icon" aria-hidden="true"></ChevronsDown>
          </button>
          <button class="kg-iconbtn kg-iconbtn-bordered" type="button" :title="$t('troubleshooting.logs_copy')" :aria-label="$t('troubleshooting.logs_copy')" @click="copy">
            <Check v-if="copied" :size="16" class="kg-icon kg-text-success" aria-hidden="true"></Check>
            <Copy v-else :size="16" class="kg-icon" aria-hidden="true"></Copy>
          </button>
        </div>
        <span class="kg-help" aria-live="polite">{{ copied ? $t('troubleshooting.logs_copied') : '' }}</span>
      </div>
      <div ref="terminal" class="kg-terminal">
        <p v-if="!entries.length" class="kg-subtle">{{ $t('troubleshooting.logs_empty') }}</p>
        <div
          v-for="entry in entries"
          :key="entry.index"
          class="kg-terminal-line"
          :class="[entry.levelClass, { 'kg-log-selected': entry.index === currentIndex }]"
          :data-entry-index="entry.index"
        >
          <span v-if="entry.timestamp" class="kg-ts">{{ entry.timestamp }}</span>
          <span class="kg-lvl">{{ entry.level }}</span>
          <span class="kg-msg">{{ entry.message }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
