// SPDX-License-Identifier: MIT
// Copyright (c) 2026 AsO
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'))

// Server port: inherit from environment (UCPD_PORT=xxxx npm run dev) or default 57321.
// Must match the Node server's UCPD_PORT env var.
const SERVER_PORT = parseInt(process.env.UCPD_PORT ?? '57321', 10);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  define: {
    // Expose port to client bundle as import.meta.env.VITE_SERVER_PORT
    'import.meta.env.VITE_SERVER_PORT': JSON.stringify(String(SERVER_PORT)),
    // Expose root package version
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: {
    port: 5173,
    strictPort: true,   // fail fast if port 5173 is taken – never silently shift to another port
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
