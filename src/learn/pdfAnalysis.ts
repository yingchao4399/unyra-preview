import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { native, type OcrPageResult, type OcrLineItem } from '../lib/native'
import { buildPdfPageCacheKey, getCachedOcrResult, setCachedOcrResult } from '../lib/ocr/cache'
import { ocrPluginOn } from '../lib/ocr/plugin'
import { loadPdfjs } from './pdfRender'
import { pdfIndex } from './pdfIndex'
import type { PdfRenderQueue } from './pdfScheduler'

export interface PdfAnalysisStatus {
  completed: number; total: number; activePage: number | null; paused: boolean
  waitingForOcr: number; failed: number; message: string
}
type PageState = 'done' | 'waiting' | 'failed'

/** A single, yielding producer; reading has priority over background rasterization. */
export class PdfAnalysis {
  private states = new Map<number, PageState>()
  private results = new Map<number, OcrPageResult>()
  private listeners = new Set<() => void>()
  private cursor = 1
  private priority: number[] = []
  private stopped = false
  private paused = false
  private running = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private renderTask: RenderTask | undefined
  private cancelRender: (() => void) | undefined
  private activePage: number | null = null
  private modelId = ''
  private message = '等待首屏显示'
  private doc: PDFDocumentProxy
  readonly documentId: string
  private queue: PdfRenderQueue
  constructor(doc: PDFDocumentProxy, documentId: string, path: string, queue: PdfRenderQueue) {
    this.doc = doc; this.documentId = documentId; this.queue = queue
    pdfIndex.register(documentId, path, doc.numPages)
  }
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  status(): PdfAnalysisStatus {
    const values = [...this.states.values()]
    return { completed: values.filter(x => x === 'done').length, total: this.doc.numPages, activePage: this.activePage,
      paused: this.paused, waitingForOcr: values.filter(x => x === 'waiting').length,
      failed: values.filter(x => x === 'failed').length, message: this.message }
  }
  pageStatus(page: number) { return this.states.get(page) }
  pageResult(page: number) { return this.results.get(page) }
  private emit() { for (const listener of this.listeners) listener() }
  prioritize(page: number) {
    if (this.states.get(page) === 'done' && !this.results.has(page)) void this.restoreResult(page)
    if (!this.states.has(page) && !this.priority.includes(page) && page >= 1 && page <= this.doc.numPages) this.priority.unshift(page)
    this.schedule()
  }
  private async restoreResult(page: number) {
    const vector = await getCachedOcrResult(buildPdfPageCacheKey(this.documentId, page, 'und', 'pdfjs-vector-v1'))
    const result = vector ?? (this.modelId ? await getCachedOcrResult(buildPdfPageCacheKey(this.documentId, page, 'zh-en', `${this.modelId}:pdf-ocr-v1`)) : null)
    if (this.stopped || !result) return
    this.results.set(page, result)
    while (this.results.size > 12) this.results.delete(this.results.keys().next().value!)
    this.emit()
  }
  start() { this.schedule() }
  pause(paused: boolean) { this.paused = paused; this.emit(); if (!paused) this.schedule() }
  retry(page?: number) {
    for (const [n, state] of this.states) if ((!page || n === page) && state !== 'done') {
      this.states.delete(n); this.priority.push(n)
    }
    this.modelId = ''
    this.schedule(); this.emit()
  }
  private schedule() {
    if (this.stopped || this.paused || this.running || this.timer) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.step() }, 150)
  }
  private async step() {
    if (this.stopped || this.paused) return
    if (this.queue.busy) { this.schedule(); return }
    while (this.cursor <= this.doc.numPages && this.states.has(this.cursor)) this.cursor++
    const page = this.priority.shift() ?? this.cursor
    if (page > this.doc.numPages) { this.message = '后台队列已处理'; this.emit(); return }
    if (this.states.has(page)) { this.schedule(); return }
    this.running = true; this.activePage = page; this.message = `正在解析第 ${page} 页`; this.emit()
    try {
      const result = await this.analyze(page)
      if (this.stopped) return
      if (result) {
        this.states.set(page, 'done')
        this.results.set(page, result)
        while (this.results.size > 12) this.results.delete(this.results.keys().next().value!)
        pdfIndex.add(this.documentId, page, result.fullText)
      } else this.states.set(page, 'waiting')
    } catch (error) {
      if (!this.stopped) { this.states.set(page, 'failed'); this.message = error instanceof Error ? error.message : String(error) }
    } finally {
      this.running = false; this.activePage = null; this.emit(); this.schedule()
    }
  }
  private async analyze(pageNumber: number): Promise<OcrPageResult | null> {
    const vectorKey = buildPdfPageCacheKey(this.documentId, pageNumber, 'und', 'pdfjs-vector-v1')
    const vector = await getCachedOcrResult(vectorKey)
    if (vector) return vector
    if (this.stopped) return null
    if (ocrPluginOn() && !this.modelId) {
      const status = await native().ocr.modelStatus()
      this.modelId = status.activeModelId
    }
    const ocrKey = buildPdfPageCacheKey(this.documentId, pageNumber, 'zh-en', `${this.modelId}:pdf-ocr-v1`)
    const cached = this.modelId ? await getCachedOcrResult(ocrKey) : null
    if (cached) return cached
    const page = await this.doc.getPage(pageNumber)
    try {
      if (this.stopped) return null
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      if (this.stopped) return null
      const pdfjs = await loadPdfjs()
      const lines: OcrLineItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const tx = pdfjs.Util.transform(viewport.transform, item.transform)
        const height = Math.max(1, Math.hypot(tx[2], tx[3]))
        lines.push({ text: item.str, bbox: { x: Math.max(0, tx[4] / viewport.width),
          y: Math.max(0, (tx[5] - height) / viewport.height),
          width: Math.min(1, item.width / viewport.width), height: Math.min(1, height / viewport.height) } })
      }
      if (lines.length) {
        const result = { page: pageNumber, lines, fullText: lines.map(l => l.text).join(' '), modelId: 'native-pdf-vector', createdAt: Date.now() }
        if (!this.stopped) await setCachedOcrResult(vectorKey, result)
        return result
      }
      if (!ocrPluginOn() || !this.modelId || this.stopped) return null
      // Independent fixed-size canvas, never the user's zoomed display canvas.
      const canvas = document.createElement('canvas')
      try {
        const vp = page.getViewport({ scale: 1568 / Math.max(viewport.width, viewport.height) })
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height)
        await new Promise<void>((resolve, reject) => {
          this.cancelRender = this.queue.enqueue(10000, async () => {
            try {
              if (this.stopped) return
              this.renderTask = page.render({ canvas, viewport: vp })
              await this.renderTask.promise
              resolve()
            } catch (error) { reject(error) } finally { this.renderTask = undefined }
          }, () => { this.renderTask?.cancel(); reject(new Error('PDF analysis cancelled')) })
        })
        this.cancelRender = undefined
        if (this.stopped) return null
        this.message = `正在识别第 ${pageNumber} 页`; this.emit()
        const response = await native().ocr.recognize({ imageDataUrl: canvas.toDataURL('image/jpeg', 0.85), page: pageNumber, modelId: this.modelId })
        if (!response.ok || !response.result) throw new Error(response.error ?? 'OCR 识别失败')
        if (this.stopped) return null
        await setCachedOcrResult(ocrKey, response.result)
        return response.result
      } finally { canvas.width = 0; canvas.height = 0 }
    } finally { page.cleanup() }
  }
  dispose() {
    this.stopped = true; clearTimeout(this.timer); this.cancelRender?.(); this.renderTask?.cancel()
    this.listeners.clear(); this.results.clear()
  }
}
