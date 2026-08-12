import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: Vite serves the SPA on :5173 and proxies API + webhook calls to the
// application service on :8080. Production: `vite build` emits web/dist,
// which the server serves as static files (see server/src/index.ts).
export default defineConfig({
  base: '/champ/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/webhook': 'http://localhost:8080',
    },
  },
})
