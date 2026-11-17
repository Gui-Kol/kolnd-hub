import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ClientsPanel from '../../src_assets/common/assets/web/components/clients/ClientsPanel.vue'
import Pin from '../../src_assets/common/assets/web/Pin.vue'
import clientsFixture from '../fixtures/web/clients_list.json'
import pinFixture from '../fixtures/web/pin.json'

function jsonResponse(body) {
  return { ok: true, json: async () => structuredClone(body) }
}

async function mountClients() {
  const wrapper = mount(ClientsPanel, {
    global: { mocks: { $t: key => key }, stubs: { RouterLink: true } },
  })
  await flushPromises()
  return wrapper
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('paired clients panel', () => {
  it('lists the paired clients returned by the host', async () => {
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (url === './api/clients/list') return jsonResponse(clientsFixture)
      throw new Error(`Unexpected fetch: ${url}`)
    }))
    const wrapper = await mountClients()
    expect(wrapper.findAll('.kg-list-row')).toHaveLength(3)
    expect(wrapper.text()).toContain('Living room TV')
    expect(wrapper.text()).toContain('troubleshooting.unpair_single_unknown')
    wrapper.unmount()
  })

  it('shows the empty state when no client is paired', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: true, named_certs: [] })))
    const wrapper = await mountClients()
    expect(wrapper.findAll('.kg-list-row')).toHaveLength(0)
    expect(wrapper.text()).toContain('troubleshooting.unpair_single_no_devices')
    wrapper.unmount()
  })

  it('sends {uuid, enabled} when toggling a client', async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url === './api/clients/list') return jsonResponse(clientsFixture)
      return jsonResponse({ status: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountClients()

    const firstSwitch = wrapper.get('[role="switch"]')
    await firstSwitch.trigger('click')
    await flushPromises()

    const updateCall = fetchMock.mock.calls.find(([url]) => url === './api/clients/update')
    expect(updateCall).toBeDefined()
    expect(JSON.parse(updateCall[1].body)).toEqual({
      uuid: clientsFixture.named_certs[0].uuid,
      enabled: false,
    })
    wrapper.unmount()
  })

  it('unpairs a single client and unpairs all clients', async () => {
    const fetchMock = vi.fn(async url => {
      if (url === './api/clients/list') return jsonResponse(clientsFixture)
      return jsonResponse({ status: true })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = await mountClients()

    await wrapper.get('button[aria-label="pin.unpair_client"]').trigger('click')
    await flushPromises()
    const unpair = fetchMock.mock.calls.find(([url]) => url === './api/clients/unpair')
    expect(JSON.parse(unpair[1].body)).toEqual({ uuid: clientsFixture.named_certs[0].uuid })
    expect(wrapper.text()).toContain('troubleshooting.unpair_single_success')

    const unpairAll = wrapper.findAll('button').find(button => button.text() === 'troubleshooting.unpair_all')
    await unpairAll.trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url]) => url === './api/clients/unpair-all')).toBe(true)
    wrapper.unmount()
  })
})

describe('pin pairing', () => {
  async function mountPin({ pairings = pinFixture.pairings } = {}) {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === './api/pin' && (!options.method || options.method === 'GET')) {
        return jsonResponse({ pairings })
      }
      if (url === './api/pin' && options.method === 'POST') {
        return jsonResponse({ status: true })
      }
      if (url === './api/pin' && options.method === 'DELETE') {
        return jsonResponse({ status: true })
      }
      if (url === './api/clients/list') return jsonResponse(clientsFixture)
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(Pin, {
      global: {
        mocks: { $t: key => key },
        provide: { i18n: { t: key => key } },
        stubs: { AppShell: { template: '<div><slot /></div>' }, ClientsPanel: true, RouterLink: true },
      },
    })
    await flushPromises()
    return { wrapper, fetchMock }
  }

  it('polls /api/pin every two seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const { wrapper, fetchMock } = await mountPin()
    const initialCalls = fetchMock.mock.calls.filter(([url]) => url === './api/pin').length
    expect(initialCalls).toBe(1)

    vi.advanceTimersByTime(2000)
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([url]) => url === './api/pin').length).toBe(2)
    wrapper.unmount()
  })

  it('auto-selects the only pending request and shows four PIN boxes', async () => {
    const { wrapper } = await mountPin({ pairings: [pinFixture.pairings[0]] })
    expect(wrapper.vm.selectedPairingId).toBe(pinFixture.pairings[0].id)
    const boxes = wrapper.findAll('input.kg-pin-box')
    expect(boxes).toHaveLength(4)
    boxes.forEach(box => {
      expect(box.attributes('inputmode')).toBe('numeric')
      expect(box.attributes('maxlength')).toBe('1')
    })
    wrapper.unmount()
  })

  it('submits pairing_id, pin and name; clears PIN on success', async () => {
    const { wrapper, fetchMock } = await mountPin({ pairings: [pinFixture.pairings[0]] })
    const boxes = wrapper.findAll('input.kg-pin-box')
    await boxes[0].setValue('1')
    await boxes[1].setValue('2')
    await boxes[2].setValue('3')
    await boxes[3].setValue('4')
    await wrapper.get('#name-input').setValue('Steam Deck')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const post = fetchMock.mock.calls.find(([url, options]) => url === './api/pin' && options?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({
      pairing_id: pinFixture.pairings[0].id,
      pin: '1234',
      name: 'Steam Deck',
    })
    expect(wrapper.vm.pin).toBe('')
    expect(wrapper.vm.name).toBe('')
    expect(wrapper.text()).toContain('pin.pair_success')
    wrapper.unmount()
  })

  it('cancels the selected request with DELETE', async () => {
    const { wrapper, fetchMock } = await mountPin({ pairings: [pinFixture.pairings[0]] })
    const cancel = wrapper.findAll('button').find(button => button.attributes('title') === 'pin.cancel_pairing')
    await cancel.trigger('click')
    await flushPromises()

    const remove = fetchMock.mock.calls.find(([url, options]) => url === './api/pin' && options?.method === 'DELETE')
    expect(JSON.parse(remove[1].body)).toEqual({ pairing_id: pinFixture.pairings[0].id })
    wrapper.unmount()
  })

  it('requires a selected request before sending the PIN', async () => {
    const { wrapper, fetchMock } = await mountPin({ pairings: [] })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([url, options]) => url === './api/pin' && options?.method === 'POST')).toBe(false)
    expect(wrapper.text()).toContain('pin.select_pairing_required')
    wrapper.unmount()
  })
})
