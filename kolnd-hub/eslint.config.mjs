import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      'resources/**',
      'scripts/**',
      '**/*.log',
      'vitest.config.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Arquivos de config CommonJS (postcss/tailwind)
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
    rules: {
      // Estilo do projeto: catch {} vazio é intencional (erros ignorados de propósito)
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      // O projeto usa require() pontual (ex.: resetFirstRun) e imports CJS no main
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  // Desliga regras estilísticas divergentes do Prettier
  prettier
]
