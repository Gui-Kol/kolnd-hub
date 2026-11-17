import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import Apps from '../../src_assets/common/assets/web/Apps.vue'
import appsFixture from '../fixtures/web/apps.json'
import browseFixture from '../fixtures/web/browse.json'

function response(body) {
  return { ok: true, status: 200, json: async () => structuredClone(body) }
}

async function mountApps() {
  const fetchMock = vi.fn(async url => {
    if (url === './api/apps') return response(appsFixture)
    if (url === './api/config') return response({ platform: 'windows', version: '2026.927.1200' })
    if (url.startsWith('./api/browse')) return response(browseFixture)
    if (url.startsWith('https://api.github.com')) return response({ tag_name: 'v2026.927.1200' })
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = mount(Apps, {
    global: {
      mocks: { $t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key) },
      stubs: {
        AppShell: { template: '<div><slot /></div>' },
        RouterLink: true,
        Notification: true,
        'i18n-t': { props: ['keypath'], template: '<span><slot name="name" /></span>' },
      },
    },
  })
  await flushPromises()
  return { wrapper, fetchMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('applications page', () => {
  it('renders the app grid and the inspector for the selected app', async () => {
    const { wrapper } = await mountApps()
    expect(wrapper.findAll('.kg-app-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('Steam Big Picture')
    expect(wrapper.text()).toContain('apps.inspector_empty')

    await wrapper.findAll('.kg-app-card')[0].trigger('click')
    expect(wrapper.text()).toContain('apps.details')
    expect(wrapper.text()).toContain('C:\\Program Files (x86)\\Steam')
    wrapper.unmount()
  })

  it('filters by name and cycles the three sort states', async () => {
    const { wrapper } = await mountApps()
    await wrapper.get('#app-search').setValue('retro')
    expect(wrapper.findAll('.kg-app-card')).toHaveLength(1)

    await wrapper.get('#app-search').setValue('nothing')
    expect(wrapper.text()).toContain('apps.no_search_results')

    await wrapper.get('#app-search').setValue('')
    expect(wrapper.vm.sortMode).toBe('default')
    wrapper.vm.toggleSort()
    expect(wrapper.vm.sortMode).toBe('asc')
    wrapper.vm.toggleSort()
    expect(wrapper.vm.sortMode).toBe('desc')
    wrapper.vm.toggleSort()
    expect(wrapper.vm.sortMode).toBe('default')
    wrapper.unmount()
  })

  it('opens the editor with every field and the environment table', async () => {
    const { wrapper } = await mountApps()
    await wrapper.findAll('.kg-app-card')[0].findAll('button')[0].trigger('click')
    await flushPromises()

    expect(wrapper.vm.editModalOpen).toBe(true)
    for (const id of ['appName', 'appOutput', 'appCmd', 'appWorkingDir', 'exitTimeout', 'appImagePath']) {
      expect(wrapper.find(`#${id}`).exists(), id).toBe(true)
    }
    expect(wrapper.findAll('.kg-modal-body table tbody tr').length).toBeGreaterThanOrEqual(11)
    wrapper.unmount()
  })

  it('opens the delete dialog with focus on Cancel', async () => {
    const { wrapper } = await mountApps()
    const deleteButton = wrapper.findAll('.kg-app-card')[0].findAll('button')[1]
    await deleteButton.trigger('click')
    await flushPromises()

    expect(wrapper.vm.deleteModalOpen).toBe(true)
    expect(wrapper.text()).toContain('Steam Big Picture')
    expect(wrapper.text()).toContain('apps.delete_title')
    expect(wrapper.get('dialog[open] [data-autofocus]').text()).toContain('_common.cancel')
    wrapper.unmount()
  })

  it('browses the host filesystem for the working directory', async () => {
    const { wrapper } = await mountApps()
    await wrapper.findAll('.kg-app-card')[0].findAll('button')[0].trigger('click')
    await flushPromises()

    const browseButtons = wrapper.findAll('.kg-input-group button')
    await browseButtons[1].trigger('click')
    await flushPromises()

    expect(wrapper.vm.fileBrowserOpen).toBe(true)
    expect(wrapper.findAll('.kg-file-entry')).toHaveLength(2)
    await wrapper.findAll('.kg-file-entry')[0].trigger('click')
    await flushPromises()
    expect(wrapper.vm.fileBrowserCurrentPath).toBe(browseFixture.path)
    wrapper.unmount()
  })
})
