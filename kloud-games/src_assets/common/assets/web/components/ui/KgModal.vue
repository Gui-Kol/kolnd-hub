<script>
/**
 * @file KgModal.vue
 * @brief Modal acessivel baseado em `<dialog>` nativo, com empilhamento.
 *
 * O `<dialog>` fornece focus trap, `Esc` e `aria-modal`; este componente
 * adiciona restauracao de foco, travamento de scroll e z-index incremental
 * para modais sobrepostos (editor > file browser / cover finder).
 */
let openModals = 0

export default {
  name: 'KgModal',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
    titleId: { type: String, default: '' },
    size: { type: String, default: 'md' },
    closeLabel: { type: String, default: 'Close' },
    closable: { type: Boolean, default: true },
  },
  emits: ['close'],
  data() {
    return { zIndex: 0 }
  },
  computed: {
    dialogId() {
      return this.titleId || `kg-modal-title-${this._.uid}`
    },
    sizeClass() {
      return this.size === 'lg' ? 'kg-modal-lg' : this.size === 'sm' ? 'kg-modal-sm' : ''
    },
  },
  watch: {
    open(value) {
      if (value) {
        this.show()
      } else {
        this.hide()
      }
    },
  },
  mounted() {
    if (this.open) this.show()
  },
  beforeUnmount() {
    this.hide()
  },
  methods: {
    /**
     * @brief Open the native dialog and move focus into it.
     *
     * @return {void}
     */
    show() {
      const dialog = this.$refs.dialog
      if (!dialog || dialog.open) return
      this.$nextTick(() => {
        this.zIndex = 1000 + openModals * 20
        openModals += 1
        this._previousActive = document.activeElement
        if (typeof dialog.showModal === 'function') {
          dialog.showModal()
        } else {
          // jsdom older than the <dialog> API: keep the element visible.
          dialog.setAttribute('open', '')
        }
        const autofocus = dialog.querySelector('[data-autofocus]')
          || dialog.querySelector('.kg-modal-body input:not([type="hidden"]), .kg-modal-body select, .kg-modal-body textarea, .kg-modal-body button, .kg-modal-body a[href]')
          || dialog.querySelector('button, a[href]')
        if (autofocus) autofocus.focus()
      })
    },
    /**
     * @brief Close the native dialog and restore the previous focus target.
     *
     * @return {void}
     */
    hide() {
      const dialog = this.$refs.dialog
      if (dialog && (dialog.open || dialog.hasAttribute('open'))) {
        if (typeof dialog.close === 'function') {
          dialog.close()
        } else {
          dialog.removeAttribute('open')
        }
        openModals = Math.max(0, openModals - 1)
        const previous = this._previousActive
        this._previousActive = null
        if (previous && typeof previous.focus === 'function') previous.focus()
      }
    },
    /**
     * @brief Handle native cancel (Esc) without closing when not closable.
     *
     * @param {Event} event Native cancel event.
     * @return {void}
     */
    onCancel(event) {
      event.preventDefault()
      if (this.closable) this.requestClose()
    },
    /**
     * @brief Emit the close request consumed by the parent.
     *
     * @return {void}
     */
    requestClose() {
      this.$emit('close')
    },
  },
}
</script>

<template>
  <dialog
    ref="dialog"
    class="kg-modal"
    :class="sizeClass"
    :style="{ zIndex }"
    :aria-labelledby="dialogId"
    aria-modal="true"
    @cancel="onCancel"
    @close="requestClose"
    @click.self="closable && requestClose()"
  >
    <div class="kg-modal-header">
      <h2 :id="dialogId">
        <slot name="title">{{ title }}</slot>
      </h2>
      <button
        v-if="closable"
        type="button"
        class="kg-iconbtn"
        :aria-label="closeLabel"
        @click="requestClose"
      >
        <svg class="kg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div class="kg-modal-body">
      <slot></slot>
    </div>
    <div v-if="$slots.footer" class="kg-modal-footer">
      <slot name="footer"></slot>
    </div>
  </dialog>
</template>
