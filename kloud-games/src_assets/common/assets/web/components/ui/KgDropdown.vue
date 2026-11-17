<script>
/**
 * @file KgDropdown.vue
 * @brief Menu suspenso acessivel (teclado, clique fora, `Esc`).
 */
export default {
  name: 'KgDropdown',
  props: {
    label: { type: String, required: true },
    align: { type: String, default: 'right' },
  },
  emits: ['open', 'close'],
  data() {
    return { open: false }
  },
  methods: {
    /**
     * @brief Toggle the menu and move focus to the first item when opening.
     *
     * @return {void}
     */
    toggle() {
      this.open ? this.close() : this.show()
    },
    /** @brief Open the menu. @return {void} */
    show() {
      this.open = true
      this.$emit('open')
      this.$nextTick(() => {
        const first = this.$refs.menu?.querySelector('[role="menuitem"], button, a')
        if (first) first.focus()
      })
    },
    /** @brief Close the menu and return focus to the trigger. @return {void} */
    close({ restoreFocus = true } = {}) {
      if (!this.open) return
      this.open = false
      this.$emit('close')
      if (restoreFocus) this.$refs.trigger?.focus()
    },
    /**
     * @brief Handle keyboard navigation inside the menu.
     *
     * @param {KeyboardEvent} event Key event.
     * @return {void}
     */
    onKeydown(event) {
      const items = Array.from(this.$refs.menu?.querySelectorAll('[role="menuitem"]:not([disabled])') || [])
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.close()
        return
      }
      if (!items.length) return
      const index = items.indexOf(document.activeElement)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[(index + 1) % items.length].focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        items[(index - 1 + items.length) % items.length].focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        items[0].focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        items[items.length - 1].focus()
      } else if (event.key === 'Tab') {
        this.close({ restoreFocus: false })
      }
    },
    /**
     * @brief Close when clicking outside the component.
     *
     * @param {MouseEvent} event Click event.
     * @return {void}
     */
    onDocumentClick(event) {
      if (this.open && !this.$el.contains(event.target)) this.close({ restoreFocus: false })
    },
  },
  mounted() {
    document.addEventListener('click', this.onDocumentClick)
  },
  beforeUnmount() {
    document.removeEventListener('click', this.onDocumentClick)
  },
}
</script>

<template>
  <div class="kg-dropdown">
    <button
      ref="trigger"
      type="button"
      class="kg-iconbtn"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
      @keydown.down.prevent="show"
    >
      <slot name="trigger"></slot>
    </button>
    <div
      v-if="open"
      ref="menu"
      class="kg-dropdown-menu"
      :class="align === 'left' ? 'kg-dropdown-menu-left' : ''"
      role="menu"
      :aria-label="label"
      @keydown="onKeydown"
    >
      <slot :close="close"></slot>
    </div>
  </div>
</template>
