import { describe, expect, it } from 'vitest'

import { buildHealthRows, buildVirtualInputNotice, missingRequiredPermissions } from '../../src_assets/common/assets/web/components/home/notices'
import { filterLogText, parseLogEntries, recentLogEntries } from '../../src_assets/common/assets/web/components/diagnostics/log-utils'
import logFixture from '../fixtures/web/logs.txt?raw'

const baseState = {
  platform: 'windows',
  controllerEnabled: true,
  gamepadDriver: 'virtualhid',
  virtualhid: { installed: true, version_compatible: true, development_version: false, version: '1.0.0' },
  vigembus: { installed: true, version_compatible: true, version: '1.17.333.0' },
  virtualhidLicense: { licensed: true, service_available: true },
}

describe('virtual input notice variants', () => {
  it('offers the driver choice when no backend is selected', () => {
    const notice = buildVirtualInputNotice({ ...baseState, gamepadDriver: '' })
    expect(notice.title).toBe('index.gamepad_driver_choice_title')
    expect(notice.chooseDriver).toBe(true)
    expect(notice.to).toBe('/config#gamepad_driver')
    expect(notice.warning).toBe(false)
  })

  it('warns when ViGEmBus is not installed', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      gamepadDriver: 'vigembus',
      vigembus: { installed: false, version_compatible: false },
    })
    expect(notice.title).toBe('index.vigembus_required_title')
    expect(notice.messages[0].key).toBe('index.vigembus_not_installed_desc')
    expect(notice.warning).toBe(true)
  })

  it('warns when ViGEmBus is outdated', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      gamepadDriver: 'vigembus',
      vigembus: { installed: true, version_compatible: false },
    })
    expect(notice.messages[0].key).toBe('index.vigembus_outdated_desc')
  })

  it('warns when Virtual HID is missing for the selected driver', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      virtualhid: { installed: false },
    })
    expect(notice.title).toBe('index.virtualhid_broker_unavailable_title')
    expect(notice.messages[0].key).toBe('index.virtualhid_required_desc')
  })

  it('reports an outdated Virtual HID with supported versions', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      virtualhid: { installed: true, version_compatible: false, version: '1.0.0', supported_versions: '>= 2' },
    })
    expect(notice.title).toBe('index.virtualhid_attention_title')
    expect(notice.messages[0].params).toEqual({ version: '1.0.0', supported_versions: '>= 2' })
  })

  it('uses the ViGEmBus fallback text for an invalid license with all drivers', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      gamepadDriver: 'all',
      virtualhidLicense: { licensed: false },
    })
    expect(notice.messages.some(message => message.key === 'index.virtualhid_license_invalid_fallback_desc')).toBe(true)
  })

  it('reports the macOS license warning', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      platform: 'macos',
      virtualhidLicense: { licensed: false, service_available: true },
    })
    expect(notice.title).toBe('index.virtualhid_macos_license_title')
  })

  it('reports the macOS broker as unavailable', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      platform: 'macos',
      virtualhidLicense: { licensed: false, service_available: false },
    })
    expect(notice.title).toBe('index.virtualhid_broker_unavailable_title')
  })

  it('reports a macOS development build', () => {
    const notice = buildVirtualInputNotice({
      ...baseState,
      platform: 'macos',
      virtualhid: { installed: true, development_version: true },
    })
    expect(notice.title).toBe('index.virtualhid_development_title')
    expect(notice.warning).toBe(false)
  })

  it('returns no notice when gamepads are disabled', () => {
    expect(buildVirtualInputNotice({ ...baseState, gamepadDriver: 'none' })).toBeNull()
    expect(buildVirtualInputNotice({ ...baseState, controllerEnabled: false })).toBeNull()
  })

  it('returns no notice on Linux', () => {
    expect(buildVirtualInputNotice({ ...baseState, platform: 'linux' })).toBeNull()
  })
})

describe('host health rows', () => {
  it('flags missing required permissions', () => {
    const rows = buildHealthRows({
      platform: 'windows',
      permissions: [
        { id: 'input', status: 'granted', required: true, verifiable: true },
        { id: 'screen_recording', status: 'denied', required: true, verifiable: true },
      ],
      virtualhid: { installed: true, version_compatible: true },
      upnp: 'enabled',
      port: 47989,
      stream_audio: 'enabled',
    })
    expect(rows.find(row => row.key === 'permissions').tone).toBe('warning')
    expect(rows.find(row => row.key === 'network').label).toBe('index.network_upnp')
  })

  it('omits virtual input rows outside Windows and macOS', () => {
    const rows = buildHealthRows({ platform: 'linux', permissions: [], stream_audio: 'enabled' })
    expect(rows.some(row => row.key === 'virtual_input')).toBe(false)
  })

  it('only counts required verifiable permissions', () => {
    expect(missingRequiredPermissions([
      { required: true, verifiable: true, status: 'denied' },
      { required: true, verifiable: false, status: 'on_use' },
      { required: false, verifiable: true, status: 'denied' },
      { required: true, verifiable: true, status: 'granted' },
    ])).toHaveLength(1)
  })
})

describe('log parsing', () => {
  it('parses the fixture into timestamped entries with levels', () => {
    const entries = parseLogEntries(logFixture)
    expect(entries).toHaveLength(6)
    expect(entries.map(entry => entry.level)).toEqual(['Info', 'Debug', 'Info', 'Warning', 'Error', 'Fatal'])
    expect(entries[5].message).toContain('Unable to bind')
    expect(entries[5].levelClass).toBe('kg-log-fatal')
  })

  it('keeps multi-line entries together', () => {
    const entries = parseLogEntries('[2026-01-01 00:00:00.000]: Error: first\ncontinued\n[2026-01-01 00:00:01.000]: Info: second')
    expect(entries).toHaveLength(2)
    expect(entries[0].raw).toContain('continued')
  })

  it('treats text without timestamps as a single entry', () => {
    const entries = parseLogEntries('plain text')
    expect(entries).toHaveLength(1)
    expect(entries[0].level).toBe('Info')
  })

  it('returns no entries for empty input', () => {
    expect(parseLogEntries('')).toEqual([])
    expect(parseLogEntries(null)).toEqual([])
  })

  it('filters by substring and keeps whole lines', () => {
    expect(filterLogText(logFixture, 'warning')).toContain('license')
    expect(filterLogText(logFixture, 'nothing-here')).toBe('')
  })

  it('returns the newest entries up to the limit', () => {
    const entries = recentLogEntries(logFixture, 2)
    expect(entries.map(entry => entry.level)).toEqual(['Error', 'Fatal'])
  })
})
