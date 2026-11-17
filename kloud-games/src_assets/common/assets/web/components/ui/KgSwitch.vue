<script>
/**
 * @file KgSwitch.vue
 * @brief Interruptor acessivel com `role="switch"`.
 */
export default {
  name: 'KgSwitch',
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: '' },
    small: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue'],
  methods: {
    /**
     * @brief Toggle the switch value.
     *
     * @return {void}
     */
    toggle() {
      if (this.disabled) return
      this.$emit('update:modelValue', !this.modelValue)
    },
  },
}
</script>

<template>
  <button
    type="button"
    class="kg-switch"
    :class="small ? 'kg-switch-sm' : ''"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="label || undefined"
    :disabled="disabled"
    @click="toggle"
  ></button>
</template>
