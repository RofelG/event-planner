import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./client', import.meta.url));

// Read only the API port from .env. Vite's loadEnv would also pick up
// NODE_ENV=development from the server's .env and produce a development build.
const envFile = fileURLToPath(new URL('./.env', import.meta.url));
const env = existsSync(envFile) ? parse(readFileSync(envFile)) : {};

export default defineConfig(() => {
  // API_PORT only: dev tooling may set PORT for the Vite process itself.
  // A real environment variable wins, so the e2e run can point at its own API.
  const apiPort = process.env.API_PORT || env.API_PORT || 3001;

  return {
    root,
    plugins: [react()],
    css: {
      postcss: {
        plugins: [tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.cjs', import.meta.url)) }), autoprefixer()],
      },
    },
    server: {
      port: 5173,
      // In development the SPA runs on Vite and forwards /api to Express, so
      // the session cookie stays same-origin exactly as it is in production.
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    build: {
      outDir: fileURLToPath(new URL('./dist', import.meta.url)),
      emptyOutDir: true,
    },
  };
});
