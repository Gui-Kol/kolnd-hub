import i18n from './locale'

import './KLOUD_GAMES.css'

/**
 * @brief Mount the application after locale initialization and report startup failures.
 *
 * @param {import('vue').App} app Application to configure and mount.
 * @param {Function} [config] Optional callback invoked after mounting.
 */
export function initApp(app, config) {
    //Wait for locale initialization, then render
    i18n().then(i18n => {
        app.use(i18n);
        app.provide('i18n', i18n.global)
        app.mount('#app');
        if (config) {
            config(app)
        }
    }).catch(error => {
        console.error('Failed to initialize KLOUD_GAMES', error);
    });
}
