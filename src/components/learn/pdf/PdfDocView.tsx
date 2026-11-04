import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { ChevronLeft, ChevronRight, ListTree, Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { createPdfSession, absolutePdfPath } from '../../../learn/pdfSession'
import { PdfRenderQueue, pdfDestinationPage, pdfPageWindow } from '../../../learn/pdfScheduler'
import { PdfAnalysis } from '../../../learn/pdfAnalysis'
import { OcrTextOverlay } from '../../../lib/ocr/pdfTextLayer'
import { ocrPluginOn, OCR_PLUGIN_ID } from '../../../lib/ocr/plugin'
import { native, type OcrLineItem } from '../../../lib/native'
import { fileNameOf } from '../../../learn/tabs'

interface Props { path: string; scale?: number }
interface Size { width: number; height: number }
interface OutlineItem { title: string; dest: unknown; items: OutlineItem[] }
interface ReaderDocument { doc: PDFDocumentProxy; fingerprint: string; mode: 'range' | 'fallback' }
const button = 'px-2 py-1 text-xs hover:bg-card disabled:opacity-40 border border-line'

const PagePainter = memo(function PagePainter({ doc, pageNumber, zoom, priority, current, queue, analysis, onMeasure, onPaint }: {
  doc: PDFDocumentProxy; pageNumber: number; zoom: number; priority: number; current: boolean
  queue: PdfRenderQueue; analysis: PdfAnalysis; onMeasure: (page: number, size: Size) => void; onPaint: (page: number, ready: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'rendering' | 'ready' | 'failed'>('loading')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [lines, setLines] = useState<OcrLineItem[]>([])
  const [pageHeight, setPageHeight] = useState(800)
  const refineRef = useRef<(() => void) | undefined>(undefined)
  const queuedRef = useRef<ReturnType<PdfRenderQueue['enqueue']> | null>(null)
  const currentRef = useRef(current)
  currentRef.current = current

  useEffect(() => {
    const update = () => {
      const result = analysis.pageResult(pageNumber)
      if (result) setLines(result.lines)
    }
    update()
    return analysis.subscribe(update)
  }, [analysis, pageNumber])

  useEffect(() => {
    let alive = true
    let page: PDFPageProxy | undefined
    let task: RenderTask | undefined
    let staging: HTMLCanvasElement | undefined
    let idle: ReturnType<typeof setTimeout> | undefined
    let cancelHigh: (() => void) | undefined
    let refined = false
    const display = canvasRef.current!
    setState('loading'); setError(''); onPaint(pageNumber, false)
    const render = async (high: boolean) => {
      try {
        if (!alive) return
        const started = performance.now()
        page ??= await doc.getPage(pageNumber)
        if (!alive) return
        const loaded = performance.now()
        const base = page.getViewport({ scale: 1 })
        onMeasure(pageNumber, { width: base.width, height: base.height })
        const css = page.getViewport({ scale: zoom })
        setPageHeight(css.height)
        const dpr = high ? Math.min(1.5, window.devicePixelRatio || 1) : 0.8
        const ratio = Math.min(dpr, Math.sqrt((high ? 4_000_000 : 1_200_000) / (css.width * css.height)))
        const viewport = page.getViewport({ scale: zoom * ratio })
        staging = document.createElement('canvas')
        staging.width = Math.max(1, Math.floor(viewport.width)); staging.height = Math.max(1, Math.floor(viewport.height))
        if (!high) setState('rendering')
        task = page.render({ canvas: staging, viewport })
        await task.promise
        if (!alive) return
        if (!high) {
          display.dataset.pdfStartedAt = String(Math.round(started))
          display.dataset.pdfLoadMs = String(Math.round(loaded - started))
          display.dataset.pdfRenderMs = String(Math.round(performance.now() - loaded))
        }
        display.width = staging.width; display.height = staging.height
        display.getContext('2d')!.drawImage(staging, 0, 0)
        setState('ready')
        if (!high) { onPaint(pageNumber, true); if (currentRef.current) analysis.prioritize(pageNumber) }
      } catch (error) {
        if (alive && !high) { setError(error instanceof Error ? error.message : String(error)); setState('failed') }
      } finally {
        task = undefined
        if (staging) { staging.width = 0; staging.height = 0; staging = undefined }
        if (!alive) page?.cleanup()
      }
    }
    const refine = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        if (!alive || !currentRef.current || refined) return
        if (queue.busy) { refine(); return }
        refined = true
        cancelHigh = queue.enqueue(100, () => render(true), () => task?.cancel())
      }, 600)
    }
    refineRef.current = refine
    const cancel = queue.enqueue(priority, async () => { await render(false); if (alive) refine() }, () => task?.cancel())
    queuedRef.current = cancel
    return () => {
      alive = false; clearTimeout(idle); refineRef.current = undefined
      cancel(); cancelHigh?.(); task?.cancel()
      queuedRef.current = null
      display.width = 0; display.height = 0
      onPaint(pageNumber, false)
      // cleanup() defers while a cancelled render is still settling.
      page?.cleanup()
    }
    // Priority only determines initial queue order; scrolling must not restart an existing paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, zoom, queue, analysis, onMeasure, onPaint, retry])

  useEffect(() => { queuedRef.current?.setPriority(priority) }, [priority])
  useEffect(() => {
    if (current && state === 'ready') { refineRef.current?.(); analysis.prioritize(pageNumber) }
  }, [current, state, analysis, pageNumber])
  return <>
    <canvas ref={canvasRef} width={0} height={0} data-pdf-canvas={pageNumber} data-pdf-ready={state === 'ready'} className="block h-full w-full bg-white" />
    <OcrTextOverlay lines={lines} pageHeight={pageHeight} />
    {state !== 'ready' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/90 text-sm text-gray-600">
      {state === 'failed' ? <><span>第 {pageNumber} 页加载失败：{error}</span><button className={button} onClick={() => setRetry(n => n + 1)}>重试本页</button></>
        : <><Loader2 className="animate-spin" size={20} /><span>{state === 'loading' ? '正在加载' : '正在渲染'}第 {pageNumber} 页</span></>}
    </div>}
  </>
})

function OutlineBranch({ items, jump, depth = 0 }: { items: OutlineItem[]; jump: (dest: unknown) => void; depth?: number }) {
  return <>{items.map((item, i) => <div key={i}>
    <button className="block w-full py-2 pr-2 text-left text-xs hover:bg-card" style={{ paddingLeft: 12 + depth * 12 }}
      onClick={() => jump(item.dest)}>{item.title}</button>
    {item.items?.length > 0 && <OutlineBranch items={item.items} jump={jump} depth={Math.min(depth + 1, 12)} />}
  </div>)}</>
}

const PdfReader = memo(function PdfReader({ path, scale = 1 }: Props) {
  const [reader, setReader] = useState<ReaderDocument | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [zoom, setZoom] = useState(1.15 * scale)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [visible, setVisible] = useState({ first: 1, last: 1 })
  const [direction, setDirection] = useState(1)
  const [sizes, setSizes] = useState<Record<number, Size>>({})
  const [outline, setOutline] = useState<OutlineItem[]>([])
  const [outlineState, setOutlineState] = useState('正在加载目录')
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [notice, setNotice] = useState('')
  const [painted, setPainted] = useState<Set<number>>(new Set())
  const [, refreshAnalysis] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const lastScroll = useRef(0)
  const pendingFocus = useRef<number | null>(null)
  const currentRef = useRef(1)
  currentRef.current = currentPage
  const queue = useMemo(() => new PdfRenderQueue(2), [reader])
  const analysis = useMemo(() => reader ? new PdfAnalysis(reader.doc, reader.fingerprint, path, queue) : null, [reader, path, queue])
  const total = reader?.doc.numPages ?? 0

  useEffect(() => {
    setReader(null); setError(''); setOutline([]); setOutlineState('正在加载目录'); setSizes({}); setPainted(new Set())
    setCurrentPage(1); setVisible({ first: 1, last: 1 }); setNotice(''); pendingFocus.current = null
    let alive = true
    const session = createPdfSession(path, error => {
      if (alive) { setReader(null); setError(error.message) }
    })
    void session.ready.then(result => { if (alive) setReader(result) }).catch(error => {
      if (alive) setError(error instanceof Error ? error.message : String(error))
      void session.destroy()
    })
    return () => { alive = false; void session.destroy() }
  }, [path, reload])

  useEffect(() => () => queue.dispose(), [queue])
  useEffect(() => {
    if (!analysis) return
    const unsubscribe = analysis.subscribe(() => refreshAnalysis(n => n + 1))
    // Start after the first paint or a short grace period if that page fails.
    const timer = setTimeout(() => analysis.start(), 2000)
    const changed = () => analysis.retry()
    window.addEventListener('moji:plugin-toggle', changed)
    return () => { clearTimeout(timer); unsubscribe(); window.removeEventListener('moji:plugin-toggle', changed); analysis.dispose() }
  }, [analysis])

  useEffect(() => {
    if (!reader) return
    let alive = true
    void reader.doc.getOutline().then(items => {
      if (alive) { setOutline((items ?? []) as OutlineItem[]); setOutlineState(items?.length ? '' : '此文档没有内置目录，可使用页码跳转') }
    }).catch(() => { if (alive) setOutlineState('目录读取失败，仍可使用页码跳转') })
    return () => { alive = false }
  }, [reader])

  const geometry = useMemo(() => {
    const fallback = sizes[1] ?? { width: 612, height: 792 }
    let top = 16
    return Array.from({ length: total }, (_, i) => {
      const size = sizes[i + 1] ?? fallback
      const result = { top, width: size.width * zoom, height: size.height * zoom }
      top += result.height + 16
      return result
    })
  }, [sizes, zoom, total])
  const geometryRef = useRef(geometry)
  const pageAt = useCallback((y: number) => {
    let lo = 0, hi = geometry.length - 1
    while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (geometry[mid].top <= y) lo = mid; else hi = mid - 1 }
    return lo + 1
  }, [geometry])
  const updateVisible = useCallback(() => {
    const el = scrollRef.current
    if (!el || !total) return
    const first = pageAt(el.scrollTop + 16)
    const last = pageAt(el.scrollTop + el.clientHeight - 16)
    const current = pageAt(el.scrollTop + Math.min(100, el.clientHeight / 3))
    setDirection(el.scrollTop >= lastScroll.current ? 1 : -1); lastScroll.current = el.scrollTop
    setVisible(v => v.first === first && v.last === last ? v : { first, last })
    setCurrentPage(current)
  }, [pageAt, total])
  useLayoutEffect(() => {
    const el = scrollRef.current
    const old = geometryRef.current[currentRef.current - 1]
    const next = geometry[currentRef.current - 1]
    if (el && old && next && geometry !== geometryRef.current) {
      const fraction = (el.scrollTop - old.top) / old.height
      el.scrollTop = next.top + fraction * next.height
    }
    geometryRef.current = geometry
    updateVisible()
  }, [geometry, updateVisible])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame = 0
    const changed = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updateVisible) }
    el.addEventListener('scroll', changed, { passive: true })
    const observer = new ResizeObserver(changed); observer.observe(el); changed()
    return () => { cancelAnimationFrame(frame); observer.disconnect(); el.removeEventListener('scroll', changed) }
  }, [updateVisible, reader])
  useEffect(() => setPageInput(String(currentPage)), [currentPage])

  const onMeasure = useCallback((page: number, size: Size) => setSizes(old => {
    if (old[page]?.width === size.width && old[page]?.height === size.height) return old
    return { ...old, [page]: size }
  }), [])
  const onPaint = useCallback((page: number, ready: boolean) => {
    setPainted(old => { const next = new Set(old); if (ready) next.add(page); else next.delete(page); return next })
    if (ready && pendingFocus.current === page) {
      scrollRef.current?.querySelector<HTMLElement>(`[data-page-number="${page}"]`)?.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  }, [])
  const jump = useCallback((raw: number) => {
    if (!Number.isFinite(raw) || !total) return
    const page = Math.max(1, Math.min(total, Math.floor(raw)))
    const el = scrollRef.current
    if (!el) return
    pendingFocus.current = page
    el.scrollTop = geometry[page - 1].top - 16
    setCurrentPage(page); setPageInput(String(page)); updateVisible(); analysis?.prioritize(page)
    el.querySelector<HTMLElement>(`[data-page-number="${page}"]`)?.focus({ preventScroll: true })
  }, [total, geometry, updateVisible, analysis])
  const jumpOutline = async (dest: unknown) => {
    if (!reader) return
    try {
      const page = await pdfDestinationPage(reader.doc, dest)
      if (page && page <= total) { setNotice(''); jump(page) } else setNotice('此目录项没有可用的文档内目标')
    } catch { setNotice('无法定位此目录项，可使用页码跳转') }
  }
  const changeZoom = useCallback((delta: number) => setZoom(z => Math.max(0.25, Math.min(3, z + delta))), [])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault(); event.stopPropagation(); changeZoom(event.deltaY < 0 ? 0.1 : -0.1)
    }
    root.addEventListener('wheel', wheel, { passive: false })
    return () => root.removeEventListener('wheel', wheel)
  }, [changeZoom, reader])
  const openSystem = () => { void native().pdf.openExternal(absolutePdfPath(path)).then(ok => { if (!ok) setNotice('系统阅读器打开失败，请检查 PDF 文件关联') }) }
  const configureOcr = () => {
    localStorage.setItem('moji:settings:tab', 'plugins'); localStorage.setItem('moji:settings:plugin', OCR_PLUGIN_ID)
    window.dispatchEvent(new CustomEvent('moji:open-plugin-config', { detail: OCR_PLUGIN_ID }))
    window.dispatchEvent(new CustomEvent('moji:open-tab', { detail: { kind: 'settings' } }))
  }
  if (!reader) return <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-paper p-6 text-sm text-ink-soft">
    {error ? <><p>无法预览：{error}</p><div className="flex gap-2"><button className={button} onClick={() => setReload(n => n + 1)}>重新打开</button>
      <button className={button} onClick={openSystem}>用系统阅读器打开</button></div></>
      : <><Loader2 className="animate-spin" /><p>正在打开《{fileNameOf(path)}》，优先加载第一页…</p></>}
    {notice && <p>{notice}</p>}
  </div>

  const pageWindow = new Set(pdfPageWindow(visible.first, visible.last, total))
  const status = analysis?.status()
  const pageState = analysis?.pageStatus(currentPage)
  return <div ref={rootRef} className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-paper text-ink-soft" data-pdf-reader data-pdf-mode={reader.mode}>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
      <span className="mr-auto max-w-56 truncate text-xs" title={path}>{fileNameOf(path)}</span>
      <button className={button} disabled={currentPage <= 1} onClick={() => jump(currentPage - 1)} aria-label="上一页"><ChevronLeft size={15} /></button>
      <form className="flex items-center gap-1 text-xs" onSubmit={e => { e.preventDefault(); jump(Number(pageInput)) }}>
        <input aria-label="跳转页码" type="number" min={1} max={total} value={pageInput} onChange={e => setPageInput(e.target.value)}
          className="w-16 border border-line bg-card px-1 py-1 text-center" /> / {total}<button className={button}>跳转</button>
      </form>
      <button className={button} disabled={currentPage >= total} onClick={() => jump(currentPage + 1)} aria-label="下一页"><ChevronRight size={15} /></button>
      <button className={button} onClick={() => changeZoom(-0.15)} aria-label="缩小"><ZoomOut size={14} /></button>
      <button className={button} onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
      <button className={button} onClick={() => changeZoom(0.15)} aria-label="放大"><ZoomIn size={14} /></button>
      <button className={button} title="适应宽度" onClick={() => setZoom(Math.max(0.25, Math.min(3, ((scrollRef.current?.clientWidth ?? 700) - 48) / (sizes[currentPage]?.width ?? sizes[1]?.width ?? 612))))}><Maximize2 size={14} /></button>
      <button className={button} onClick={() => setOutlineOpen(v => !v)} aria-label="切换目录" aria-expanded={outlineOpen}><ListTree size={15} /></button>
      <button className={button} onClick={openSystem}>系统阅读器</button>
    </div>
    {notice && <div role="status" className="px-3 py-1 text-xs">{notice}</div>}
    <div className="flex min-h-0 flex-1">
      <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto bg-paper-deep/50" style={{ overflowAnchor: 'none' }} data-pdf-scroll>
        <div style={{ minWidth: '100%', width: Math.max(0, ...geometry.map(g => g.width)) + 32, padding: '16px 16px 0' }}>
          {geometry.map((g, i) => <div key={i + 1} data-page-number={i + 1} tabIndex={-1} aria-label={`第 ${i + 1} 页`}
            className="relative mx-auto mb-4 bg-white shadow-md outline-none focus:ring-1 focus:ring-seal"
            style={{ width: g.width, height: g.height, overflow: 'hidden' }}>
            {pageWindow.has(i + 1) && analysis ? <PagePainter doc={reader.doc} pageNumber={i + 1} zoom={zoom}
              priority={i + 1 === currentPage ? 0 : Math.abs(i + 1 - currentPage) * 2 + ((i + 1 - currentPage) * direction < 0 ? 1 : 0)}
              current={i + 1 === currentPage} queue={queue} analysis={analysis} onMeasure={onMeasure} onPaint={onPaint} />
              : <span className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">第 {i + 1} 页</span>}
          </div>)}
        </div>
      </div>
      {outlineOpen && <aside className="w-52 shrink-0 overflow-y-auto border-l border-line" aria-label="PDF 目录">
        <div className="border-b border-line p-3 text-xs font-medium">文档目录</div>
        {outlineState ? <p className="p-3 text-xs leading-6">{outlineState}</p> : <OutlineBranch items={outline} jump={dest => { void jumpOutline(dest) }} />}
      </aside>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-[11px]" role="status">
      <span>页面渲染：{painted.has(currentPage) ? '已显示' : '加载中'} · 当前页{pageState === 'done' ? '已识别' : pageState === 'failed' ? '识别失败' : pageState === 'waiting' ? '等待 OCR' : '待解析'}</span>
      <span className="mr-auto">后台识别 {status?.completed ?? 0}/{total} · {status?.paused ? '已暂停' : status?.message}</span>
      {status?.failed ? <button className={button} onClick={() => analysis?.retry()}>重试失败页 ({status.failed})</button> : null}
      {!ocrPluginOn() && <button className={button} onClick={configureOcr}>配置离线 OCR</button>}
      {(status?.waitingForOcr ?? 0) > 0 && ocrPluginOn() && <button className={button} onClick={() => analysis?.retry()}>重试待识别页</button>}
      <button className={button} onClick={() => analysis?.pause(!status?.paused)}>{status?.paused ? '继续识别' : '暂停识别'}</button>
    </div>
  </div>
})
// A new path owns a fresh session, scroll position, queue and analysis lifecycle.
export const PdfDocView = memo(function PdfDocView(props: Props) {
  return <PdfReader key={props.path} {...props} />
})
export default PdfDocView
