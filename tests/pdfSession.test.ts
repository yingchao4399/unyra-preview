import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), getDocument: vi.fn(), read: vi.fn() }))
vi.mock('../src/lib/native', () => ({ native: () => ({ pdf: { open: mocks.open, close: mocks.close } }) }))
vi.mock('../src/learn/pdfRender', () => ({ loadPdfjs: async () => ({ getDocument: mocks.getDocument,
  PDFDataRangeTransport: class { onDataRange = vi.fn(); abort() {} },
}) }))
vi.mock('../src/lib/localFiles', () => ({ readLocalMediaFile: mocks.read }))
vi.mock('../src/lib/storage', () => ({ userAbsPath: (s: string) => `C:/Data/${s}`, userAbsPrefix: () => 'C:/Data', readUserBinary: vi.fn() }))
import { createPdfSession } from '../src/learn/pdfSession'

const source = { ok: true, url: 'unyra-pdf://token/document.pdf', fingerprint: 'file-v1', size: 200_000_000, modifiedAt: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.open.mockResolvedValue(source); mocks.close.mockResolvedValue(true)
  mocks.read.mockResolvedValue({ ok: true, dataUrl: 'data:application/pdf;base64,JVBERi0x' })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('Range')!)!
    return new Response(new Uint8Array(Number(range[2]) - Number(range[1]) + 1), { status: 206,
      headers: { 'Content-Range': `bytes ${range[1]}-${range[2]}/${source.size}` } })
  }))
})
afterEach(() => vi.unstubAllGlobals())
describe('PDF session ownership', () => {
  it('opens a range URL without reading the entire file and releases its worker and capability', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 686 }), destroy })
    const session = createPdfSession('C:/book.pdf')
    expect(await session.ready).toMatchObject({ mode: 'range', fingerprint: 'file-v1' })
    expect(mocks.getDocument).toHaveBeenCalledWith(expect.objectContaining({ url: source.url, disableRange: false, disableStream: true, disableAutoFetch: true }))
    expect(mocks.read).not.toHaveBeenCalled()
    const range = mocks.getDocument.mock.calls[0][0].range
    range.requestDataRange(3 * 1024 * 1024, 4 * 1024 * 1024)
    await vi.waitFor(() => expect(range.onDataRange).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(source.url, expect.objectContaining({ headers: { Range: 'bytes=3145728-4194303' } }))
    await session.destroy()
    expect(destroy).toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalledWith(source.url)
  })
  it('uses the legacy fallback when the protocol bridge rejects', async () => {
    mocks.open.mockRejectedValue(new Error('not supported'))
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ fingerprints: ['legacy'] }), destroy: vi.fn().mockResolvedValue(undefined) })
    const session = createPdfSession('C:/book.pdf')
    expect(await session.ready).toMatchObject({ mode: 'fallback', fingerprint: 'legacy' })
    expect(mocks.read).toHaveBeenCalledOnce()
    expect(mocks.getDocument.mock.calls[0][0].data).toBeInstanceOf(Uint8Array)
    await session.destroy()
  })
  it('revokes a source that arrives after a document switch without starting a worker', async () => {
    let finish!: (value: typeof source) => void
    mocks.open.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const session = createPdfSession('C:/old.pdf')
    const outcome = session.ready.catch(error => error)
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalled())
    await session.destroy(); finish(source)
    expect(await outcome).toBeInstanceOf(Error)
    expect(mocks.close).toHaveBeenCalledWith(source.url)
    expect(mocks.getDocument).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('cancels a loading task without starting the fallback after a switch', async () => {
    let reject!: (reason: Error) => void
    const promise = new Promise((_, fail) => { reject = fail })
    const destroy = vi.fn(async () => { reject(new Error('cancelled')) })
    mocks.getDocument.mockReturnValue({ promise, destroy })
    const session = createPdfSession('C:/old.pdf')
    const outcome = session.ready.catch(error => error)
    await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled())
    await session.destroy(); expect(await outcome).toBeInstanceOf(Error)
    expect(destroy).toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled()
  })
  it('reports a failed range after opening and revokes the broken session', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined), failed = vi.fn()
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 686 }), destroy })
    const session = createPdfSession('C:/book.pdf', failed)
    await session.ready
    vi.mocked(fetch).mockRejectedValueOnce(new Error('file removed'))
    mocks.getDocument.mock.calls[0][0].range.requestDataRange(1048576, 1064960)
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledWith(source.url))
    expect(destroy).toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled()
  })
})
