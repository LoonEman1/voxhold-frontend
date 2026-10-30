import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react(), ...(env.ANALYZE === 'true' ? [visualizer({ filename: 'dist/bundle-report.html', gzipSize: true, brotliSize: true, open: false })] : [])],
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
      manifest: true,
      cssCodeSplit: true,
      reportCompressedSize: true,
      rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'virtual-vendor', test: /node_modules[\\/]@tanstack[\\/](react-virtual|virtual-core)[\\/]/ }, { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } } },
    },
  }
})
