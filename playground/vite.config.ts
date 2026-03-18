import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import react from '@vitejs/plugin-react'
import { pilot } from '../src/index'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    pilot(),
    vue(),
    react(),
  ],
})
