import { defineConfig } from 'vite'
import { pilot } from '../../src/index'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    pilot(),
  ],
})
