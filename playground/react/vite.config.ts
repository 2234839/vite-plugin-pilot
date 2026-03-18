import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pilot } from '../../src/index'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    pilot(),
    react(),
  ],
})
