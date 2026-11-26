import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default [
  {
    ignores: ['out/**', 'dist/**', 'coverage/**', 'node_modules/**', 'resources/**', '**/*.log']
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
    rules: {
      // catch {} vazio é intencional nos caminhos best-effort do logger.
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  // Desliga regras estilísticas que divergem do Prettier.
  prettier
]
