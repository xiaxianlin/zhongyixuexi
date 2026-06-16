import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['out', 'dist', 'release', 'coverage', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // fetch-on-mount (setState in effect) is a legitimate, common pattern for
      // this app's simple local data loading; the rule's "use a data library"
      // prescription is overkill here.
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  {
    files: ['electron/**/*.ts', 'electron.vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },
)
