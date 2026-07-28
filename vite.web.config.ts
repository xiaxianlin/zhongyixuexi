import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'web'),
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'web/src') } },
  server: { port: 5173 },
  build: { outDir: resolve(__dirname, 'out-web') },
})
