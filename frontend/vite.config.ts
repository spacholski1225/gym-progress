import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    injectRegister: null,
    includeAssets: ['apple-touch-icon.png', 'icon.svg'],
    manifest: {
      name: 'Dziennik treningowy', short_name: 'Trening', lang: 'pl',
      description: 'Twój plan, serie i postępy.',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#155f49', background_color: '#f3f4f6',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
      navigateFallbackDenylist: [/^\/api\//, /^\/docs/, /^\/openapi\.json/],
      cleanupOutdatedCaches: true,
    },
  })],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
});
