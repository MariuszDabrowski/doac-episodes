import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Pages serves this as a project page at /doac-episodes/, so the built
  // bundle, public/ assets, and router base all need the subpath prefix.
  // Dev still serves from / since the dev server isn't behind a subpath.
  base: process.env.NODE_ENV === 'production' ? '/doac-episodes/' : '/',
  // The frontend lives under client/ so it sits alongside server/.
  // Build output still lands at project-root/dist.
  root: 'client',
  // public/ stays at the project root so the portrait pipeline (which
  // writes to public/portraits/) doesn't need to know about client/.
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    // The debug page (and any future server-driven feature) hits /api/*
    // The Hono server in server/index.mjs listens on 3001 in dev.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
