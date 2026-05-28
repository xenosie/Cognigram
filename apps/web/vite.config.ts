import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND = 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on all interfaces so a tunnel (cloudflared / ngrok / etc.) can
    // reach the dev server from outside the loopback.
    host: true,
    // Accept Host headers from public tunnel domains.
    allowedHosts: ['.trycloudflare.com', '.ngrok.app', '.ngrok-free.app'],
    // Proxy backend routes through the dev server so the tunnel only needs to
    // expose ONE port. The web app makes same-origin requests; Vite forwards
    // them to the Rust backend on 3001.
    proxy: {
      '/auth': BACKEND,
      '/chats': BACKEND,
      '/channels': BACKEND,
      '/users': BACKEND,
      '/handles': BACKEND,
      '/search': BACKEND,
      '/sticker-packs': BACKEND,
      '/upload': BACKEND,
      '/uploads': BACKEND,
      '/health': BACKEND,
      '/ws': { target: BACKEND.replace('http', 'ws'), ws: true },
    },
  },
})
