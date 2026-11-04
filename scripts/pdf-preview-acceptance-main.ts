import { app, BrowserWindow, ipcMain, session, protocol } from 'electron'
import { writeFile, mkdir, cp } from 'node:fs/promises'
import path from 'node:path'
import { PdfFileServer } from '../electron/pdfFileServer'
import { registerPdfProtocol, registerPdfIpc } from '../electron/pdfProtocol'
import { registerOcrIpc } from '../electron/ocr'
import { LOCAL_FILE_CSP } from '../electron/csp'

const root = process.env.PDF_ACCEPTANCE_ROOT!
const output = path.join(root, 'results.json')
const sample = process.env.PDF_ACCEPTANCE_SAMPLE!
const navigation = path.join(root, 'navigation.pdf')
app.setPath('userData', path.join(root, 'profile'))
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.on('window-all-closed', () => {})
// Must be declared before ready, exactly as in the application.
protocol.registerSchemesAsPrivileged([{ scheme: 'unyra-pdf', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const result: Record<string, unknown> = { sample, runs: [] }
let base64Reads = 0, ocrCalls = 0
const recognized: Array<{ owner: number; page: number }> = []
const cacheHits: Array<{ owner: number; key: string }> = []
const watchdog = setTimeout(() => { console.error('Acceptance timeout'); app.exit(1) }, 180000)
function navigationPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 10 0 R /Dests << /chapter [7 0 R /Fit] >> >>',
    '<< /Type /Pages /Count 3 /Kids [3 0 R 5 0 R 7 0 R] >>',
    ...[1, 2, 3].flatMap((n, i) => {
      const text = `BT /F1 18 Tf 40 100 Td (Fixture page ${n}) Tj ET`
      return [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${i === 1 ? '792 612' : '612 792'}] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 9 0 R >> >> >>`,
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`]
    }),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Outlines /Count 1 /First 11 0 R /Last 11 0 R >>',
    '<< /Title (Target third page) /Parent 10 0 R /Dest /chapter >>',
  ]
  let data = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(data)); data += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(data)
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  return data + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}
async function main() {
await app.whenReady()
await mkdir(app.getPath('userData'), { recursive: true })
await writeFile(navigation, navigationPdf())
// Copy only existing offline weights to the disposable profile; never change user settings.
if (process.env.PDF_ACCEPTANCE_MODELS) await cp(process.env.PDF_ACCEPTANCE_MODELS, path.join(app.getPath('userData'), 'ocr-models'), { recursive: true })
registerPdfProtocol(); registerPdfIpc(); registerOcrIpc()
const originalHandle = ipcMain.handle.bind(ipcMain)
// Count calls while forwarding to the real OCR implementation registered above.
ipcMain.on('pdf-test:ocr-call', (event, page: number) => { ocrCalls++; recognized.push({ owner: event.sender.id, page }) })
ipcMain.on('pdf-test:cache-hit', (event, key: string) => { cacheHits.push({ owner: event.sender.id, key }) })
originalHandle('local:readMedia', () => { base64Reads++; return { ok: false, error: 'Whole-file reads forbidden by acceptance test' } })
originalHandle('plugins:list', () => ({ ok: true, entries: [], dir: '' }))
originalHandle('plugins:toggles', () => ({ ok: true, toggles: { 'ocr.recognize': true } }))
session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: {
  ...details.responseHeaders, ...(details.url.startsWith('file:') ? { 'Content-Security-Policy': [LOCAL_FILE_CSP] } : {}),
} }))

