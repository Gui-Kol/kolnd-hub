import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LogsPanel from '../../src_assets/common/assets/web/components/diagnostics/LogsPanel.vue'
import Troubleshooting from '../../src_assets/common/assets/web/Troubleshooting.vue'
import logFixture from '../fixtures/web/logs.txt?raw'
import clientsFixture from '../fixtures/web/clients_list.json'

function mountLogs(text = logFixture) {
  return mount(LogsPanel, {
    props: { text },
    global: { mocks: { $t: key => key } },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('logs panel', () => {
  it('renders every parsed entry with its level and timestamp', () => {
    const wrapper = mountLogs()
    const lines = wrapper.findAll('.kg-terminal-line')
    expect(lines).toHaveLength(6)
    expect(lines[0].text()).toContain('Info')
    expect(lines[5].classes()).toContain('kg-log-fatal')
    wrapper.unmount()
  })

  it('never injects HTML from log content', () => {
    const payload = '[2026-01-01 00:00:00.000]: Error: <script>window.pwned = true</script>'
    const wrapper = mountLogs(payload)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.get('.kg-msg').text()).toContain('<script>window.pwned = true</script>')
    expect(window.pwned).toBeUndefined()
    wrapper.unmount()
  })

  it('filters entries by text', async () => {
    const wrapper = mountLogs()
    await wrapper.get('#log-filter').setValue('license')
    const lines = wrapper.findAll('.kg-terminal-line')
    expect(lines).toHaveLength(1)
    expect(lines[0].text()).toContain('license')
    wrapper.unmount()
  })

  it('navigates between warning and error entries', async () => {
    const wrapper = mountLogs()
    const buttons = wrapper.findAll('.kg-log-nav button')
    const prev = buttons[1]
    const next = buttons[2]
    expect(prev.attributes('disabled')).toBeDefined()

    await next.trigger('click')
    expect(wrapper.vm.currentIndex).toBe(3)
    expect(wrapper.get('[data-entry-index="3"]').classes()).toContain('kg-log-selected')

    await next.trigger('click')
    expect(wrapper.vm.currentIndex).toBe(4)
    await prev.trigger('click')
    expect(wrapper.vm.currentIndex).toBe(3)
    wrapper.unmount()
  })

  it('copies the filtered log text and shows feedback', async () => {
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const wrapper = mountLogs()
    await wrapper.get('#log-filter').setValue('Fatal')
    const copyButton = wrapper.findAll('.kg-log-nav button')[4]
    await copyButton.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Unable to bind'))
    expect(writeText.mock.calls[0][0]).not.toContain('license')
    expect(wrapper.text()).toContain('troubleshooting.logs_copied')
    wrapper.unmount()
  })

  it('shows an empty state', () => {
    const wrapper = mountLogs('')
    expect(wrapper.text()).toContain('troubleshooting.logs_empty')
    wrapper.unmount()
  })
})

describe('diagnostic actions', () => {
  async function mountTroubleshooting() {
    const fetchMock = vi.fn(async url => {
      if (url === '/api/config') return { ok: true, json: async () => ({ platform: 'windows', gamepad_driver: 'all' }) }
      if (url === './api/permissions') return { ok: true, json: async () => ({ permissions: [] }) }
      if (url === './api/logs') return { ok: true, text: async () => logFixture }
      if (url === './api/clients/list') return { ok: true, json: async () => structuredClone(clientsFixture) }
      return { ok: true, json: async () => ({ status: true, tag_name: 'v2026.914.1218' }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(Troubleshooting, {
      global: {
        mocks: { $t: key => key },
        stubs: { AppShell: { template: '<div><slot /></div>' }, RouterLink: true },
      },
    })
    await flushPromises()
    return { wrapper, fetchMock }
  }

  it('closes running applications with the existing endpoint', async () => {
    const { wrapper, fetchMock } = await mountTroubleshooting()
    const closeButton = wrapper.findAll('button').find(button => button.text() === 'troubleshooting.force_close')
    await closeButton.trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => url === './api/apps/close')).toBe(true)
    wrapper.unmount()
  })

  it('restarts the service with the existing endpoint', async () => {
    const { wrapper, fetchMock } = await mountTroubleshooting()
    const restart = wrapper.findAll('button').find(button => button.text() === 'troubleshooting.restart_KLOUD_GAMES')
    await restart.trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => url === './api/restart')).toBe(true)
    wrapper.unmount()
  })

  it('unpairs all clients from the shared panel', async () => {
    const { wrapper, fetchMock } = await mountTroubleshooting()
    const unpairAll = wrapper.findAll('button').find(button => button.text() === 'troubleshooting.unpair_all')
    await unpairAll.trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => url === './api/clients/unpair-all')).toBe(true)
    wrapper.unmount()
  })

  it('keeps the diagnostic anchors used by deep links', async () => {
    const { wrapper } = await mountTroubleshooting()
    for (const anchor of ['#permissions', '#virtualhid', '#close_apps', '#restart', '#dd_reset', '#unpair', '#logs']) {
      expect(wrapper.find(anchor).exists(), anchor).toBe(true)
    }
    wrapper.unmount()
  })
})
