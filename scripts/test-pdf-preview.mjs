import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build as bundle } from 'esbuild'
import { mkdir, copyFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import electron from 'electron'

const sample = process.argv[2]
if (!sample) throw new Error('Usage: node scripts/test-pdf-preview.mjs <absolute-pdf-path> [offline-model-directory]')
const root = path.resolve('node_modules/.tmp/pdf-acceptance')
await mkdir(root, { recursive: true })
// Only our disposable fixture profile; the application's real userData is untouched.
await rm(path.join(root, 'profile'), { recursive: true, force: true })
await build({ configFile: false, base: './', plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: '"0.7.6-beta.0.2"', __NOTICE_URL_ENV__: '""' },
  build: { outDir: path.join(root, 'renderer'), emptyOutDir: true, modulePreload: false,
    rollupOptions: { input: path.resolve('tests/fixtures/pdf-reader.html') } } })
await bundle({ entryPoints: ['scripts/pdf-preview-acceptance-main.ts'], outfile: path.join(root, 'main.cjs'), bundle: true,
  platform: 'node', format: 'cjs', external: ['electron', 'onnxruntime-node'], target: 'node24' })
await copyFile('scripts/pdf-preview-acceptance-preload.cjs', path.join(root, 'preload.cjs'))
const env = { ...process.env, PDF_ACCEPTANCE_ROOT: root, PDF_ACCEPTANCE_SAMPLE: path.resolve(sample), PDF_ACCEPTANCE_MODELS: process.argv[3] ? path.resolve(process.argv[3]) : '' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [path.join(root, 'main.cjs')], { stdio: 'inherit', env, windowsHide: true })
child.on('exit', code => process.exit(code ?? 1))
