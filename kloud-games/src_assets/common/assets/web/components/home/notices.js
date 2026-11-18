/**
 * @file notices.js
 * @brief Regras (puras e testaveis) dos avisos exibidos na Home.
 *
 * Reproduz exatamente as variantes do componente legado: escolha de driver,
 * ViGEmBus ausente/desatualizado, Virtual HID ausente/desatualizado/desenvolvimento,
 * licenca invalida (com fallback), broker indisponivel e avisos do macOS.
 * Nenhum dado e inventado: tudo vem de `/api/config`, `/api/permissions`,
 * `/api/virtual-input/status` e `/api/virtual-input/license`.
 */

/**
 * @brief Build a standardized notice descriptor.
 *
 * @param {boolean} warning Whether the notice is actionable (warning) or informational.
 * @param {string} title i18n key for the title.
 * @param {object[]} messages Localized message descriptors.
 * @param {object} [options] Action overrides.
 * @return {object} Notice consumed by the template.
 */
function buildNotice(warning, title, messages, options = {}) {
  return {
    action: options.action || 'index.review_virtual_input',
    chooseDriver: options.chooseDriver || false,
    to: options.to || '/troubleshooting#virtualhid',
    messages,
    title,
    tone: warning ? 'warning' : 'info',
    warning,
  }
}

/**
 * @brief Build the virtual-input notice for the current host state.
 *
 * @param {object} state Host state collected from the API.
 * @param {string} state.platform Host platform.
 * @param {boolean} state.controllerEnabled Whether gamepads are enabled.
 * @param {string} state.gamepadDriver Selected gamepad driver.
 * @param {object|null} state.virtualhid Virtual HID status.
 * @param {object|null} state.vigembus ViGEmBus status.
 * @param {object|null} state.virtualhidLicense Virtual HID license status.
 * @return {object|null} Notice or no notice.
 */
export function buildVirtualInputNotice(state) {
  const { platform, controllerEnabled, gamepadDriver, virtualhid, vigembus, virtualhidLicense } = state
  if (!controllerEnabled || gamepadDriver === 'none') {
    return null
  }

  if (platform === 'macos') {
    if (virtualhidLicense && !virtualhidLicense.licensed) {
      return virtualhidLicense.service_available
        ? buildNotice(true, 'index.virtualhid_macos_license_title', [{ key: 'index.virtualhid_macos_license_desc' }])
        : buildNotice(true, 'index.virtualhid_broker_unavailable_title', [{ key: 'index.virtualhid_macos_broker_desc' }])
    }
    return virtualhid?.development_version
      ? buildNotice(false, 'index.virtualhid_development_title', [{ key: 'index.virtualhid_development_desc' }])
      : null
  }

  if (platform !== 'windows' || !virtualhid || !vigembus) {
    return null
  }

  const vigembusUsable = vigembus.installed && vigembus.version_compatible

  if (!gamepadDriver) {
    return buildNotice(false, 'index.gamepad_driver_choice_title', [{
      key: 'index.gamepad_driver_choice_desc',
    }], {
      action: 'index.choose_gamepad_driver',
      chooseDriver: true,
      to: '/config#gamepad_driver',
    })
  }

  if (gamepadDriver === 'vigembus') {
    if (!controllerEnabled || vigembusUsable) {
      return null
    }
    return buildNotice(true, 'index.vigembus_required_title', [{
      key: vigembus.installed ? 'index.vigembus_outdated_desc' : 'index.vigembus_not_installed_desc',
      params: { version: vigembus.version, supported_versions: vigembus.supported_versions },
    }])
  }

  if (virtualhid.installed) {
    const messages = []
    if (!virtualhid.version_compatible && !virtualhid.development_version) {
      messages.push({
        key: 'index.virtualhid_outdated_desc',
        params: { version: virtualhid.version, supported_versions: virtualhid.supported_versions },
      })
    }
    if (virtualhidLicense && !virtualhidLicense.licensed) {
      const licenseMessageKey = gamepadDriver === 'all' && vigembusUsable
        ? 'index.virtualhid_license_invalid_fallback_desc'
        : 'index.virtualhid_license_invalid_desc'
      messages.push({ key: licenseMessageKey })
    }
    if (messages.length) {
      return buildNotice(true, 'index.virtualhid_attention_title', messages)
    }
    if (virtualhid.development_version) {
      return buildNotice(false, 'index.virtualhid_development_title', [{ key: 'index.virtualhid_development_desc' }])
    }
    return null
  }

  if (gamepadDriver === 'virtualhid') {
    return buildNotice(true, 'index.virtualhid_broker_unavailable_title', [{ key: 'index.virtualhid_required_desc' }])
  }

  if (controllerEnabled && !vigembusUsable) {
    return buildNotice(true, 'index.virtual_input_unavailable_title', [{ key: 'index.virtual_input_unavailable_desc' }])
  }

  return buildNotice(
    false,
    'index.virtualhid_optional_title',
    [{ key: controllerEnabled ? 'index.virtualhid_optional_vigembus_desc' : 'index.virtualhid_optional_desc' }],
  )
}

/**
 * @brief Return required, verifiable permissions that are not granted.
 *
 * @param {object[]} permissions Permission list from `/api/permissions`.
 * @return {object[]} Missing permissions.
 */
export function missingRequiredPermissions(permissions) {
  return (permissions || []).filter(permission =>
    permission.required && permission.verifiable && permission.status !== 'granted'
  )
}

/**
 * @brief Describe the host-health rows derived from real API values.
 *
 * @param {object} state Host state.
 * @return {Array<{key: string, tone: string, label: string, detail: string}>} Health rows.
 */
export function buildHealthRows(state) {
  const rows = []
  const permissions = state.permissions || []
  const missing = missingRequiredPermissions(permissions)
  if (permissions.length) {
    rows.push({
      key: 'permissions',
      tone: missing.length ? 'warning' : 'success',
      label: missing.length ? 'index.permissions_missing_title' : 'index.permissions_ok',
      detail: `${permissions.filter(permission => permission.status === 'granted').length}/${permissions.length}`,
      to: '/troubleshooting#permissions',
    })
  }

  const driver = state.virtualhid
  if (state.platform === 'windows' || state.platform === 'macos') {
    const virtualInputOk = driver?.installed && driver?.version_compatible
    rows.push({
      key: 'virtual_input',
      tone: virtualInputOk ? 'success' : 'warning',
      label: virtualInputOk ? 'index.virtual_input_ok' : 'index.virtualhid_attention_title',
      detail: driver?.version || state.gamepadDriver || '',
      to: '/troubleshooting#virtualhid',
    })
  }

  rows.push({
    key: 'network',
    tone: 'neutral',
    label: state.upnp === 'enabled' ? 'index.network_upnp' : 'index.network_upnp_off',
    detail: state.port ? `:${state.port}` : '',
    to: '/config#port',
  })

  rows.push({
    key: 'audio',
    tone: 'success',
    label: state.stream_audio === 'disabled' ? 'index.audio_default' : 'index.audio_configured',
    detail: state.audio_sink || state.virtual_sink || '',
    to: '/config#audio_sink',
  })

  return rows
}
