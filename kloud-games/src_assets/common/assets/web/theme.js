/**
 * @file theme.js
 * @brief Aplicacao e persistencia dos 21 temas do Kloud Games.
 *
 * Contrato preservado: a preferencia vive em `localStorage.theme`, `auto` e o
 * botao aleatorio continuam disponiveis e o `prefers-color-scheme` continua
 * observado. Todos os temas sao escuros, entao `auto` resolve para o tema
 * padrao KLOUD_GAMES (identidade Kolnd). O atributo de tema do Bootstrap deixou
 * de existir junto com a dependencia.
 */

/** Identificadores dos temas, na ordem exibida no menu. */
export const THEME_IDS = [
  'KLOUD_GAMES',
  'dark',
  'dracula',
  'mocha',
  'ember',
  'ember-light',
  'rose-pine',
  'rose-pine-dawn',
  'moonlight',
  'slate',
  'midnight',
  'nord',
  'light',
  'alucard',
  'latte',
  'indigo',
  'ocean',
  'forest',
  'rose',
  'lavender',
  'monochrome',
]

/** Tema usado quando nao ha preferencia salva. */
export const DEFAULT_THEME = 'KLOUD_GAMES'

/**
 * @brief Read the stored theme preference.
 *
 * @return {string|null} Stored theme identifier or `null`.
 */
export function getStoredTheme() {
  return localStorage.getItem('theme')
}

/**
 * @brief Persist the theme preference.
 *
 * @param {string} theme Theme identifier, including `auto`.
 * @return {void}
 */
export function setStoredTheme(theme) {
  localStorage.setItem('theme', theme)
}

/**
 * @brief Resolve a preference to a concrete theme identifier.
 *
 * @param {string|null} theme Stored preference.
 * @return {string} Theme identifier applied to the document.
 */
export function resolveTheme(theme) {
  if (!theme || theme === 'auto') {
    return DEFAULT_THEME
  }
  return THEME_IDS.includes(theme) ? theme : DEFAULT_THEME
}

/**
 * @brief Read the theme preference, defaulting to the KLOUD_GAMES identity.
 *
 * @return {string} Stored identifier, `auto`, or the default theme.
 */
export const getPreferredTheme = () => getStoredTheme() || DEFAULT_THEME

/**
 * @brief Apply a concrete theme to the document root.
 *
 * @param {string} theme Resolved theme identifier.
 * @return {void}
 */
function setTheme(theme) {
  const resolved = resolveTheme(theme)
  document.documentElement.dataset.theme = resolved
}

/**
 * @brief Mark the active theme in the rendered toggle and update its label.
 *
 * @param {string} theme Active preference (`auto` or a theme id).
 * @param {boolean} [focus] Whether to move focus to the theme trigger.
 * @return {void}
 */
export const showActiveTheme = (theme, focus = false) => {
  const buttons = document.querySelectorAll('[data-kg-theme-value]')
  if (!buttons.length) {
    return
  }

  let activeLabel = ''
  buttons.forEach(button => {
    const isActive = button.dataset.kgThemeValue === theme
    button.setAttribute('aria-pressed', String(isActive))
    if (isActive) {
      activeLabel = button.dataset.kgThemeLabel || ''
    }
  })

  const themeSwitcher = document.querySelector('#kg-theme')
  const themeSwitcherText = document.querySelector('#kg-theme-text')
  if (themeSwitcher && themeSwitcherText) {
    const label = themeSwitcherText.dataset.kgThemeLabel || themeSwitcherText.textContent
    themeSwitcher.setAttribute('aria-label', activeLabel ? `${label} (${activeLabel})` : label)
  }

  if (focus && themeSwitcher) {
    themeSwitcher.focus()
  }
}

/**
 * @brief Persist and apply a theme preference, then refresh the toggle state.
 *
 * @param {string} theme Theme identifier or `auto`.
 * @return {void}
 */
export const applyTheme = (theme) => {
  setStoredTheme(theme)
  setTheme(theme)
  showActiveTheme(theme, true)
}

/**
 * @brief Choose a random theme that differs from the current preference.
 *
 * @return {string} Random theme identifier.
 */
export const pickRandomTheme = () => {
  const current = getStoredTheme()
  const values = THEME_IDS.filter(value => value !== current)
  return values[Math.floor(Math.random() * values.length)] // NOSONAR(javascript:S2245) random not used for cryptography here
}

/**
 * @brief Apply a random theme preference.
 *
 * @return {string} The theme that was applied.
 */
export const applyRandomTheme = () => {
  const theme = pickRandomTheme()
  applyTheme(theme)
  return theme
}

/**
 * @brief Wire click handlers for theme buttons marked with `data-kg-theme-value`.
 *
 * Kept for compatibility with markup rendered outside Vue; the ThemeMenu
 * component calls {@link applyTheme} directly.
 *
 * @return {void}
 */
export function setupThemeToggleListener() {
  document.querySelectorAll('[data-kg-theme-value]')
    .forEach(toggle => {
      toggle.addEventListener('click', () => applyTheme(toggle.dataset.kgThemeValue))
    })

  const randomToggle = document.querySelector('#kg-theme-random')
  if (randomToggle) {
    randomToggle.addEventListener('click', () => applyRandomTheme())
  }

  showActiveTheme(getPreferredTheme(), false)
}

/**
 * @brief Apply the saved preference on startup and track OS appearance changes.
 *
 * @return {void}
 */
export function loadAutoTheme() {
  setTheme(getPreferredTheme())

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const storedTheme = getStoredTheme()
    if (storedTheme === 'auto' || !storedTheme) {
      setTheme(getPreferredTheme())
    }
  })

  window.addEventListener('DOMContentLoaded', () => {
    showActiveTheme(getPreferredTheme())
  })
}
