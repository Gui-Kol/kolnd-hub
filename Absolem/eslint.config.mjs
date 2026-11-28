import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  {
    ignores: [
      'out/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'resources/**',
      'scripts/**',
      '**/*.log'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Configs CommonJS de build (postcss/tailwind).
    files: ['*.config.js', 'postcss.config.js', 'tailwind.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        exports: 'writable'
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest']
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    ...jsxA11y.flatConfigs.recommended
  },
  {
    // Worklet: globais do AudioWorkletScope (não existem no escopo global do
    // Node/ESLint; o arquivo é emitido como asset e roda no Chromium).
    files: ['src/renderer/src/audio/pcm-worklet.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly'
      }
    }
  },
  {
    rules: {
      // catch {} vazio é intencional nos caminhos best-effort do logger.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    // O main nunca fala com o console: o logger aplica redação por nível. A
    // única exceção é o próprio logger, que degrada para console se o disco
    // falhar e precisa do console como sink de desenvolvimento.
    files: ['src/main/**/*.ts'],
    rules: { 'no-console': 'error' }
  },
  {
    files: ['src/main/logger.ts'],
    rules: { 'no-console': 'off' }
  },
  // Desliga regras estilísticas que divergem do Prettier.
  prettier
]
