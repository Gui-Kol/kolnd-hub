import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src_assets/common/assets/web/ResourceCard.vue', () => ({
  default: { template: '<div />' },
}))

import Home from '../../src_assets/common/assets/web/Home.vue'

async function mountHome(platform, { developmentVersion = true, licensed = true, serviceAvailable = true, gamepadDriver = 'virtualhid', permissions = [], logs = '' } = {}) {
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === './api/config') {
      return { json: async () => ({ platform, controller: 'enabled', gamepad_driver: gamepadDriver, version: '2026.927.1200', port: 47989, encoder: 'nvenc', upnp: 'enabled' }) }
    }
    if (url === './api/clients/list') {
      return { json: async () => ({ status: true, named_certs: [{ name: 'TV', uuid: 'u1', enabled: true }] }) }
    }
    if (url === './api/virtual-input/status') {
      return {
        json: async () => ({
          virtualhid: { installed: true, development_version: developmentVersion, version_compatible: true },
          vigembus: { installed: false, version_compatible: false },
        }),
      }
    }
    if (url === './api/permissions') {
      return { json: async () => ({ permissions }) }
    }
    if (url === './api/virtual-input/license') {
      return { json: async () => ({ licensed, service_available: serviceAvailable }) }
    }
    if (url === './api/logs') {
      return { text: async () => logs }
    }
    if (url === 'https://api.github.com/repos/KLOUD_GAMESStream/KLOUD_GAMES/releases/latest') {
      return { json: async () => ({ tag_name: 'v2026.927.1200' }) }
    }
    if (url === 'https://api.github.com/repos/KLOUD_GAMESStream/KLOUD_GAMES/releases') {
      return { json: async () => [{ tag_name: 'v2026.927.1200', prerelease: true }] }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }))

  const wrapper = mount(Home, {
    global: {
      mocks: { $t: key => key },
      stubs: { RouterLink: true },
    },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('development broker home notice', () => {
  it('links to permission controls when macOS is missing required access', async () => {
    const wrapper = await mountHome('macos', { permissions: [
      { id: 'screen_recording', status: 'denied', required: true, verifiable: true },
      { id: 'notifications', status: 'denied', required: false, verifiable: true },
      { id: 'local_network', status: 'on_use', required: true, verifiable: false },
    ] })
    expect(wrapper.text()).toContain('index.permissions_missing_title')
    expect(wrapper.findAll('[data-notice="permissions"] a, [data-notice="permissions"] router-link-stub').length).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('links to permission guidance when Windows cannot access its config directory', async () => {
    const wrapper = await mountHome('windows', { permissions: [
      { id: 'config_directory', status: 'denied', required: true, verifiable: true },
    ] })
    expect(wrapper.text()).toContain('index.permissions_missing_title')
    wrapper.unmount()
  })

  it.each(['windows', 'macos'])('shows the development card on %s', async platform => {
    const wrapper = await mountHome(platform)

    expect(fetch).toHaveBeenCalledWith('./api/virtual-input/status')
    expect(wrapper.get('[data-notice="virtual-input"]').text()).toContain('index.virtualhid_development_title')
    expect(wrapper.get('[data-notice="virtual-input"]').text()).toContain('index.virtualhid_development_desc')
    wrapper.unmount()
  })

  it('prioritizes a macOS license warning over the development card', async () => {
    const wrapper = await mountHome('macos', { licensed: false })

    expect(wrapper.get('[data-notice="virtual-input"]').text()).toContain('index.virtualhid_macos_license_title')
    expect(wrapper.get('[data-notice="virtual-input"]').text()).not.toContain('index.virtualhid_development_title')
    wrapper.unmount()
  })

  it('shows the macOS broker warning when the license service is unavailable', async () => {
    const wrapper = await mountHome('macos', { licensed: false, serviceAvailable: false })

    expect(wrapper.get('[data-notice="virtual-input"]').text()).toContain('index.virtualhid_broker_unavailable_title')
    expect(wrapper.get('[data-notice="virtual-input"]').text()).not.toContain('index.virtualhid_development_title')
    wrapper.unmount()
  })

  it('does not show a development card for a stable macOS broker', async () => {
    const wrapper = await mountHome('macos', { developmentVersion: false })

    expect(wrapper.find('[data-notice="virtual-input"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not show a broker card when gamepads are disabled', async () => {
    const wrapper = await mountHome('macos', { gamepadDriver: 'none' })

    expect(wrapper.find('[data-notice="virtual-input"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('host overview', () => {
  it('renders real host data instead of invented metrics', async () => {
    const wrapper = await mountHome('windows')

    expect(wrapper.text()).toContain('index.config_loaded')
    expect(wrapper.text()).toContain('2026.927.1200')
    expect(wrapper.text()).toContain('index.clients_paired')
    expect(wrapper.text()).not.toContain('index.session')
    expect(wrapper.text()).not.toContain('index.latency')
    wrapper.unmount()
  })

  it('shows the last log entries as recent activity', async () => {
    const wrapper = await mountHome('windows', {
      logs: '[2026-11-17 15:59:01.001]: Info: started\n[2026-11-17 15:59:03.210]: Warning: license missing\n[2026-11-17 15:59:05.000]: Fatal: port busy\n',
    })

    expect(wrapper.get('[data-notice="fatal"]').text()).toContain('port busy')
    expect(wrapper.text()).toContain('license missing')
    wrapper.unmount()
  })
})
