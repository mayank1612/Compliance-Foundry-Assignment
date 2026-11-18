/**
 * vite.config.ts — dev server + production build for the task board.
 *
 * Proxy: in development the browser talks to the Vite server only; `/graphql` and
 * `/dev` are forwarded to the API on :4000. Same-origin requests mean no CORS
 * preflight on every GraphQL call, and no API URL to configure for local use.
 */
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true, // the API's CORS allow-list expects exactly this origin
    proxy: { '/graphql': API, '/dev': API },
  },
});
