import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['out', 'out-web', 'out-server', 'dist', 'release', 'coverage', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // underscore-prefixed args / vars / caught-errors are intentionally unused.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}', 'web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // fetch-on-mount (setState in effect) is a legitimate, common pattern for
      // this app's simple local data loading; the rule's "use a data library"
      // prescription is overkill here.
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // shared/node/* is Node-only (and, for the AI client, holds the platform's
      // API key) — never importable from a browser bundle.
      'no-restricted-imports': ['error', { patterns: [{ group: ['@shared/node/*'], message: 'shared/node/* is Node-only — not importable from src/ or web/.' }] }],
    },
  },

  {
    files: ['electron/**/*.ts', 'electron.vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // shared/ui/* assumes DOM/window and browser-only libraries — never
      // importable from the main process.
      'no-restricted-imports': ['error', { patterns: [{ group: ['@shared/ui/*'], message: 'shared/ui/* is browser-only — not importable from electron/ or server/.' }] }],
    },
  },

  {
    files: ['server/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@shared/ui/*'], message: 'shared/ui/* is browser-only — not importable from electron/ or server/.' }] }],
    },
  },

  {
    files: ['vite.web.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
)
