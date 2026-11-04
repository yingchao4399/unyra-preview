import type { PDFDataRangeTransport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { loadPdfjs } from './pdfRender'
import { native } from '../lib/native'
import { readLocalMediaFile } from '../lib/localFiles'
import { readUserBinary, userAbsPath, userAbsPrefix } from '../lib/storage'

export function absolutePdfPath(path: string): string {
  return /^[a-zA-Z]:[/\\]|^[/\\]/.test(path) ? path : userAbsPath(path) ?? path
}

/** One owner for the URL, loading task and worker, including failures during open. */
export function createPdfSession(path: string, onFatalError?: (error: Error) => void) {
  let stopped = false
  let opened = false
  let task: PDFDocumentLoadingTask | undefined
  let transport: PDFDataRangeTransport | undefined
  const requests = new AbortController()
  let url: string | undefined
  const destroy = async () => {
    stopped = true
    requests.abort()
    transport?.abort()
    await task?.destroy().catch(() => {})
    if (url) await native().pdf.close(url).catch(() => {})
    url = undefined
  }
  const ready = (async (): Promise<{ doc: PDFDocumentProxy; fingerprint: string; mode: 'range' | 'fallback' }> => {
    const pdfjs = await loadPdfjs()
    if (stopped) throw new Error('PDF session closed')
    const source = await Promise.resolve().then(() => native().pdf.open(absolutePdfPath(path)))
      .catch(() => ({ ok: false as const, error: '本地 PDF 协议不可用' }))
    if (source.ok) url = source.url
    if (stopped) { await destroy(); throw new Error('PDF session closed') }
    if (source.ok) {
      try {
        // PDF.js' built-in URL loader only enables Range for HTTP(S). An Electron
        // capability URL therefore needs an explicit byte-range transport.
        const readRange = async (begin: number, end: number) => {
          const response = await fetch(source.url, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: requests.signal })
          if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${begin}-${end - 1}/${source.size}`) {
            await response.body?.cancel(); throw new Error('PDF 分段响应无效')
          }
          const data = new Uint8Array(await response.arrayBuffer())
          if (data.length !== end - begin) throw new Error('PDF 分段数据不完整')
          return data
        }
        const initial = await readRange(0, Math.min(source.size, 1024 * 1024))
        if (stopped) throw new Error('PDF session closed')
        transport = new class extends pdfjs.PDFDataRangeTransport {
          requestDataRange(begin: number, end: number) {
            void readRange(begin, end).then(data => {
              if (!stopped) this.onDataRange(begin, data)
            }).catch(error => {
              if (stopped) return
              if (opened) {
                onFatalError?.(new Error(`PDF 分段读取失败，请重新打开文档：${error instanceof Error ? error.message : String(error)}`))
                void destroy()
              } else void task?.destroy().catch(() => {})
            })
          }
          abort() { requests.abort() }
        }(source.size, initial, true)
        // disableAutoFetch requires disableStream; background OCR explicitly requests
        // more pages, rather than competing with reading through eager whole-file fetches.
        // Small chunks keep scattered page dictionaries from pulling in whole
        // megabytes of scan images during page-tree navigation.
        task = pdfjs.getDocument({ url: source.url, range: transport, rangeChunkSize: 64 * 1024,
          disableRange: false, disableStream: true, disableAutoFetch: true })
        const doc = await task.promise
        if (stopped) throw new Error('PDF session closed')
        opened = true
        return { doc, fingerprint: source.fingerprint, mode: 'range' }
      } catch (error) {
        await task?.destroy().catch(() => {})
        transport?.abort()
        if (url) await native().pdf.close(url).catch(() => {})
        url = undefined
        if (stopped) throw error
      }
    }
    const media = await readLocalMediaFile(path)
    let dataUrl = media.ok ? media.dataUrl : null
    if (!dataUrl) {
      const prefix = userAbsPrefix()?.replace(/\\/g, '/').toLowerCase()
      const normalized = path.replace(/\\/g, '/')
      const rel = prefix && normalized.toLowerCase().startsWith(prefix + '/')
        ? normalized.slice(prefix.length + 1) : absolutePdfPath(path) !== path ? path : null
      if (rel) dataUrl = await readUserBinary(rel)
    }
    if (stopped) throw new Error('PDF session closed')
    if (!dataUrl) throw new Error(media.ok ? 'PDF 数据为空' : media.error)
    const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
    const bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
    task = pdfjs.getDocument({ data: bytes })
    const doc = await task.promise
    if (stopped) throw new Error('PDF session closed')
    return { doc, fingerprint: doc.fingerprints[0] ?? path, mode: 'fallback' }
  })()
  return { ready, destroy }
}
