import { defineConfig } from 'vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'bin/pilot': resolve(__dirname, 'src/bin/pilot.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => entryName === 'bin/pilot' ? 'bin/pilot.js' : 'index.js',
    },
    rollupOptions: {
      external: ['vite', 'fs', 'path', 'http', 'https', '@vue/compiler-dom', 'magic-string'],
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
