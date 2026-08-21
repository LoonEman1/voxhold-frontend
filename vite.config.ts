import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY || 'http://localhost:8080',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    preview: { host: true, port: 4173 },
    build: {
      target: 'es2022',
      sourcemap: false,
      cssCodeSplit: true,
      reportCompressedSize: true,
    },
  }
})
