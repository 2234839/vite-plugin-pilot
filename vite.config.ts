import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['vite', 'fs', 'path', 'http', '@vue/compiler-dom', 'magic-string'],
      /** 生成 TypeScript 类型声明文件 */
      plugins: [
        {
          name: 'generate-types',
          writeBundle() {
            execSync('npx tsc --declaration --emitDeclarationOnly --outDir dist', { stdio: 'inherit' })
          },
        },
      ],
    },
    target: 'node18',
  },
})
