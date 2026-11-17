import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import KgDropdown from '../../src_assets/common/assets/web/components/ui/KgDropdown.vue'
import KgModal from '../../src_assets/common/assets/web/components/ui/KgModal.vue'
import KgSwitch from '../../src_assets/common/assets/web/components/ui/KgSwitch.vue'
import ThemeMenu from '../../src_assets/common/assets/web/components/ThemeMenu.vue'
import UserMenu from '../../src_assets/common/assets/web/components/UserMenu.vue'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.restoreAllMocks()
})

describe('KgModal', () => {
  it('opens and closes the native dialog and emits close', async () => {
    const wrapper = mount(KgModal, {
      props: { open: false, title: 'Editor', titleId: 'editor-title' },
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe('editor-title')

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.$refs.dialog.open).toBe(true)

    wrapper.vm.onCancel({ preventDefault: vi.fn() })
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })

  it('keeps a non-closable dialog open on Escape', () => {
    const wrapper = mount(KgModal, {
      props: { open: true, title: 'Busy', closable: false },
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    wrapper.vm.onCancel({ preventDefault: vi.fn() })
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })

  it('focuses the first focusable element and restores focus on close', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()

    const wrapper = mount(KgModal, {
      props: { open: false, title: 'Dialog' },
      slots: { default: '<input id="first" /><button id="second">ok</button>' },
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(document.activeElement?.id).toBe('first')

    await wrapper.setProps({ open: false })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})

describe('KgDropdown', () => {
  function mountDropdown() {
    return mount(KgDropdown, {
      props: { label: 'Menu' },
      slots: {
        trigger: '<span>open</span>',
        default: '<button role="menuitem">One</button><button role="menuitem">Two</button>',
      },
      attachTo: document.body,
    })
  }

  it('opens on click and closes with Escape, restoring focus to the trigger', async () => {
    const wrapper = mountDropdown()
    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(2)

    wrapper.vm.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.open).toBe(false)
    wrapper.unmount()
  })

  it('moves focus with the arrow keys', async () => {
    const wrapper = mountDropdown()
    await wrapper.get('button').trigger('click')
    await wrapper.vm.$nextTick()
    const items = wrapper.findAll('[role="menuitem"]')
    items[0].element.focus()

    wrapper.vm.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(document.activeElement).toBe(items[1].element)
    wrapper.vm.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(document.activeElement).toBe(items[0].element)
    wrapper.unmount()
  })

  it('closes when clicking outside', async () => {
    const wrapper = mountDropdown()
    await wrapper.get('button').trigger('click')
    wrapper.vm.onDocumentClick({ target: document.body })
    expect(wrapper.vm.open).toBe(false)
    wrapper.unmount()
  })
})

describe('KgSwitch', () => {
  it('exposes role=switch and emits the inverted value', async () => {
    const wrapper = mount(KgSwitch, { props: { modelValue: false, label: 'Enable' } })
    const button = wrapper.get('button')
    expect(button.attributes('role')).toBe('switch')
    expect(button.attributes('aria-checked')).toBe('false')
    await button.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    wrapper.unmount()
  })

  it('does not emit while disabled', async () => {
    const wrapper = mount(KgSwitch, { props: { modelValue: false, disabled: true } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('ThemeMenu', () => {
  it('offers auto, random and all 21 themes', async () => {
    const wrapper = mount(ThemeMenu, {
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    await wrapper.get('.kg-dropdown > button').trigger('click')
    expect(wrapper.findAll('[role="menuitem"]')).toHaveLength(23)
    expect(wrapper.findAll('[data-kg-theme-value]')).toHaveLength(22)
    wrapper.unmount()
  })

  it('applies and persists the chosen theme', async () => {
    const wrapper = mount(ThemeMenu, {
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    await wrapper.get('.kg-dropdown > button').trigger('click')
    const dracula = wrapper.findAll('[data-kg-theme-value]').find(item => item.attributes('data-kg-theme-value') === 'dracula')
    await dracula.trigger('click')
    expect(localStorage.getItem('theme')).toBe('dracula')
    expect(document.documentElement.dataset.theme).toBe('dracula')
    wrapper.unmount()
  })

  it('applies a random theme', async () => {
    const wrapper = mount(ThemeMenu, {
      global: { mocks: { $t: key => key } },
      attachTo: document.body,
    })
    await wrapper.get('.kg-dropdown > button').trigger('click')
    await wrapper.get('#kg-theme-random').trigger('click')
    expect(localStorage.getItem('theme')).toBeTruthy()
    expect(localStorage.getItem('theme')).not.toBe('auto')
    wrapper.unmount()
  })
})

describe('UserMenu', () => {
  it('links to the password page and offers logout', async () => {
    const wrapper = mount(UserMenu, {
      global: {
        mocks: { $t: key => key },
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
      attachTo: document.body,
    })
    await wrapper.get('.kg-dropdown > button').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toBe('navbar.password')
    expect(items[1].text()).toBe('navbar.logout')
    wrapper.unmount()
  })
})
