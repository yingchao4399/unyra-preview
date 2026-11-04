interface Job { priority: number; run: () => Promise<void>; cancel: () => void; cancelled: boolean }

/** Shared by page paints and OCR rasterization. Cancelling retains its slot until settled. */
export class PdfRenderQueue {
  private pending: Job[] = []
  private active = new Set<Job>()
  private stopped = false
  private concurrency: number
  constructor(concurrency = 2) { this.concurrency = concurrency }
  get busy(): boolean { return this.active.size > 0 || this.pending.length > 0 }
  enqueue(priority: number, run: () => Promise<void>, cancel: () => void = () => {}) {
    const job: Job = { priority, run, cancel, cancelled: false }
    if (!this.stopped) { this.pending.push(job); queueMicrotask(() => this.drain()) }
    const handle = () => {
      job.cancelled = true
      job.cancel()
      this.pending = this.pending.filter(j => j !== job)
    }
    handle.setPriority = (value: number) => { job.priority = value; queueMicrotask(() => this.drain()) }
    return handle
  }
  private drain() {
    this.pending.sort((a, b) => a.priority - b.priority)
    while (!this.stopped && this.active.size < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!
      if (job.cancelled) continue
      this.active.add(job)
      void Promise.resolve().then(() => { if (!job.cancelled) return job.run() }).catch(error => {
        console.warn('[pdf-queue]', error)
      }).finally(() => { this.active.delete(job); this.drain() })
    }
  }
  dispose() {
    this.stopped = true
    for (const job of [...this.pending, ...this.active]) { job.cancelled = true; job.cancel() }
    this.pending = []
  }
}

export function pdfPageWindow(first: number, last: number, total: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(total, last + 2) - Math.max(1, first - 2) + 1) },
    (_, i) => Math.max(1, first - 2) + i)
}

export async function pdfDestinationPage(doc: {
  getDestination: (name: string) => Promise<unknown[] | null>
  getPageIndex: (ref: { num: number; gen: number }) => Promise<number>
}, destination: unknown): Promise<number | null> {
  const dest = typeof destination === 'string' ? await doc.getDestination(destination) : destination
  if (!Array.isArray(dest)) return null
  const ref: unknown = dest[0]
  if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 0) return ref + 1
  if (ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref) {
    return (await doc.getPageIndex(ref as { num: number; gen: number })) + 1
  }
  return null
}