async function run(label: string) {
  const start = performance.now()
  const win = new BrowserWindow({ width: 1280, height: 960, show: false,
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  win.webContents.on('console-message', (_event, ...args) => { console.log('[renderer]', ...args) })
  const evaluate = async <T>(code: string): Promise<T> => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (error) { throw new Error(`Evaluation failed: ${code}`, { cause: error }) }
  }
  const waitFor = async (code: string, timeout = 30000) => {
    const begin = performance.now()
    while (performance.now() - begin < timeout) {
      if (await evaluate<boolean>(code)) return
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw new Error('Timed out: ' + code)
  }
  const visible = (n: number) => `(()=>{const c=document.querySelector('[data-pdf-canvas="${n}"]');return !!c&&c.dataset.pdfReady==='true'&&c.width>0&&c.height>0})()`
  await win.loadFile(path.join(root, 'renderer/tests/fixtures/pdf-reader.html'), { query: { sample } })
  await waitFor(visible(1))
  const firstPageMs = Math.round(performance.now() - start)
  const firstPageTiming = await evaluate(`({canvas:{...document.querySelector('[data-pdf-canvas="1"]').dataset},stages:window.pdfTestStages, navigation:performance.getEntriesByType('navigation')[0].toJSON()})`)
  const firstPageNetwork = await evaluate<{ requestedBytes: number; fullRequests: number; ranges: string[] }>('window.pdfTestNetwork')
  if (firstPageNetwork.fullRequests || firstPageNetwork.requestedBytes >= 20 * 1024 * 1024) throw new Error('First page read too much data: ' + JSON.stringify({ bytes: firstPageNetwork.requestedBytes, full: firstPageNetwork.fullRequests, ranges: firstPageNetwork.ranges.slice(0, 10) }))
  console.log(label + ': first page rendered in ' + firstPageMs + ' ms')
  console.log('FIRST PAGE TIMING ' + JSON.stringify({ firstPageTiming, firstPageNetwork }))
  if (process.env.PDF_ACCEPTANCE_FIRST_ONLY) {
    ;(result.runs as unknown[]).push({ label, firstPageMs, firstPageTiming, firstPageNetwork })
    win.destroy(); return
  }
  const mode = await evaluate<string>(`document.querySelector('[data-pdf-reader]').dataset.pdfMode`)
  const pixels = await evaluate<number>(`(()=>{const c=document.querySelector('[data-pdf-canvas="1"]');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=64)if(d[i]<220)n++;return n})()`)
  if (pixels < 100 || mode !== 'range') throw new Error(`Invalid first page: pixels=${pixels}, mode=${mode}`)
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const screenshot = await win.webContents.capturePage()
  await writeFile(path.join(root, `${label}-page1.png`), screenshot.toPNG())
  // The scanned cover must be recognized and searchable before the rest of the book.
  await waitFor(`window.pdfTestIndex.list().some(d=>window.pdfTestIndex.search({documentId:d.documentId,query:'实验'}).some(hit=>hit.pageNumber===1))`, 65000)
  const jump = async (n: number) => {
    const begin = performance.now()
    await evaluate(`(()=>{const i=document.querySelector('input[aria-label="跳转页码"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'${n}');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    // React's number-input change handling is driven by the setter + input event.
    await evaluate(`document.querySelector('input[aria-label="跳转页码"]').form.requestSubmit()`)
    await waitFor(visible(n))
    return Math.round(performance.now() - begin)
  }
  await waitFor(visible(2))
  const preloadedMs = await jump(2)
  const jump500Ms = await jump(500)
  const jump500Timing = await evaluate(`({...document.querySelector('[data-pdf-canvas="500"]').dataset})`)
  const jump686Ms = await jump(686)
  const jump686Timing = await evaluate(`({...document.querySelector('[data-pdf-canvas="686"]').dataset})`)
  const canvasCount = await evaluate<number>('document.querySelectorAll("[data-pdf-canvas]").length')
  const oldReleased = await evaluate<boolean>(`!document.querySelector('[data-pdf-canvas="1"]')`)
  const pagePosition = await evaluate<number>(`(()=>{const s=document.querySelector('[data-pdf-scroll]');const p=document.querySelector('[data-page-number="686"]');return p.getBoundingClientRect().top-s.getBoundingClientRect().top})()`)
  const inputPage = await evaluate<string>(`document.querySelector('input[aria-label="跳转页码"]').value`)
  if (!oldReleased || canvasCount > 7 || pagePosition < -2 || pagePosition > 32 || inputPage !== '686') throw new Error(`Virtualization/jump failed: ${canvasCount}, ${oldReleased}, ${pagePosition}, ${inputPage}`)
  const memory = app.getAppMetrics().find(metric => metric.pid === win.webContents.getOSProcessId())?.memory
  await waitFor(`window.pdfTestIndex.list().some(d=>d.indexed>=2)`, 65000)
  const indexed = await evaluate('window.pdfTestIndex.list()')
  const status = await evaluate('document.querySelector("[role=status]").textContent')
  const ownOcrPages = recognized.filter(x => x.owner === win.webContents.id).map(x => x.page)
  const ownCachePages = cacheHits.filter(x => x.owner === win.webContents.id).flatMap(x => { try { return [JSON.parse(x.key).pageNumber] } catch { return [] } })
  if (label === 'reopen-cache' && (ownOcrPages.includes(1) || !ownCachePages.includes(1))) throw new Error('Cover OCR disk cache was not reused')
  const stressMemory = []
  let maxCanvases = canvasCount
  if (label === 'first-session') {
    for (let round = 0; round < 2; round++) {
      for (const page of [100, 200, 300, 400, 500, 600, 686]) {
        await jump(page)
        maxCanvases = Math.max(maxCanvases, await evaluate<number>('document.querySelectorAll("[data-pdf-canvas]").length'))
      }
      stressMemory.push(app.getAppMetrics().find(metric => metric.pid === win.webContents.getOSProcessId())?.memory)
    }
    if (maxCanvases > 7) throw new Error('Too many canvases during stress navigation')
  }
  const oldUrl = await evaluate<string>('window.pdfTestNetwork.urls[0]')
  await evaluate(`window.pdfTestSwitch(${JSON.stringify(navigation)})`)
  await waitFor(visible(1))
  await waitFor(`Array.from(document.querySelectorAll('aside button')).some(b=>b.textContent==='Target third page')`)
  await evaluate(`Array.from(document.querySelectorAll('aside button')).find(b=>b.textContent==='Target third page').click()`)
  await waitFor(`document.querySelector('input[aria-label="跳转页码"]').value==='3'`)
  await waitFor(visible(3))
  const outlineNavigation = await evaluate(`document.activeElement.dataset.pageNumber==='3'&&!document.querySelector('[data-pdf-canvas="686"]')`)
  const revokedStatus = await evaluate(`fetch(${JSON.stringify(oldUrl)}, {headers:{Range:'bytes=0-0'}}).then(r=>r.status)`)
  if (!outlineNavigation || revokedStatus !== 403) throw new Error('Outline/switch/capability cleanup failed')
  const item = { label, firstPageMs, firstPageTiming, firstPageNetwork, preloadedMs, jump500Ms, jump686Ms, jump500Timing, jump686Timing, mode, darkPixelSamples: pixels, canvasCount, maxCanvases, oldReleased, pagePosition, memory, stressMemory, indexed, status, base64Reads, ocrCalls, ownOcrPages, ownCachePages, outlineNavigation, revokedStatus }
  ;(result.runs as unknown[]).push(item)
  console.log(JSON.stringify(item))
  win.destroy()
}
try {
  await run('first-session'); const calls = ocrCalls
  await run('reopen-cache'); result.firstSessionOcrCalls = calls
  // Full-file access also gets exercised independently of PDF.js' Range requests.
  const server = new PdfFileServer(); const source = await server.open(sample, 99)
  result.sourceSize = source.ok ? source.size : source
  if (base64Reads) throw new Error('Unexpected whole-file Base64 read')
  await writeFile(output, JSON.stringify(result, null, 2)); console.log('RESULT ' + output)
  clearTimeout(watchdog); app.exit(0)
} catch (error) {
  result.error = String(error); await writeFile(output, JSON.stringify(result, null, 2)); console.error(error)
  clearTimeout(watchdog); app.exit(1)
}
}
void main().catch(error => { console.error(error); clearTimeout(watchdog); app.exit(1) })
