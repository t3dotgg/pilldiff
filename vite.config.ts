import { defineConfig } from 'vite';

const securityHeaders = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    headers: securityHeaders,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    headers: securityHeaders,
  },
});
