import { describe, expect, it } from 'vitest'
import { PdfRenderQueue, pdfDestinationPage, pdfPageWindow } from '../src/learn/pdfScheduler'

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
describe('PDF render scheduling', () => {
  it('keeps two slots, prioritizes visible pages, and cancels obsolete queued work', async () => {
    const queue = new PdfRenderQueue(2)
    const started: number[] = [], finish: Array<() => void> = []
    const add = (n: number) => queue.enqueue(n, () => new Promise<void>(resolve => { started.push(n); finish.push(resolve) }))
    const cancel = add(9); add(2); add(0); add(1); cancel()
    await tick(); expect(started).toEqual([0, 1])
    finish[0](); await tick(); expect(started).toEqual([0, 1, 2])
    queue.dispose(); finish.forEach(resolve => resolve()); await tick()
    expect(queue.busy).toBe(false)
  })
  it('retains a cancelled running slot until its task settles', async () => {
    const queue = new PdfRenderQueue(1)
    let finish = () => {}; let second = false
    const cancel = queue.enqueue(0, () => new Promise<void>(resolve => { finish = resolve }))
    await tick(); cancel()
    queue.enqueue(0, async () => { second = true })
    await tick(); expect(second).toBe(false)
    finish(); await tick(); expect(second).toBe(true); queue.dispose()
  })
  it('promotes a queued page when it becomes the current page', async () => {
    const queue = new PdfRenderQueue(1)
    let finish = () => {}
    queue.enqueue(0, () => new Promise<void>(resolve => { finish = resolve }))
    await tick()
    const order: number[] = []
    queue.enqueue(1, async () => { order.push(1) })
    const page = queue.enqueue(9, async () => { order.push(9) })
    page.setPriority(0); finish(); await tick()
    expect(order).toEqual([9, 1]); queue.dispose()
  })
  it('keeps only visible and two neighboring pages', () => {
    expect(pdfPageWindow(500, 501, 686)).toEqual([498, 499, 500, 501, 502, 503])
    expect(pdfPageWindow(686, 686, 686)).toEqual([684, 685, 686])
  })
  it('resolves named, reference and integer outline destinations', async () => {
    const doc = { getDestination: async () => [{ num: 99, gen: 0 }, 'XYZ'], getPageIndex: async () => 499 }
    expect(await pdfDestinationPage(doc, 'chapter')).toBe(500)
    expect(await pdfDestinationPage(doc, [685, 'Fit'])).toBe(686)
    expect(await pdfDestinationPage(doc, null)).toBeNull()
  })
})
