import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiFetch } from '../../src_assets/common/assets/web/fetch_utils'
import { state } from '../../src_assets/common/assets/web/Notification.vue'

afterEach(() => {
  vi.unstubAllGlobals()
  state.notifications.splice(0)
})

describe('apiFetch CSRF notifications', () => {
  it('shows a translated toast for known CSRF errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 400,
      clone() {
        return { json: async () => ({ error: 'Invalid CSRF token' }) }
      },
    })))

    const response = await apiFetch('./api/config', { method: 'POST' })

    expect(response.status).toBe(400)
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0]).toMatchObject({
      type: 'danger',
      messageKey: '_common.csrf_error_desc',
      titleKey: '_common.csrf_error',
    })
  })

  it('ignores unrelated 400 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 400,
      clone() {
        return { json: async () => ({ error: 'Something else' }) }
      },
    })))

    await apiFetch('./api/config')
    expect(state.notifications).toHaveLength(0)
  })

  it('ignores non-JSON error bodies and successful responses', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async url => url === 'json'
      ? { status: 200, clone() { return { json: async () => ({}) } } }
      : {
          status: 400,
          clone() {
            return { json: async () => { throw new Error('not json') } }
          },
        }))

    await apiFetch('./api/config')
    await apiFetch('json')
    expect(state.notifications).toHaveLength(0)
    expect(debug).toHaveBeenCalled()
    debug.mockRestore()
  })
})
