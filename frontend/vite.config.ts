import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress missing-sourcemap warnings from third-party packages.
        if (warning.code === 'SOURCEMAP_ERROR' || warning.message.includes('sourcemap')) return
        warn(warning)
      },
    },
  },
  server: {
    host: '0.0.0.0',
    https: true,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws/audio': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
