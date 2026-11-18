import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildOptionIndex, filterOptions } from '../../src_assets/common/assets/web/components/config/config-search'
import Config from '../../src_assets/common/assets/web/Config.vue'
import configFixture from '../fixtures/web/config.json'

const tabs = [
  {
    id: 'input',
    nameKey: 'config.category_input',
    options: { gamepad_driver: 'virtualhid', keyboard: 'enabled' },
  },
  {
    id: 'network',
    nameKey: 'config.category_network',
    options: { port: 47989, upnp: 'enabled' },
  },
]

const stubs = {
  AppShell: { template: '<div><slot /></div>' },
  General: { template: '<div id="locale-wrapper"><input id="locale" /></div>' },
  Inputs: { template: '<div><select id="gamepad_driver"></select></div>' },
  AudioVideo: { template: '<div />' },
  Network: { template: '<div><input id="port" /></div>' },
  Files: { template: '<div />' },
  Advanced: { template: '<div />' },
  ContainerEncoders: { template: '<div />' },
  RouterLink: true,
}

async function mountConfig({ hash = '' } = {}) {
  window.history.replaceState({}, '', `/${hash}`)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => structuredClone(configFixture),
  })))
  const wrapper = mount(Config, {
    global: {
      mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) },
      stubs,
    },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

describe('configuration option search', () => {
  it('indexes every option with its tab', () => {
    const index = buildOptionIndex(tabs, key => key)
    expect(index).toHaveLength(4)
    expect(index.find(option => option.key === 'port')).toMatchObject({ tabId: 'network', tab: 'config.category_network' })
  })

  it('filters by option key and label', () => {
    const index = buildOptionIndex(tabs, key => key)
    expect(filterOptions(index, 'gamepad').map(option => option.key)).toEqual(['gamepad_driver'])
    expect(filterOptions(index, 'PORT').map(option => option.key)).toEqual(['port'])
    expect(filterOptions(index, '')).toEqual([])
  })

  it('switches to the tab of the first match without touching global styles', async () => {
    const wrapper = await mountConfig()
    wrapper.vm.searchQuery = 'gamepad_driver'
    wrapper.vm.handleSearch()
    expect(wrapper.vm.currentTab).toBe('input')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.searchResults).toHaveLength(1)
    wrapper.unmount()
  })

  it('reports no results for unknown options', async () => {
    const wrapper = await mountConfig()
    wrapper.vm.searchQuery = 'does-not-exist'
    expect(wrapper.vm.searchResults).toEqual([])
    wrapper.unmount()
  })
})

describe('configuration dirty state', () => {
  it('tracks changes against the loaded snapshot and discards them', async () => {
    const wrapper = await mountConfig()
    expect(wrapper.vm.dirtyCount).toBe(0)

    wrapper.vm.config.locale = 'de'
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.dirtyCount).toBe(1)
    expect(wrapper.text()).toContain('config.unsaved_changes')

    wrapper.vm.discard()
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.config.locale).toBe(configFixture.locale)
    expect(wrapper.vm.dirtyCount).toBe(0)
    wrapper.unmount()
  })

  it('omits values equal to their defaults when saving', async () => {
    const wrapper = await mountConfig()
    const payload = wrapper.vm.buildPayload()
    // Values equal to the documented defaults are not sent back to the host.
    expect(payload).not.toHaveProperty('audio_sink')
    expect(payload).not.toHaveProperty('port')

    wrapper.vm.config.port = 50000
    expect(wrapper.vm.buildPayload()).toHaveProperty('port', 50000)
    wrapper.unmount()
  })
})

describe('configuration deep links', () => {
  it('opens the tab for a #<tabId> link', async () => {
    const wrapper = await mountConfig({ hash: '#network' })
    expect(wrapper.vm.currentTab).toBe('network')
    wrapper.unmount()
  })

  it('opens the Input tab for #gamepad_driver (link from the home notice)', async () => {
    const wrapper = await mountConfig({ hash: '#gamepad_driver' })
    expect(wrapper.vm.currentTab).toBe('input')
    wrapper.unmount()
  })
})
