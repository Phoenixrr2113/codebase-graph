import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The API serves these files from its own origin, so relative asset URLs
    // keep the build independent of the path it is mounted at.
    assetsDir: 'assets',
  },
  server: {
    port: 3100,
  },
})
