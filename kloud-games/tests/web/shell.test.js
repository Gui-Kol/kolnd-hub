import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import AppShell from '../../src_assets/common/assets/web/components/AppShell.vue'
import { hostMeta, publishHostMeta } from '../../src_assets/common/assets/web/components/host-meta'
import KgToastHost from '../../src_assets/common/assets/web/components/ui/KgToastHost.vue'
import { notifyKey, state } from '../../src_assets/common/assets/web/Notification.vue'

const stubs = {
  RouterLink: { template: '<a><slot /></a>', props: ['to'] },
  ThemeMenu: true,
  UserMenu: true,
}

function mountShell() {
  vi.stubGlobal('fetch', vi.fn())
  return mount(AppShell, {
    global: {
      mocks: { $t: key => key },
      stubs,
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  state.notifications.splice(0)
})

describe('application shell', () => {
  it('renders the five primary navigation links and the skip link', () => {
    const wrapper = mountShell()
    const links = wrapper.findAll('.kg-navlink')
    expect(links).toHaveLength(5)
    expect(links.map(link => link.text())).toEqual([
      'navbar.home',
      'navbar.applications',
      'navbar.pin',
      'navbar.configuration',
      'navbar.troubleshoot',
    ])
    expect(wrapper.get('.kg-skip-link').attributes('href')).toBe('#content')
    wrapper.unmount()
  })

  it('marks the active route with aria-current', async () => {
    const wrapper = mountShell()
    wrapper.vm.activePath = '/config'
    await wrapper.vm.$nextTick()
    const current = wrapper.findAll('.kg-navlink').filter(link => link.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0].text()).toBe('navbar.configuration')
    wrapper.unmount()
  })

  it('does not perform any request from the shell', () => {
    const wrapper = mountShell()
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('closes the mobile navigation with Escape', async () => {
    const wrapper = mountShell()
    wrapper.vm.navOpen = true
    await wrapper.vm.$nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.navOpen).toBe(false)
    wrapper.unmount()
  })

  it('only offers the topbar search on pages that have one', async () => {
    const wrapper = mountShell()
    expect(wrapper.find('.kg-topbar-right button[aria-label="_common.search"]').exists()).toBe(false)
    wrapper.vm.activePath = '/apps'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.kg-topbar-right button[aria-label="_common.search"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the host version only after a page published it, without fetching', async () => {
    hostMeta.version = ''
    hostMeta.name = ''
    const wrapper = mountShell()
    expect(wrapper.text()).not.toContain('v2026')
    expect(fetch).not.toHaveBeenCalled()

    publishHostMeta({ version: '2026.927.1200', KLOUD_GAMES_name: 'KOLND-STREAM' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('v2026.927.1200')
    expect(wrapper.text()).toContain('KOLND-STREAM')
    expect(fetch).not.toHaveBeenCalled()

    hostMeta.version = ''
    hostMeta.name = ''
    wrapper.unmount()
  })
})

describe('global toasts', () => {
  it('renders notifications pushed through notifyKey and dismisses them', async () => {
    notifyKey.error('_common.csrf_error_desc', '_common.csrf_error')
    const wrapper = mount(KgToastHost, {
      global: { mocks: { $t: key => key } },
    })

    expect(wrapper.findAll('.kg-toast')).toHaveLength(1)
    expect(wrapper.text()).toContain('_common.csrf_error')
    expect(wrapper.text()).toContain('_common.csrf_error_desc')

    await wrapper.get('.kg-toast button').trigger('click')
    expect(state.notifications).toHaveLength(0)
    wrapper.unmount()
  })

  it('uses role=status so screen readers announce new messages', () => {
    notifyKey.info('_common.loading')
    const wrapper = mount(KgToastHost, {
      global: { mocks: { $t: key => key } },
    })
    expect(wrapper.get('.kg-toast').attributes('role')).toBe('status')
    expect(wrapper.get('.kg-toast-host').attributes('aria-live')).toBe('polite')
    wrapper.unmount()
  })
})
