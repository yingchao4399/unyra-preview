import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { OcrPageResult } from '../src/lib/native'
const mocks = vi.hoisted(() => ({ getCache: vi.fn(), setCache: vi.fn(), modelStatus: vi.fn(), recognize: vi.fn() }))
vi.mock('../src/lib/native', () => ({ native: () => ({ ocr: mocks }) }))
vi.mock('../src/lib/ocr/plugin', () => ({ ocrPluginOn: () => true }))
vi.mock('../src/learn/pdfRender', () => ({ loadPdfjs: async () => ({ Util: { transform: (_a: unknown, b: unknown) => b } }) }))
import { PdfAnalysis } from '../src/learn/pdfAnalysis'
import { PdfRenderQueue } from '../src/learn/pdfScheduler'
import { pdfIndex } from '../src/learn/pdfIndex'
import { buildPdfPageCacheKey, clearMemoryOcrCache } from '../src/lib/ocr/cache'

const disk = new Map<string, OcrPageResult>()
const queues: PdfRenderQueue[] = [], analyses: PdfAnalysis[] = []
function create(id: string, getPage = vi.fn()) {
  const queue = new PdfRenderQueue(); queues.push(queue)
  const analysis = new PdfAnalysis({ numPages: 1, getPage } as unknown as PDFDocumentProxy, id, 'C:/book.pdf', queue)
  analyses.push(analysis); return analysis
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); clearMemoryOcrCache(); disk.clear()
  mocks.getCache.mockImplementation(async (key: string) => disk.get(key) ?? null)
  mocks.setCache.mockImplementation(async (key: string, result: OcrPageResult) => { disk.set(key, result); return true })
  mocks.modelStatus.mockResolvedValue({ activeModelId: 'test-model' })
})
afterEach(() => { analyses.splice(0).forEach(a => a.dispose()); queues.splice(0).forEach(q => q.dispose()); vi.useRealTimers() })
describe('incremental PDF analysis', () => {
  it('extracts embedded text, indexes it and reuses disk cache after renderer memory is cleared', async () => {
    const getPage = vi.fn().mockResolvedValue({ getViewport: () => ({ width: 600, height: 800 }),
      getTextContent: async () => ({ items: [{ str: '实验心理学', transform: [1, 0, 0, 12, 10, 20], width: 50 }] }), cleanup: vi.fn() })
    const first = create('vector-test', getPage); first.start()
    await vi.advanceTimersByTimeAsync(200)
    expect(first.status().completed).toBe(1)
    expect(pdfIndex.search({ documentId: 'vector-test', query: '心理学' })[0].pageNumber).toBe(1)
    expect(mocks.recognize).not.toHaveBeenCalled(); first.dispose()
    clearMemoryOcrCache(); getPage.mockClear()
    const second = create('vector-test', getPage); second.start(); await vi.advanceTimersByTimeAsync(200)
    expect(second.status().completed).toBe(1); expect(getPage).not.toHaveBeenCalled()
  })
  it('reuses OCR results, including a genuinely blank page, without rasterization or recognition', async () => {
    disk.set(buildPdfPageCacheKey('scan-test', 1, 'zh-en', 'test-model:pdf-ocr-v1'),
      { page: 1, lines: [], fullText: '', modelId: 'test-model', createdAt: 1 })
    const getPage = vi.fn(); const analysis = create('scan-test', getPage)
    analysis.start(); await vi.advanceTimersByTimeAsync(200)
    expect(analysis.status().completed).toBe(1)
    expect(getPage).not.toHaveBeenCalled(); expect(mocks.recognize).not.toHaveBeenCalled()
  })
  it('pauses the producer and releases a page arriving after disposal without extracting its text', async () => {
    let finish!: (page: unknown) => void
    const getPage = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const analysis = create('cancel-test', getPage); analysis.pause(true); analysis.start()
    await vi.advanceTimersByTimeAsync(300); expect(getPage).not.toHaveBeenCalled()
    analysis.pause(false); await vi.advanceTimersByTimeAsync(200); expect(getPage).toHaveBeenCalledOnce()
    const cleanup = vi.fn(), getTextContent = vi.fn(); analysis.dispose(); finish({ cleanup, getTextContent })
    await vi.advanceTimersByTimeAsync(1)
    expect(cleanup).toHaveBeenCalledOnce(); expect(getTextContent).not.toHaveBeenCalled()
    expect(pdfIndex.search({ documentId: 'cancel-test', query: '实验' })).toEqual([])
  })
})
